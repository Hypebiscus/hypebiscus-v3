/**
 * Settings Handler - Manage auto-reposition settings and subscription
 *
 * Commands:
 * - /settings - View and edit reposition settings
 * - /enableauto - Enable auto-repositioning
 * - /disableauto - Disable auto-repositioning
 * - /subscribe - Subscribe to premium plan
 */

import { Context } from 'telegraf';
import { mcpClient } from '../../utils/mcpClient';
import { getOrCreateUser } from '../../services/db';

// Type definitions for settings response
interface RepositionSettings {
  autoRepositionEnabled: boolean;
  urgencyThreshold: string;
  maxGasCostSol: number;
  minFeesToCollectUsd: number;
  allowedStrategies: string[];
  telegramNotifications: boolean;
  websiteNotifications: boolean;
}

/**
 * Handle /settings command - View and edit settings
 */
export async function handleSettingsCommand(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Unable to identify user');
    return;
  }

  try {
    // Check if wallet is linked
    const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());

    if (!linkedAccount.isLinked || !linkedAccount.walletAddress) {
      await ctx.reply(
        '❌ **No Wallet Linked**\n\n' +
        'You need to link your website wallet to manage settings.\n\n' +
        'Use `/link` command or scan the QR code on the website.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Get current settings
    const settings = await mcpClient.getRepositionSettings(telegramId.toString()) as RepositionSettings;

    // Check subscription/credits status
    const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress);
    const creditBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress);

    // Payment status section
    let paymentStatus = '';
    if (subscriptionStatus.isActive) {
      paymentStatus =
        '✅ **Subscription Active**\n' +
        `Tier: ${subscriptionStatus.tier}\n` +
        `Expires: ${new Date(subscriptionStatus.expiresAt!).toLocaleDateString()}\n` +
        `Days Remaining: ${subscriptionStatus.daysRemaining}\n`;
    } else if (creditBalance.balance > 0) {
      paymentStatus =
        '💳 **Pay-per-use Credits**\n' +
        `Balance: ${creditBalance.balance} credits\n` +
        `Repositions Available: ${Math.floor(creditBalance.balance / 1)}\n`;
    } else {
      paymentStatus =
        '⚠️ **No Active Payment**\n' +
        'You need a subscription or credits for auto-reposition.\n';
    }

    const settingsMessage =
      '⚙️ **Auto-Reposition Settings**\n\n' +
      '**Payment Status:**\n' +
      paymentStatus +
      '\n**Settings:**\n' +
      `🔄 Auto-Reposition: ${settings.autoRepositionEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
      `⚡ Urgency Threshold: ${settings.urgencyThreshold.toUpperCase()}\n` +
      `⛽ Max Gas Cost: ${settings.maxGasCostSol} SOL\n` +
      `💰 Min Fees to Collect: $${settings.minFeesToCollectUsd}\n` +
      `📊 Allowed Strategies: ${settings.allowedStrategies.join(', ')}\n\n` +
      '**Notifications:**\n' +
      `📱 Telegram: ${settings.telegramNotifications ? '✅ On' : '❌ Off'}\n` +
      `🌐 Website: ${settings.websiteNotifications ? '✅ On' : '❌ Off'}\n\n` +
      '**Quick Commands:**\n' +
      `/enableauto - Enable auto-repositioning\n` +
      `/disableauto - Disable auto-repositioning\n` +
      `/subscribe - Get unlimited repositions\n` +
      `/credits - Check credit balance\n` +
      `/topup - Purchase credits`;

    await ctx.reply(settingsMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: settings.autoRepositionEnabled ? '❌ Disable Auto' : '✅ Enable Auto',
              callback_data: settings.autoRepositionEnabled ? 'disable_auto' : 'enable_auto',
            },
          ],
          [
            {
              text: '⚡ Change Threshold',
              callback_data: 'change_threshold',
            },
            {
              text: '⛽ Change Gas Limit',
              callback_data: 'change_gas',
            },
          ],
          [
            {
              text: '🔔 Toggle Notifications',
              callback_data: 'toggle_notifications',
            },
          ],
          [
            {
              text: subscriptionStatus.isActive ? '✅ Subscribed' : '💳 Subscribe',
              callback_data: 'subscribe',
            },
            {
              text: '🔄 Refresh',
              callback_data: 'refresh_settings',
            },
          ],
        ],
      },
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    await ctx.reply('❌ Failed to fetch settings. Try again later.');
  }
}

/**
 * Handle /enableauto command
 */
export async function handleEnableAutoCommand(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Unable to identify user');
    return;
  }

  try {
    // Check if wallet is linked
    const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());

    if (!linkedAccount.isLinked) {
      await ctx.reply(
        '❌ **No Wallet Linked**\n\n' +
        'Link your wallet first to enable auto-repositioning.\n\n' +
        'Use `/link` command.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Check payment status
    const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress!);
    const creditBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress!);

    if (!subscriptionStatus.isActive && creditBalance.balance === 0) {
      await ctx.reply(
        '⚠️ **Payment Required**\n\n' +
        'You need a subscription or credits to enable auto-repositioning.\n\n' +
        '**Options:**\n' +
        '• `/subscribe` - $4.99/month for unlimited repositions\n' +
        '• `/topup` - $0.01 USDC per reposition (pay-as-you-go)',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Enable auto-reposition
    await mcpClient.updateRepositionSettings(telegramId.toString(), {
      autoRepositionEnabled: true,
    });

    await ctx.reply(
      '✅ **Auto-Reposition Enabled**\n\n' +
      'Your positions will now be automatically repositioned when out of range.\n\n' +
      `${subscriptionStatus.isActive
        ? '🎉 Unlimited repositions (subscription active)'
        : `💳 Cost: 1 credit per reposition (${creditBalance.balance} credits available)`
      }\n\n` +
      'Use `/settings` to view or change settings.\n' +
      'Use `/disableauto` to turn it off.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error enabling auto-reposition:', error);
    await ctx.reply('❌ Failed to enable auto-reposition. Try again.');
  }
}

/**
 * Handle /disableauto command
 */
export async function handleDisableAutoCommand(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Unable to identify user');
    return;
  }

  try {
    // Check if wallet is linked
    const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());

    if (!linkedAccount.isLinked) {
      await ctx.reply(
        '❌ **No Wallet Linked**\n\n' +
        'Link your wallet first.\n\n' +
        'Use `/link` command.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Disable auto-reposition
    await mcpClient.updateRepositionSettings(telegramId.toString(), {
      autoRepositionEnabled: false,
    });

    await ctx.reply(
      '⏸️ **Auto-Reposition Disabled**\n\n' +
      'Your positions will no longer be automatically repositioned.\n\n' +
      '**What this means:**\n' +
      '• You\'ll still get alerts when positions go out of range\n' +
      '• You\'ll need to manually reposition\n' +
      '• No credits or subscription usage\n\n' +
      'Use `/enableauto` to turn it back on.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error disabling auto-reposition:', error);
    await ctx.reply('❌ Failed to disable auto-reposition. Try again.');
  }
}

/**
 * Handle /subscribe command
 */
export async function handleSubscribeCommand(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply('❌ Unable to identify user');
    return;
  }

  try {
    // Check if wallet is linked
    const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());

    if (!linkedAccount.isLinked || !linkedAccount.walletAddress) {
      await ctx.reply(
        '❌ **No Wallet Linked**\n\n' +
        'You need to link your website wallet to subscribe.\n\n' +
        'Steps:\n' +
        '1. Visit https://hypebiscus.com\n' +
        '2. Connect your wallet\n' +
        '3. Go to Settings → Link Telegram\n' +
        '4. Scan the QR code or use the link code',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Check if already subscribed
    const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress);

    if (subscriptionStatus.isActive) {
      await ctx.reply(
        '✅ **Already Subscribed!**\n\n' +
        `Tier: ${subscriptionStatus.tier}\n` +
        `Expires: ${new Date(subscriptionStatus.expiresAt!).toLocaleDateString()}\n` +
        `Days Remaining: ${subscriptionStatus.daysRemaining}\n\n` +
        '🎉 You have unlimited auto-repositions!',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Generate subscription link
    const websiteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hypebiscus.com';
    const subscribeUrl = `${websiteUrl}/subscribe?wallet=${linkedAccount.walletAddress}`;

    await ctx.reply(
      '💎 **Subscribe to Premium**\n\n' +
      '**Benefits:**\n' +
      '✅ Unlimited auto-repositions\n' +
      '✅ Priority monitoring\n' +
      '✅ Advanced analytics\n' +
      '✅ 24/7 support\n\n' +
      '💰 **Price:** $4.99 USDC/month\n' +
      '🔄 **Billing:** Pay monthly via x402\n' +
      '❌ **Cancel anytime:** No commitments\n\n' +
      '**To subscribe:**\n' +
      `1. Visit: ${subscribeUrl}\n` +
      '2. Connect your wallet (if not connected)\n' +
      '3. Click "Subscribe Now"\n' +
      '4. Approve the USDC payment\n' +
      '5. Auto-reposition activates instantly\n\n' +
      'Or click the button below:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💎 Subscribe Now',
                url: subscribeUrl,
              },
            ],
            [
              {
                text: '💳 Use Credits Instead',
                callback_data: 'use_credits',
              },
            ],
            [
              {
                text: '🔄 Refresh Status',
                callback_data: 'refresh_subscription',
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    console.error('Error handling subscribe:', error);
    await ctx.reply('❌ Failed to generate subscription link. Try again later.');
  }
}

/**
 * Helper function to build settings message and keyboard
 */
async function buildSettingsMessage(telegramId: string) {
  // Check if wallet is linked
  const linkedAccount = await mcpClient.getLinkedAccount(telegramId);

  if (!linkedAccount.isLinked || !linkedAccount.walletAddress) {
    throw new Error('No wallet linked');
  }

  // Get current settings
  const settings = await mcpClient.getRepositionSettings(telegramId) as RepositionSettings;

  // Check subscription/credits status
  const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress);
  const creditBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress);

  // Payment status section
  let paymentStatus = '';
  if (subscriptionStatus.isActive) {
    paymentStatus =
      '✅ **Subscription Active**\n' +
      `Tier: ${subscriptionStatus.tier}\n` +
      `Expires: ${new Date(subscriptionStatus.expiresAt!).toLocaleDateString()}\n` +
      `Days Remaining: ${subscriptionStatus.daysRemaining}\n`;
  } else if (creditBalance.balance > 0) {
    paymentStatus =
      '💳 **Pay-per-use Credits**\n' +
      `Balance: ${creditBalance.balance} credits\n` +
      `Repositions Available: ${Math.floor(creditBalance.balance / 1)}\n`;
  } else {
    paymentStatus =
      '⚠️ **No Active Payment**\n' +
      'You need a subscription or credits for auto-reposition.\n';
  }

  const message =
    '⚙️ **Auto-Reposition Settings**\n\n' +
    '**Payment Status:**\n' +
    paymentStatus +
    '\n**Settings:**\n' +
    `🔄 Auto-Reposition: ${settings.autoRepositionEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `⚡ Urgency Threshold: ${settings.urgencyThreshold.toUpperCase()}\n` +
    `⛽ Max Gas Cost: ${settings.maxGasCostSol} SOL\n` +
    `💰 Min Fees to Collect: $${settings.minFeesToCollectUsd}\n` +
    `📊 Allowed Strategies: ${settings.allowedStrategies.join(', ')}\n\n` +
    '**Notifications:**\n' +
    `📱 Telegram: ${settings.telegramNotifications ? '✅ On' : '❌ Off'}\n` +
    `🌐 Website: ${settings.websiteNotifications ? '✅ On' : '❌ Off'}\n\n` +
    '**Quick Commands:**\n' +
    `/enableauto - Enable auto-repositioning\n` +
    `/disableauto - Disable auto-repositioning\n` +
    `/subscribe - Get unlimited repositions\n` +
    `/credits - Check credit balance\n` +
    `/topup - Purchase credits`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: settings.autoRepositionEnabled ? '❌ Disable Auto' : '✅ Enable Auto',
          callback_data: settings.autoRepositionEnabled ? 'disable_auto' : 'enable_auto',
        },
      ],
      [
        {
          text: '⚡ Change Threshold',
          callback_data: 'change_threshold',
        },
        {
          text: '⛽ Change Gas Limit',
          callback_data: 'change_gas',
        },
      ],
      [
        {
          text: '🔔 Toggle Notifications',
          callback_data: 'toggle_notifications',
        },
      ],
      [
        {
          text: subscriptionStatus.isActive ? '✅ Subscribed' : '💳 Subscribe',
          callback_data: 'subscribe',
        },
        {
          text: '🔄 Refresh',
          callback_data: 'refresh_settings',
        },
      ],
    ],
  };

  return { message, keyboard };
}

