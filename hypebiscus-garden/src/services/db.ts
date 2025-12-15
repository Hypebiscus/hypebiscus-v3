// Database service using Prisma + Supabase
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// ==================== USER OPERATIONS ====================

export async function getOrCreateUser(
  telegramId: number,
  username?: string,
  firstName?: string,
  lastName?: string
) {
  let user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    include: { 
      wallet: true,
      positions: { 
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      }
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { 
        telegramId: BigInt(telegramId), 
        username,
      },
      include: { 
        wallet: true,
        positions: true 
      },
    });
    console.log(`✅ New user created: ${telegramId} (${username})`);
  }

  return user;
}

export async function updateUserMonitoring(userId: string, isMonitoring: boolean) {
  return prisma.user.update({
    where: { id: userId },
    data: { isMonitoring },
  });
}

export async function getAllMonitoringUsers() {
  return prisma.user.findMany({
    where: { isMonitoring: true },
    include: {
      wallet: true,
      positions: { 
        where: { isActive: true },
        orderBy: { lastChecked: 'asc' }
      },
    },
  });
}

// ==================== WALLET OPERATIONS ====================

export async function createWallet(
  userId: string,
  publicKey: string,
  encrypted: string,
  iv: string
) {
  // Check if this user already has a wallet
  const existing = await prisma.wallet.findUnique({
    where: { userId }
  });

  if (existing) {
    throw new Error('User already has a wallet');
  }

  // Check if this public key is already used by another user
  const existingPublicKey = await prisma.wallet.findUnique({
    where: { publicKey }
  });

  if (existingPublicKey) {
    throw new Error('This wallet is already imported by another account');
  }

  return prisma.wallet.create({
    data: { userId, publicKey, encrypted, iv },
  });
}

export async function getWallet(userId: string) {
  return prisma.wallet.findUnique({
    where: { userId },
  });
}

// ==================== POSITION OPERATIONS ====================

export async function createPosition(
  userId: string,
  positionId: string,
  poolAddress: string,
  zbtcAmount: number,
  entryPrice: number
) {
  return prisma.position.create({
    data: {
      userId,
      positionId,
      poolAddress,
      zbtcAmount,
      solAmount: 0,
      entryPrice,
      entryBin: 0,
    },
  });
}

/**
 * Create position with enhanced PnL tracking
 * Records deposit prices, amounts, and transaction history
 */
export async function createPositionWithEnhancedTracking(
  userId: string,
  positionId: string,
  poolAddress: string,
  zbtcAmount: number,
  solAmount: number,
  zbtcPrice: number,
  solPrice: number,
  entryPrice: number,
  entryBin: number
) {
  const depositValueUsd = (zbtcAmount * zbtcPrice) + (solAmount * solPrice);

  console.log('Creating position with enhanced tracking:');
  console.log('  Position ID:', positionId.substring(0, 8) + '...');
  console.log('  Deposit:', zbtcAmount.toFixed(8), 'zBTC +', solAmount.toFixed(4), 'SOL');
  console.log('  Prices: zBTC=$' + zbtcPrice.toFixed(2) + ', SOL=$' + solPrice.toFixed(2));
  console.log('  Deposit Value: $' + depositValueUsd.toFixed(2));

  // Create position with enhanced PnL tracking
  const position = await prisma.position.create({
    data: {
      userId,
      positionId,
      poolAddress,
      zbtcAmount,
      solAmount,
      entryPrice,
      entryBin,
      // Enhanced PnL tracking (snake_case to match Prisma schema)
      deposit_value_usd: depositValueUsd,
      deposit_token_x_price: zbtcPrice,
      deposit_token_y_price: solPrice,
      source: 'telegram',
    },
  });

  // Record deposit transaction (snake_case to match Prisma schema)
  await prisma.position_transactions.create({
    data: {
      position_id: positionId,
      transaction_type: 'deposit',
      timestamp: new Date(),
      token_x_amount: zbtcAmount,
      token_y_amount: solAmount,
      token_x_price: zbtcPrice,
      token_y_price: solPrice,
      usd_value: depositValueUsd,
      notes: 'Position created via Garden Bot',
    },
  });

  console.log('Position created with enhanced tracking');

  return position;
}

