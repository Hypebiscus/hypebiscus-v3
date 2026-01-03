// src/bot/handlers/monitoring.ts
import { Context } from 'telegraf';
import { DlmmService } from '../../services/dlmmService';
import { MonitoringService } from '../../services/monitoringService';
import { getOrCreateUser, updateUserMonitoring, getActivePositions } from '../../services/db';
import { backKeyboard } from '../keyboards';
import { safeEditMessageText } from '../../utils/telegramHelpers';

export class MonitoringHandler {
  constructor(
    private dlmmService: DlmmService,
    private monitoringService: MonitoringService
  ) {}

  /**
   * Handle monitoring status check
   */
  async handleMonitoringStatus(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );
      
      const activePositions = await getActivePositions(user.id);
      const status = this.monitoringService.getStatus();
      const poolStatus = await this.dlmmService.getPoolStatus();

      const statusMessage = `📊 **Monitoring Status**

👤 **Your Account:**
🔄 Monitoring: ${user.isMonitoring ? '✅ Active' : '❌ Inactive'}
📍 Active Positions: ${activePositions.length}

🤖 **Bot Status:**
🔄 System Status: ${status.isMonitoring ? '✅ Running' : '❌ Stopped'}

💰 **ZBTC-SOL Pool:**
📈 Current Price: $${poolStatus.currentPrice.toFixed(6)}
🆔 Active Bin: ${poolStatus.activeBinId}
📊 24h Change: ${poolStatus.priceChange24h.toFixed(2)}%

🕒 Last Updated: ${new Date().toLocaleTimeString()}`;

      await safeEditMessageText(ctx, statusMessage, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error getting monitoring status:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to get monitoring status. Try again later.',
        backKeyboard
      );
    }
  }

  /**
   * Handle toggling monitoring on/off for user
   */
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

      // Check if user has any positions
      const activePositions = await getActivePositions(user.id);
      if (activePositions.length === 0) {
        await safeEditMessageText(
          ctx,
          '❌ No active positions found.\n\nCreate a position first before enabling monitoring.',
          backKeyboard
        );
        return;
      }

      // Toggle monitoring status in database
      const newStatus = !user.isMonitoring;
      await updateUserMonitoring(user.id, newStatus);

      if (newStatus) {
        await safeEditMessageText(
          ctx,
          `✅ **Monitoring Enabled**\n\n` +
          `🔄 Your ${activePositions.length} position(s) are now being monitored 24/7.\n\n` +
          `📱 You'll receive notifications when:\n` +
          `• Position goes out of range\n` +
          `• Auto-repositioning occurs\n` +
          `• Errors need attention`,
          {
            parse_mode: 'Markdown',
            ...backKeyboard
          }
        );
      } else {
        await safeEditMessageText(
          ctx,
          `❌ **Monitoring Disabled**\n\n` +
          `⏸️ Your positions are no longer being monitored.\n\n` +
          `⚠️ No automatic repositioning will occur until you re-enable monitoring.`,
          {
            parse_mode: 'Markdown',
            ...backKeyboard
          }
        );
      }

      console.log(`📊 User ${telegramId} monitoring: ${newStatus ? 'ON' : 'OFF'}`);
    } catch (error) {
      console.error('Error toggling monitoring:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to toggle monitoring. Please try again.',
        backKeyboard
      );
    }
  }

  /**
   * Handle manual position check
   */
  async handleCheckPositions(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const activePositions = await getActivePositions(user.id);

      if (activePositions.length === 0) {
        await safeEditMessageText(
          ctx,
          '❌ No positions found to check.',
          backKeyboard
        );
        return;
      }

      await safeEditMessageText(ctx, '🔄 Checking all positions... Please wait.');

      const poolStatus = await this.dlmmService.getPoolStatus();

      let message = `🔍 **Position Check Results**\n\n` +
        `📊 Current Price: $${poolStatus.currentPrice.toFixed(6)}\n` +
        `🕒 Check Time: ${new Date().toLocaleTimeString()}\n\n`;

      for (const [index, position] of activePositions.entries()) {
        try {
          const isOutOfRange = await this.dlmmService.isPositionOutOfRange(position.positionId);
          const rangeStatus = isOutOfRange ? '❌ Out of Range' : '✅ In Range';

          message += `**Position ${index + 1}:**\n`;
          message += `🆔 \`${position.positionId.substring(0, 8)}...\`\n`;
          message += `💰 Amount: ${position.zbtcAmount} ZBTC\n`;
          message += `📊 Status: ${rangeStatus}\n`;
          message += `📅 Created: ${new Date(position.createdAt).toLocaleDateString()}\n\n`;
        } catch (error) {
          message += `**Position ${index + 1}:**\n`;
          message += `🆔 \`${position.positionId.substring(0, 8)}...\`\n`;
          message += `❌ Error checking position\n\n`;
        }
      }

      await safeEditMessageText(ctx, message, {
        parse_mode: 'Markdown',
        ...backKeyboard
      });
    } catch (error) {
      console.error('Error checking positions:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to check positions. Please try again.',
        backKeyboard
      );
    }
  }

  /**
   * Handle emergency stop for monitoring
   */
  async handleEmergencyStop(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      // Disable monitoring for this user
      await updateUserMonitoring(user.id, false);

      await safeEditMessageText(
        ctx,
        `🛑 **Emergency Stop Activated**\n\n` +
        `⏹️ All monitoring stopped for your account.\n` +
        `⚠️ No automatic actions will be taken.\n` +
        `💰 Your positions remain active but unmonitored.\n\n` +
        `🔄 Use "Toggle Monitoring" to resume when ready.`,
        {
          parse_mode: 'Markdown',
          ...backKeyboard
        }
      );

      console.log(`🛑 Emergency stop activated for user ${telegramId}`);
    } catch (error) {
      console.error('Error in emergency stop:', error);
      await safeEditMessageText(
        ctx,
        '❌ Failed to execute emergency stop. Please try again.',
        backKeyboard
      );
    }
  }
}