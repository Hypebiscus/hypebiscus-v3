// src/index.ts
// CRITICAL: Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

// NOW import everything else
import { TelegramBotWebhook as TelegramBot } from './bot/bot-webhook';
import { prisma } from './services/db';

// Validate required environment variables
const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN',
  'SOLANA_RPC_URL',
  'ZBTC_SOL_POOL_ADDRESS',
  'ZBTC_MINT_ADDRESS',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'PORT',
  'WEBHOOK_DOMAIN'
];

console.log('🔍 Checking environment variables...');
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error(`\n📋 Current .env status:`);
    console.error(`   TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.error(`   SOLANA_RPC_URL: ${process.env.SOLANA_RPC_URL ? '✅ Set' : '❌ Missing'}`);
    console.error(`   ZBTC_SOL_POOL_ADDRESS: ${process.env.ZBTC_SOL_POOL_ADDRESS ? '✅ Set' : '❌ Missing'}`);
    console.error(`   ZBTC_MINT_ADDRESS: ${process.env.ZBTC_MINT_ADDRESS ? '✅ Set' : '❌ Missing'}`);
    console.error(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'}`);
    console.error(`   ENCRYPTION_KEY: ${process.env.ENCRYPTION_KEY ? '✅ Set' : '❌ Missing'}`);
    console.error(`   PORT: ${process.env.PORT ? '✅ Set' : '❌ Missing'}`);
    console.error(`   WEBHOOK_DOMAIN: ${process.env.WEBHOOK_DOMAIN ? '✅ Set' : '❌ Missing'}`);
    process.exit(1);
  }
}

// Validate encryption key format
if (process.env.ENCRYPTION_KEY!.length !== 64) {
  console.error('❌ ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

console.log('✅ All environment variables validated\n');

async function main() {
  console.log('🚀 Starting Garden ZBTC-SOL DLMM Bot...\n');

  // Check database connection
  console.log('🔄 Checking database connection...');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connected successfully\n');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('Check your DATABASE_URL in .env file');
    process.exit(1);
  }

  // Initialize and start bot
  console.log('🤖 Initializing Telegram bot...');
  const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN!,
    process.env.SOLANA_RPC_URL!,
    process.env.WEBHOOK_DOMAIN!,
    parseInt(process.env.PORT || '10000', 10)
  );

  await bot.start();
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Error handlers
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await prisma.$disconnect();
  process.exit(1);
});

// Start application
main().catch(async (error) => {
  console.error('❌ Failed to start application:', error);
  await prisma.$disconnect();
  process.exit(1);
});