export async function getActivePositions(userId: string) {
  return prisma.position.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getClosedPositions(userId: string, limit: number = 10) {
  return prisma.position.findMany({
    where: { userId, isActive: false },
    orderBy: { closedAt: 'desc' },
    take: limit,
  });
}

export async function getPositionStats(userId: string) {
  const positions = await prisma.position.findMany({
    where: { userId, isActive: false },
  });

  const totalPnl = positions.reduce((sum, pos) => sum + (Number(pos.pnlPercent) || 0), 0);
  const avgPnl = positions.length > 0 ? totalPnl / positions.length : 0;
  const winCount = positions.filter(pos => (Number(pos.pnlPercent) || 0) > 0).length;
  const winRate = positions.length > 0 ? (winCount / positions.length) * 100 : 0;

  return {
    totalPositions: positions.length,
    totalPnl,
    avgPnl,
    winRate,
    winCount,
    lossCount: positions.length - winCount,
  };
}

export async function updatePositionLastChecked(positionId: string) {
  return prisma.position.update({
    where: { positionId },
    data: { lastChecked: new Date() },
  });
}

// ==================== POSITION TRACKING ====================

export async function getPositionById(positionId: string) {
  return prisma.position.findUnique({
    where: { positionId },
  });
}

export async function closePositionWithTracking(
  positionId: string,
  zbtcReturned: number,
  solReturned: number,
  exitPrice: number,
  exitBin: number
) {
  const position = await prisma.position.findUnique({
    where: { positionId }
  });

  if (!position) {
    throw new Error('Position not found');
  }

  // Calculate fees
  const zbtcFees = Math.max(0, zbtcReturned - Number(position.zbtcAmount));
  const solFees = Math.max(0, solReturned - Number(position.solAmount));

  // Calculate PnL
  const entryValueUsd = Number(position.zbtcAmount) * Number(position.entryPrice);
  const exitValueUsd = (zbtcReturned * exitPrice) + solReturned;
  const pnlUsd = exitValueUsd - entryValueUsd;
  const pnlPercent = entryValueUsd > 0 ? (pnlUsd / entryValueUsd) * 100 : 0;

  return prisma.position.update({
    where: { positionId },
    data: { 
      isActive: false,
      exitPrice,
      exitBin,
      zbtcReturned,
      solReturned,
      zbtcFees,
      solFees,
      pnlUsd,
      pnlPercent,
      closedAt: new Date()
    },
  });
}

export async function createPositionWithTracking(
  userId: string,
  positionId: string,
  poolAddress: string,
  zbtcAmount: number,
  solAmount: number,
  entryPrice: number,
  entryBin: number
) {
  return prisma.position.create({
    data: {
      userId,
      positionId,
      poolAddress,
      zbtcAmount,
      solAmount,
      entryPrice,
      entryBin,
    },
  });
}

export async function updateUserStats(userId: string) {
  const [positions, active] = await Promise.all([
    prisma.position.findMany({ where: { userId, isActive: false } }),
    prisma.position.count({ where: { userId, isActive: true } })
  ]);

  const totalZbtcFees = positions.reduce((sum, p) => sum + Number(p.zbtcFees || 0), 0);
  const totalSolFees = positions.reduce((sum, p) => sum + Number(p.solFees || 0), 0);
  const totalPnlUsd = positions.reduce((sum, p) => sum + Number(p.pnlUsd || 0), 0);

  return prisma.userStats.upsert({
    where: { userId },
    create: {
      userId,
      totalPositions: positions.length,
      activePositions: active,
      totalZbtcFees,
      totalSolFees,
      totalPnlUsd
    },
    update: {
      totalPositions: positions.length,
      activePositions: active,
      totalZbtcFees,
      totalSolFees,
      totalPnlUsd
    }
  });
}

// ==================== STATISTICS ====================

export async function getStats() {
  const [totalUsers, activeMonitoring, totalPositions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isMonitoring: true } }),
    prisma.position.count({ where: { isActive: true } }),
  ]);

  return { totalUsers, activeMonitoring, totalPositions };
}

// ==================== CLEANUP ====================

export async function disconnect() {
  await prisma.$disconnect();
}