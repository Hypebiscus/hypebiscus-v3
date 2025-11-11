import { Context } from 'telegraf';
import { Position } from '@prisma/client';
import { DlmmService } from '../../services/dlmmService';
import { WalletService } from '../../services/walletService';
import { MonitoringService } from '../../services/monitoringService';
import { getOrCreateUser, getActivePositions, getClosedPositions, getPositionStats, createPosition, updateUserMonitoring, closePositionWithTracking } from '../../services/db';
import { backKeyboard } from '../keyboards';

export class PositionHandler {
  constructor(
    private dlmmService: DlmmService,
    private walletService: WalletService,
    private monitoringService: MonitoringService,
    private syncService: any
  ) {}

  async handleCreatePosition(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      if (!user.wallet) {
        await ctx.editMessageText(
          '❌ No wallet found. Create a wallet first.',
          backKeyboard
        );
        return;
      }

      await ctx.editMessageText(
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
      await ctx.editMessageText(
        '❌ Failed to start position creation. Try again.',
        backKeyboard
      );
    }
  }

  async handleAmountInput(ctx: Context, amount: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const zbtcAmount = parseFloat(amount);
    if (isNaN(zbtcAmount) || zbtcAmount <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a positive number.');
      return;
    }

    try {
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

      const balance = await this.walletService.getBalance(user.id);
      if (!balance) {
        await ctx.reply('❌ Failed to get wallet balance. Please try again.');
        return;
      }

      if (balance.zbtc < zbtcAmount) {
        await ctx.reply(
          `❌ **Insufficient ZBTC Balance**\n\n` +
          `Required: ${zbtcAmount.toFixed(8)} ZBTC\n` +
          `Available: ${balance.zbtc.toFixed(8)} ZBTC\n\n` +
          `Please fund your wallet or try a smaller amount.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (balance.sol < 0.01) {
        await ctx.reply(
          `⚠️ **Low SOL Balance**\n\n` +
          `Current: ${balance.sol.toFixed(4)} SOL\n` +
          `Recommended: At least 0.01 SOL for transaction fees\n\n` +
          `Please fund your wallet with SOL.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await ctx.reply('🔄 Creating position... This may take a moment.');

      const positionId = await this.dlmmService.createPosition(userKeypair, zbtcAmount);
      const poolStatus = await this.dlmmService.getPoolStatus();

      await createPosition(
        user.id,
        positionId,
        process.env.ZBTC_SOL_POOL_ADDRESS!,
        zbtcAmount,
        poolStatus.currentPrice
      );

      if (!user.isMonitoring) {
        await updateUserMonitoring(user.id, true);
      }

      await ctx.reply(
        `✅ **Position Created!**\n\n` +
        `💰 Amount: ${zbtcAmount} ZBTC\n` +
        `🆔 Position ID: \`${positionId.substring(0, 8)}...\`\n` +
        `📊 Entry Price: $${poolStatus.currentPrice.toFixed(6)}\n` +
        `🔄 Monitoring started automatically`,
        { parse_mode: 'Markdown' }
      );

      console.log(`✅ Position created for user ${telegramId}: ${positionId}`);
    } catch (error: any) {
      console.error('Error creating position:', error);
      await ctx.reply(`❌ Failed to create position: ${error.message}`);
    }
  }

  async handleViewPositions(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      await this.syncService.syncUserPositions(user.id);
      const positions = await getActivePositions(user.id);

      if (positions.length === 0) {
        await ctx.editMessageText(
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

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error viewing positions:', error);
      await ctx.editMessageText(
        '❌ Failed to get positions. Try again.',
        backKeyboard
      );
    }
  }

  async handleToggleMonitoring(ctx: Context): Promise<void> {
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

      if (positions.length === 0) {
        await ctx.editMessageText(
          '❌ No positions found to monitor.',
          backKeyboard
        );
        return;
      }

      const newStatus = !user.isMonitoring;
      await updateUserMonitoring(user.id, newStatus);

      const status = newStatus ? '✅ ON' : '❌ OFF';
      await ctx.editMessageText(
        `🔄 **Monitoring Status: ${status}**\n\n` +
        `Positions: ${positions.length}\n` +
        `Auto-repositioning: ${newStatus ? 'Enabled' : 'Disabled'}`,
        backKeyboard
      );

      console.log(`📊 User ${telegramId} monitoring toggled: ${newStatus}`);
    } catch (error) {
      console.error('Error toggling monitoring:', error);
      await ctx.editMessageText(
        '❌ Failed to toggle monitoring. Try again.',
        backKeyboard
      );
    }
  }

  async handleViewHistory(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const closedPositions = await getClosedPositions(user.id, 10);
      const stats = await getPositionStats(user.id);

      if (closedPositions.length === 0) {
        await ctx.editMessageText(
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

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error viewing history:', error);
      await ctx.editMessageText(
        '❌ Failed to get history. Try again.',
        backKeyboard
      );
    }
  }

  async handleClosePosition(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      if (!user.wallet) {
        await ctx.editMessageText(
          '❌ No wallet found. Create a wallet first.',
          backKeyboard
        );
        return;
      }

      const activePositions = await getActivePositions(user.id);

      if (activePositions.length === 0) {
        await ctx.editMessageText(
          '❌ No active positions to close.',
          backKeyboard
        );
        return;
      }

      const { Markup } = await import('telegraf');
      const buttons = activePositions.map((pos: Position, index: number) => {
        return [
          Markup.button.callback(
            `Close Position ${index + 1}: ${Number(pos.zbtcAmount).toFixed(6)} ZBTC`,
            `close_pos_${pos.positionId}`
          )
        ];
      });

      buttons.push([Markup.button.callback('⬅️ Back', 'main_menu')]);

      await ctx.editMessageText(
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
      await ctx.editMessageText(
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
      const position = positions.find((p: Position) => p.positionId === positionId);

      if (!position) {
        await ctx.editMessageText(
          '❌ Position not found or already closed.',
          backKeyboard
        );
        return;
      }

      const { Markup } = await import('telegraf');
      await ctx.editMessageText(
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
      await ctx.editMessageText(
        '❌ Failed to load position details.',
        backKeyboard
      );
    }
  }

  async handleExecuteClose(ctx: Context, positionId: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      await ctx.editMessageText(
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
      const position = positions.find((p: Position) => p.positionId === positionId);

      if (!position) {
        throw new Error('Position not found');
      }

      const poolStatus = await this.dlmmService.getPoolStatus();

      await this.dlmmService.closePosition(userKeypair, positionId);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const zbtcReturned = Number(position.zbtcAmount);
      const solReturned = Number(position.solAmount);

      await closePositionWithTracking(
        positionId,
        zbtcReturned,
        solReturned,
        poolStatus.currentPrice,
        poolStatus.activeBinId
      );

      await ctx.editMessageText(
        `✅ **Position Closed Successfully!**\n\n` +
        `💰 Returned: ${zbtcReturned.toFixed(6)} ZBTC + ${solReturned.toFixed(4)} SOL\n` +
        `📊 Exit Price: $${poolStatus.currentPrice.toFixed(2)}\n\n` +
        `Your funds are now in your wallet.`,
        {
          parse_mode: 'Markdown',
          ...backKeyboard
        }
      );

      console.log(`✅ Position closed manually by user ${telegramId}: ${positionId}`);
    } catch (error: any) {
      console.error('Error closing position:', error);
      await ctx.editMessageText(
        `❌ **Failed to close position**\n\n` +
        `Error: ${error.message}\n\n` +
        `Please try again or contact support.`,
        backKeyboard
      );
    }
  }
}