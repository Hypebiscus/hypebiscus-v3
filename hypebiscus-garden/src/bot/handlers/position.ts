import { Context } from 'telegraf';
import { DlmmService } from '../../services/dlmmService';
import { WalletService } from '../../services/walletService';
import { MonitoringService } from '../../services/monitoringService';
import { getOrCreateUser, getActivePositions, getClosedPositions, getPositionStats, updateUserMonitoring } from '../../services/db';
import { backKeyboard } from '../keyboards';
import { safeEditMessageText } from '../../utils/telegramHelpers';

export class PositionHandler {
  constructor(
    private dlmmService: DlmmService,
    private walletService: WalletService,
    private monitoringService: MonitoringService,
    private syncService: any
  ) {}

  async handleCreatePosition(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('❌ Unable to identify user');
      return;
    }

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      if (!user.wallet) {
        await ctx.answerCbQuery('❌ No wallet found');
        await safeEditMessageText(
          ctx,
          '❌ No wallet found. Create a wallet first.',
          backKeyboard
        );
        return;
      }

      await ctx.answerCbQuery('Opening position creator...');
      await safeEditMessageText(
        ctx,
        '💰 **Create Position**\n\n' +
        'How much ZBTC do you want to provide as liquidity?\n\n' +
        'Send amount (e.g., 0.001)',
        backKeyboard
      );

      const session = (ctx as any).session;
      session.waitingForAmount = true;
      session.userId = user.id;