/**
 * Handle inline button callbacks
 */
export async function handleSettingsCallback(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
    return;
  }

  const callbackData = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.answerCbQuery('❌ Unable to identify user');
    return;
  }

  try {
    switch (callbackData) {
      case 'enable_auto': {
        await ctx.answerCbQuery('Enabling auto-reposition...');

        // Check if wallet is linked
        const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());
        if (!linkedAccount.isLinked) {
          await ctx.answerCbQuery('❌ No wallet linked', { show_alert: true });
          return;
        }

        // Check payment status
        const subscriptionStatus = await mcpClient.checkSubscription(linkedAccount.walletAddress!);
        const creditBalance = await mcpClient.getCreditBalance(linkedAccount.walletAddress!);

        if (!subscriptionStatus.isActive && creditBalance.balance === 0) {
          await ctx.answerCbQuery('⚠️ Payment required', { show_alert: true });
          await ctx.reply(
            '⚠️ **Payment Required**\n\n' +
            'You need a subscription or credits to enable auto-repositioning.\n\n' +
            '**Options:**\n' +
            '• `/subscribe` - $4.99/month for unlimited repositions\n' +
            '• `/topup` - $0.01 USDC per reposition (pay-as-you-go)',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Enable auto-reposition
        await mcpClient.updateRepositionSettings(telegramId.toString(), {
          autoRepositionEnabled: true,
        });

        // Update the message with new state
        const { message, keyboard } = await buildSettingsMessage(telegramId.toString());
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        await ctx.answerCbQuery('✅ Auto-reposition enabled!');
        break;
      }

      case 'disable_auto': {
        await ctx.answerCbQuery('Disabling auto-reposition...');

        // Check if wallet is linked
        const linkedAccount = await mcpClient.getLinkedAccount(telegramId.toString());
        if (!linkedAccount.isLinked) {
          await ctx.answerCbQuery('❌ No wallet linked', { show_alert: true });
          return;
        }

        // Disable auto-reposition
        await mcpClient.updateRepositionSettings(telegramId.toString(), {
          autoRepositionEnabled: false,
        });

        // Update the message with new state
        const { message, keyboard } = await buildSettingsMessage(telegramId.toString());
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        await ctx.answerCbQuery('⏸️ Auto-reposition disabled');
        break;
      }

      case 'refresh_settings': {
        await ctx.answerCbQuery('Refreshing settings...');

        // Update the message with current state
        const { message, keyboard } = await buildSettingsMessage(telegramId.toString());
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        break;
      }

      case 'subscribe':
        await ctx.answerCbQuery('Opening subscription...');
        await handleSubscribeCommand(ctx);
        break;

      case 'refresh_subscription':
        await ctx.answerCbQuery('Checking subscription status...');
        await handleSubscribeCommand(ctx);
        break;

      case 'use_credits':
        await ctx.answerCbQuery('Opening credits...');
        await ctx.reply(
          '💳 **Pay-per-use Credits**\n\n' +
          'Instead of a subscription, you can purchase credits:\n\n' +
          '• $0.01 USDC per reposition\n' +
          '• Credits never expire\n' +
          '• No monthly commitment\n\n' +
          'Use `/topup` to purchase credits.',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'change_threshold':
      case 'change_gas':
      case 'toggle_notifications':
        await ctx.answerCbQuery('Please visit the website for advanced settings');
        await ctx.reply(
          '🌐 **Advanced Settings**\n\n' +
          'For detailed configuration, please visit:\n' +
          `${process.env.NEXT_PUBLIC_APP_URL || 'https://hypebiscus.com'}/settings\n\n` +
          'You can adjust:\n' +
          '• Urgency threshold (low/medium/high)\n' +
          '• Maximum gas cost\n' +
          '• Minimum fees to collect\n' +
          '• Notification preferences\n' +
          '• Allowed strategies',
          { parse_mode: 'Markdown' }
        );
        break;

      default:
        await ctx.answerCbQuery('Unknown action');
    }
  } catch (error) {
    console.error('Error handling settings callback:', error);
    await ctx.answerCbQuery('❌ Action failed');
  }
}