      console.log('✅ Session set for amount input:', session);
    } catch (error) {
      console.error('Error in create position:', error);
      await ctx.answerCbQuery('❌ Failed to open');
      await safeEditMessageText(
        ctx,
        '❌ Failed to start position creation. Try again.',
        backKeyboard
      );
    }
  }

  async handleAmountInput(ctx: Context, amount: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const zbtcAmount = this.parseAndValidateAmount(amount);
    if (!zbtcAmount) {
      await ctx.reply('❌ Invalid amount. Please enter a positive number.');
      return;
    }

    try {
      const user = await this.getUserAndKeypair(telegramId, ctx);
      if (!user) return;

      const validationResult = await this.validateUserBalance(user.id, zbtcAmount);
      if (!validationResult.isValid) {
        await ctx.reply(validationResult.message!, { parse_mode: 'Markdown' });
        return;
      }

      await ctx.reply('🔄 Creating position... This may take a moment.');

      const positionData = await this.createBlockchainPosition(user.keypair, zbtcAmount);
      await this.savePositionToDatabase(user.id, positionData);

      if (!user.isMonitoring) {
        await updateUserMonitoring(user.id, true);
      }

      await this.sendPositionCreatedMessage(ctx, positionData);
      console.log(`✅ Position created for user ${telegramId}: ${positionData.positionId}`);
    } catch (error: any) {
      console.error('Error creating position:', error);
      await this.handlePositionCreationError(ctx, error);
    }
  }

  private parseAndValidateAmount(amount: string): number | null {
    const parsed = parseFloat(amount);
    return (isNaN(parsed) || parsed <= 0) ? null : parsed;
  }

  private async getUserAndKeypair(telegramId: number, ctx: Context) {
    const user = await getOrCreateUser(
      telegramId,
      ctx.from?.username,
      ctx.from?.first_name,
      ctx.from?.last_name
    );

    const userKeypair = await this.walletService.getKeypair(user.id);
    if (!userKeypair) {
      throw new Error('Keypair not found');
    }

    return { id: user.id, keypair: userKeypair, isMonitoring: user.isMonitoring };
  }

  private async validateUserBalance(userId: string, zbtcAmount: number) {
    const balance = await this.walletService.getBalance(userId);
    if (!balance) {
      return {
        isValid: false,
        message: '❌ Failed to get wallet balance. Please try again.'
      };
    }

    if (balance.zbtc < zbtcAmount) {
      return {
        isValid: false,
        message:
          `❌ **Insufficient ZBTC Balance**\n\n` +
          `Required: ${zbtcAmount.toFixed(8)} ZBTC\n` +
          `Available: ${balance.zbtc.toFixed(8)} ZBTC\n\n` +
          `Please fund your wallet or try a smaller amount.`
      };
    }

    if (balance.sol < 0.01) {
      return {
        isValid: false,
        message:
          `⚠️ **Low SOL Balance**\n\n` +
          `Current: ${balance.sol.toFixed(4)} SOL\n` +
          `Recommended: At least 0.01 SOL for transaction fees\n\n` +
          `Please fund your wallet with SOL.`
      };
    }

    return { isValid: true };
  }

  private async createBlockchainPosition(userKeypair: any, zbtcAmount: number) {
    const positionId = await this.dlmmService.createPosition(userKeypair, zbtcAmount);
    const poolStatus = await this.dlmmService.getPoolStatus();

    console.log('📊 Fetching actual position amounts from blockchain...');
    const { fetchPositionAmounts, fetchTokenPrices } = await import('../../utils/priceUtils');

    await this.dlmmService.initializePool();
    const pool = (this.dlmmService as any).pool;

    const actualAmounts = await fetchPositionAmounts(pool, positionId);

    console.log('💰 Fetching token prices...');
    const { zbtcPrice, solPrice } = await fetchTokenPrices(3, poolStatus.currentPrice);

    const depositValueUsd = (actualAmounts.zbtcAmount * zbtcPrice) + (actualAmounts.solAmount * solPrice);

    return {
      positionId,
      poolStatus,
      actualAmounts,
      zbtcPrice,
      solPrice,
      depositValueUsd
    };
  }

  private async savePositionToDatabase(userId: string, positionData: any) {
    const { createPositionWithEnhancedTracking } = await import('../../services/db');
    await createPositionWithEnhancedTracking(
      userId,
      positionData.positionId,
      process.env.ZBTC_SOL_POOL_ADDRESS!,
      positionData.actualAmounts.zbtcAmount,
      positionData.actualAmounts.solAmount,
      positionData.zbtcPrice,
      positionData.solPrice,
      positionData.poolStatus.currentPrice,
      positionData.poolStatus.activeBinId
    );
  }

  private async sendPositionCreatedMessage(ctx: Context, positionData: any) {
    await ctx.reply(
      `✅ **Position Created!**\n\n` +
      `💰 Deposited:\n` +
      `  ${positionData.actualAmounts.zbtcAmount.toFixed(8)} zBTC\n` +
      `  ${positionData.actualAmounts.solAmount.toFixed(4)} SOL\n` +
      `💵 Value: $${positionData.depositValueUsd.toFixed(2)}\n\n` +
      `🆔 Position ID: \`${positionData.positionId.substring(0, 8)}...\`\n` +
      `📊 Entry Price: $${positionData.poolStatus.currentPrice.toFixed(6)}\n` +
      `🔄 Monitoring started automatically`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handlePositionCreationError(ctx: Context, error: any) {
    const insufficientSolError = this.parseInsufficientSolError(error);

    if (insufficientSolError) {
      await ctx.reply(this.formatInsufficientSolMessage(insufficientSolError), { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply(`❌ Failed to create position: ${error.message}`);
  }

  private parseInsufficientSolError(error: any) {
    const insufficientLamportsPattern = /insufficient lamports (\d+),?\s*need (\d+)/i;

    // Method 1: Check error message directly
    const errorMsg = error.message || '';
    let match = errorMsg.match(insufficientLamportsPattern);
    if (match) return this.parseLamportsMatch(match);

    // Method 2: Check transaction logs
    const errorLogs = error.transactionLogs || error.logs || [];
    if (Array.isArray(errorLogs)) {
      for (const log of errorLogs) {
        if (typeof log === 'string') {
          match = log.match(insufficientLamportsPattern);
          if (match) return this.parseLamportsMatch(match);
        }
      }
    }

    // Method 3: Check stringified error
    const errorStr = JSON.stringify(error);
    match = errorStr.match(insufficientLamportsPattern);
    if (match) return this.parseLamportsMatch(match);

    return null;
  }

  private parseLamportsMatch(match: RegExpMatchArray) {
    const currentLamports = parseInt(match[1]);
    const requiredLamports = parseInt(match[2]);
    const currentSol = currentLamports / 1_000_000_000;
    const requiredSol = requiredLamports / 1_000_000_000;
    const neededSol = (requiredLamports - currentLamports) / 1_000_000_000;

    console.log(`💡 Detected insufficient SOL: current=${currentSol.toFixed(4)}, needed=${neededSol.toFixed(4)}`);

    return { currentSol, requiredSol, neededSol };
  }

  private formatInsufficientSolMessage(solError: { currentSol: number; requiredSol: number; neededSol: number }) {
    return (
      `⚠️ **Insufficient SOL Balance**\n\n` +
      `Your wallet doesn't have enough SOL for this transaction.\n\n` +
      `💰 Current: ${solError.currentSol.toFixed(4)} SOL\n` +
      `💳 Required: ${solError.requiredSol.toFixed(4)} SOL\n` +
      `📥 Need: ${solError.neededSol.toFixed(4)} SOL more\n\n` +
      `Please fund your wallet with SOL and try again.`
    );
  }

  async handleViewPositions(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('❌ Unable to identify user');
      return;
    }

    try {
      await ctx.answerCbQuery('Loading positions...');

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      await this.syncService.syncUserPositions(user.id);
      const positions = await getActivePositions(user.id);

      if (positions.length === 0) {
        await safeEditMessageText(
          ctx,
          '📊 No active positions found.\n\nCreate your first position to start!',
          backKeyboard
        );
        return;
      }

      let message = '📊 **Your Positions**\n\n';

      for (const [index, position] of positions.entries()) {
        message += `${index + 1}. 💰 ${position.zbtcAmount} ZBTC\n`;
        message += `   🆔 \`${position.positionId.substring(0, 8)}...\`\n`;
        message += `   📊 Entry: $${Number(position.entryPrice).toFixed(6)}\n`;
        message += `   📅 Created: ${new Date(position.createdAt).toLocaleDateString()}\n\n`;
      }

      await safeEditMessageText(ctx, message, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error viewing positions:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to get positions. Try again.',
        backKeyboard
      );
    }
  }

  async handleToggleMonitoring(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('❌ Unable to identify user');
      return;
    }

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const positions = await getActivePositions(user.id);

      if (positions.length === 0) {
        await ctx.answerCbQuery('❌ No positions found');
        await safeEditMessageText(
          ctx,
          '❌ No positions found to monitor.',
          backKeyboard
        );
        return;
      }

      const newStatus = !user.isMonitoring;
      await updateUserMonitoring(user.id, newStatus);

      const status = newStatus ? '✅ ON' : '❌ OFF';
      await safeEditMessageText(
        ctx,
        `🔄 **Monitoring Status: ${status}**\n\n` +
        `Positions: ${positions.length}\n` +
        `Auto-repositioning: ${newStatus ? 'Enabled' : 'Disabled'}`,
        backKeyboard
      );

      // Answer callback to prevent Telegram from retrying
      await ctx.answerCbQuery(newStatus ? '✅ Monitoring enabled' : '⏸️ Monitoring disabled');

      console.log(`📊 User ${telegramId} monitoring toggled: ${newStatus}`);
    } catch (error) {
      console.error('Error toggling monitoring:', error);
      await ctx.answerCbQuery('❌ Toggle failed');
      await safeEditMessageText(
        ctx,
        '❌ Failed to toggle monitoring. Try again.',
        backKeyboard
      );
    }
  }

  async handleViewHistory(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('❌ Unable to identify user');
      return;
    }

    try {
      await ctx.answerCbQuery('Loading history...');

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const closedPositions = await getClosedPositions(user.id, 10);
      const stats = await getPositionStats(user.id);

      if (closedPositions.length === 0) {
        await safeEditMessageText(
          ctx,
          '📊 No closed positions found.',
          backKeyboard
        );
        return;
      }

      let message = '📜 **Position History (Last 10)**\n\n';
      message += `📊 **Overall Stats:**\n`;
      message += `✅ Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winCount}W/${stats.lossCount}L)\n`;
      message += `💰 Avg PnL: ${stats.avgPnl.toFixed(2)}%\n\n`;

      for (const [index, position] of closedPositions.entries()) {
        const pnl = Number(position.pnlPercent) || 0;
        const pnlUsd = Number(position.pnlUsd) || 0;
        const pnlEmoji = pnl >= 0 ? '✅' : '❌';
        const pnlSign = pnl >= 0 ? '+' : '';

        message += `${index + 1}. ${pnlEmoji} ${pnlSign}${pnl.toFixed(2)}% (${pnlSign}$${pnlUsd.toFixed(2)})\n`;
        message += `   💰 ${position.zbtcAmount} ZBTC\n`;
        message += `   📊 Entry: $${Number(position.entryPrice).toFixed(2)}\n`;
        message += `   📊 Exit: $${Number(position.exitPrice || 0).toFixed(2)}\n`;
        if (position.zbtcFees || position.solFees) {
          message += `   💸 Fees: ${Number(position.zbtcFees || 0).toFixed(6)} ZBTC + ${Number(position.solFees || 0).toFixed(4)} SOL\n`;
        }
        message += `   📅 ${new Date(position.createdAt).toLocaleDateString()}\n\n`;
      }

      await safeEditMessageText(ctx, message, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error viewing history:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to get history. Try again.',
        backKeyboard
      );
    }
  }

  async handleClosePosition(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('❌ Unable to identify user');
      return;
    }

    try {
      await ctx.answerCbQuery('Loading positions...');

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      if (!user.wallet) {
        await safeEditMessageText(
          ctx,
          '❌ No wallet found. Create a wallet first.',
          backKeyboard
        );
        return;
      }

      const activePositions = await getActivePositions(user.id);

      if (activePositions.length === 0) {
        await safeEditMessageText(
          ctx,
          '❌ No active positions to close.',
          backKeyboard
        );
        return;
      }

      const { Markup } = await import('telegraf');
      const buttons = activePositions.map((pos, index) => {
        return [
          Markup.button.callback(
            `Close Position ${index + 1}: ${Number(pos.zbtcAmount).toFixed(6)} ZBTC`,
            `close_pos_${pos.positionId}`
          )
        ];
      });

      buttons.push([Markup.button.callback('⬅️ Back', 'main_menu')]);

      await safeEditMessageText(
        ctx,
        '🔴 **Close Position**\n\n' +
        'Select a position to close:\n\n' +
        '⚠️ This will remove your liquidity immediately.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (error) {
      console.error('Error in close position:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to load positions. Try again.',
        backKeyboard
      );
    }
  }

  async handleConfirmClosePosition(ctx: Context, positionId: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const positions = await getActivePositions(user.id);
      const position = positions.find(p => p.positionId === positionId);

      if (!position) {
        await safeEditMessageText(
          ctx,
          '❌ Position not found or already closed.',
          backKeyboard
        );
        return;
      }

      const { Markup } = await import('telegraf');
      await safeEditMessageText(
        ctx,
        `⚠️ **Confirm Close Position**\n\n` +
        `💰 Amount: ${position.zbtcAmount} ZBTC\n` +
        `📊 Entry Price: $${Number(position.entryPrice).toFixed(2)}\n` +
        `📅 Created: ${new Date(position.createdAt).toLocaleDateString()}\n\n` +
        `Are you sure you want to close this position?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Yes, Close It', `confirm_close_${positionId}`),
            ],
            [
              Markup.button.callback('❌ Cancel', 'view_positions')
            ]
          ])
        }
      );
    } catch (error) {
      console.error('Error in confirm close:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to load position details.',
        backKeyboard
      );
    }
  }

  async handleExecuteClose(ctx: Context, positionId: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      await safeEditMessageText(
        ctx,
        '🔄 Closing position...\n\nThis may take 30-60 seconds.'
      );

      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const userKeypair = await this.walletService.getKeypair(user.id);
      if (!userKeypair) {
        throw new Error('Keypair not found');
      }

      const positions = await getActivePositions(user.id);
      const position = positions.find(p => p.positionId === positionId);

      if (!position) {
        throw new Error('Position not found');
      }

      /**
       * POSITION CLOSING FLOW (Garden Bot + MCP Integration)
       * =====================================================
       *
       * The flow is split between Garden Bot and MCP Server:
       *
       * GARDEN BOT (this code):
       * - Step 1: Close position on Solana blockchain via Meteora DLMM SDK
       *   - Removes 100% liquidity from all bins
       *   - Claims accumulated swap fees
       *   - Closes position account on-chain
       *   - Returns tokens to user's wallet
       *
       * MCP SERVER (remote):
       * - Step 2: Calculate production-grade PnL using:
       *   - Deposit prices (from database, recorded at creation)
       *   - Current prices (from Jupiter/Birdeye APIs)
       *   - Fees earned (from blockchain + database)
       *   - Rewards earned (from blockchain)
       * - Step 3: Update database with final PnL values
       * - Step 4: Return structured PnL data to display to user
       *
       * Why separate?
       * - Blockchain ops require user's private key (Garden Bot has it)
       * - PnL calculation requires accurate price data (MCP has better APIs)
       * - Database updates centralized in one place (MCP manages data layer)
       * - MCP can be reused by web app, other bots, analytics, etc.
       */

      // Step 1: Close position on blockchain (Garden Bot handles this)
      console.log('🔴 Closing position on blockchain...');
      await this.dlmmService.closePosition(userKeypair, positionId);

      // Wait for blockchain confirmation (tx needs time to finalize)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 2: Call MCP server to calculate PnL and update database
      // Note: MCP does NOT touch blockchain - position is already closed above
      console.log('📊 Calling MCP server for PnL calculation...');
      console.log('📝 Position ID:', positionId);
      console.log('📝 Wallet Address:', user.wallet!.publicKey);

      const { mcpClient } = await import('../../services/mcpClient');

      // This calls MCP's close_position tool with closeOnBlockchain=false
      // MCP will: fetch current prices, calculate PnL, update database, return results
      const result = await mcpClient.closePosition(
        positionId,
        user.wallet!.publicKey
        // transactionSignature is optional, we don't have it from closePosition
      );

      // Step 3: Display enhanced PnL breakdown
      const pnl = result.pnl;
      const pnlSign = pnl.realizedPnlUsd >= 0 ? '+' : '';
      const pnlEmoji = pnl.realizedPnlUsd >= 0 ? '📈' : '📉';
      const ilEmoji = pnl.impermanentLoss.usd > 0 ? '⚠️' : '✅';

      await safeEditMessageText(
        ctx,
        `✅ **Position Closed Successfully!**\n\n` +
        `${pnlEmoji} **PnL:** ${pnlSign}$${pnl.realizedPnlUsd.toFixed(2)} (${pnlSign}${pnl.realizedPnlPercent.toFixed(2)}%)\n\n` +
        `💰 **Withdrawn:**\n` +
        `  ${pnl.current.tokenX.amount.toFixed(8)} zBTC\n` +
        `  ${pnl.current.tokenY.amount.toFixed(4)} SOL\n` +
        `  Value: $${pnl.currentValueUsd.toFixed(2)}\n\n` +
        `💸 **Fees Earned:** $${pnl.feesEarnedUsd.toFixed(2)}\n` +
        `${ilEmoji} **Impermanent Loss:** $${pnl.impermanentLoss.usd.toFixed(2)} (${pnl.impermanentLoss.percent.toFixed(2)}%)\n\n` +
        `Your funds are now in your wallet.`,
        {
          parse_mode: 'Markdown',
          ...backKeyboard
        }
      );

      console.log(`✅ Position closed via MCP: ${positionId}, PnL: $${pnl.realizedPnlUsd.toFixed(2)}`);
    } catch (error: any) {
      console.error('Error closing position:', error);

      // Detect network-related errors
      const isNetworkError = error.message?.includes('fetch failed') ||
                            error.message?.includes('ENOTFOUND') ||
                            error.message?.includes('ETIMEDOUT') ||
                            error.message?.includes('ECONNREFUSED');

      let errorMsg = `❌ **Failed to close position**\n\n`;

      if (isNetworkError) {
        errorMsg += `⚠️ **Network connectivity issue detected**\n\n` +
                   `Unable to connect to Solana RPC endpoint.\n` +
                   `This may be due to:\n` +
                   `• DNS resolution problems\n` +
                   `• Network firewall blocking connections\n` +
                   `• RPC endpoint temporarily unavailable\n\n` +
                   `**Tip:** Position may have been created successfully.\n` +
                   `Try waiting 10-30 seconds before closing.\n\n` +
                   `If the issue persists, check your network connection.`;
      } else {
        errorMsg += `Error: ${error.message}\n\n` +
                   `Please try again or contact support.`;
      }

      await safeEditMessageText(ctx, errorMsg, backKeyboard);
    }
  }
}