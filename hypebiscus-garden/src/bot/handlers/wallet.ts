// src/bot/handlers/wallet.ts
import { Context, Telegraf } from 'telegraf';
import { WalletService } from '../../services/walletService';
import { getOrCreateUser } from '../../services/db';
import { walletKeyboard, backKeyboard } from '../keyboards';
import { PrivateKeyParser } from '../../utils/privateKeyParser';

export class WalletHandler {
  constructor(
    private walletService: WalletService,
    private bot: Telegraf
  ) {}

  /**
   * Show wallet info - balance and address
   */
  async handleWalletInfo(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      // Get user from database
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      // Check if user has wallet
      if (!user.wallet) {
        await ctx.editMessageText(
          '❌ No wallet found. Create or import a wallet first.',
          walletKeyboard
        );
        return;
      }

      // Get balance
      const balance = await this.walletService.getBalance(user.id);
      const balanceText = balance 
        ? `💰 SOL: ${balance.sol.toFixed(4)}\n💰 ZBTC: ${balance.zbtc.toFixed(6)}`
        : '❌ Failed to fetch balance';

      await ctx.editMessageText(
        `👛 **Wallet Info**\n\n` +
        `📍 Address:\n\`${user.wallet.publicKey}\`\n\n` +
        `${balanceText}\n\n` +
        `Choose an option below:`,
        { 
          parse_mode: 'Markdown',
          ...walletKeyboard  // Changed from backKeyboard to walletKeyboard
        }
      );
    } catch (error) {
      console.error('Error getting wallet info:', error);
      await ctx.editMessageText(
        '❌ Failed to get wallet info. Try again.',
        backKeyboard
      );
    }
  }

  /**
   * Create new wallet and save to database
   */
  async handleCreateWallet(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      // Get or create user in database
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      // Check if user already has wallet
      if (user.wallet) {
        await ctx.editMessageText(
          '⚠️ You already have a wallet!\n\nUse "Wallet Info" to view it.',
          backKeyboard
        );
        return;
      }

      // Create wallet (automatically saves to database)
      const wallet = await this.walletService.createWallet(user.id);
      
      await ctx.editMessageText(
        `✅ **Wallet Created!**\n\n` +
        `📍 **Address:**\n\`${wallet.publicKey}\`\n\n` +
        `🔐 Your private key will be sent next.\n` +
        `💰 Fund with SOL + ZBTC to start trading.`,
        { 
          parse_mode: 'Markdown',
          ...backKeyboard 
        }
      );
      
      // Send private key in Phantom/Solflare format
      const { Markup } = await import('telegraf');
      await ctx.reply(
        `🔐 **Secret Recovery Key**\n\n` +
        `\`${wallet.privateKeyBase58}\`\n\n` +
        `⚠️ **Save this key securely!**\n` +
        `• Anyone with this key controls your wallet\n` +
        `• You can import this into Phantom or Solflare\n` +
        `• Never share it with anyone`,
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Saved (Delete)', `delete_pk_msg`)
            ]
          ])
        }
      );

      console.log(`✅ Wallet created for user ${telegramId}: ${wallet.publicKey}`);
    } catch (error: any) {
      console.error('Error creating wallet:', error);
      
      if (error.message === 'User already has a wallet') {
        await ctx.editMessageText(
          '⚠️ You already have a wallet!',
          backKeyboard
        );
      } else {
        await ctx.editMessageText(
          '❌ Failed to create wallet. Please try again.',
          backKeyboard
        );
      }
    }
  }

  /**
   * Import existing wallet
   */
  async handleImportWallet(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      // Get or create user in database
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      // Check if user already has wallet
      if (user.wallet) {
        await ctx.editMessageText(
          '⚠️ You already have a wallet!\n\n' +
          'You cannot import another wallet. Use your existing wallet or create a new account.',
          backKeyboard
        );
        return;
      }

      await ctx.editMessageText(
        `📥 **Import Wallet**\n\n` +
        `Send your private key in ANY of these formats:\n\n` +
        PrivateKeyParser.getFormatExamples() + `\n\n` +
        `⚠️ **IMPORTANT:**\n` +
        `• Make sure this chat is private!\n` +
        `• Delete the message after importing\n` +
        `• Only import your own wallet`,
        {
          parse_mode: 'Markdown',
          ...backKeyboard
        }
      );

      // Set state to expect private key input
      // Update session properties (don't replace the object)
      const session = (ctx as any).session;
      session.waitingForPrivateKey = true;
      session.userId = user.id;
    } catch (error) {
      console.error('Error in import wallet:', error);
      await ctx.editMessageText(
        '❌ Failed to start import process. Try again.',
        backKeyboard
      );
    }
  }

  /**
   * Handle private key input for import
   */
  async handlePrivateKeyInput(ctx: Context, privateKey: string): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      // Get session data
      const session = (ctx as any).session || {};
      const userId = session.userId;

      if (!userId) {
        await ctx.reply('❌ Session expired. Please try importing again.');
        return;
      }

      // Import wallet (automatically saves to database)
      const result = await this.walletService.importWallet(userId, privateKey);

      if (result) {
        await ctx.reply(
          `✅ **Wallet Imported Successfully!**\n\n` +
          `📍 Address:\n\`${result.publicKey}\`\n\n` +
          `✨ Format detected: **${result.format}**\n\n` +
          `💡 Your wallet is now ready to use!`,
          { parse_mode: 'Markdown' }
        );

        // Delete the user's message with private key for security
        try {
          await ctx.deleteMessage();
        } catch (e) {
          console.log('Could not delete message (might be too old)');
        }

        console.log(`✅ Wallet imported (${result.format}) for user ${telegramId}: ${result.publicKey}`);
      } else {
        await ctx.reply(
          '❌ **Invalid private key format.**\n\n' +
          PrivateKeyParser.getFormatExamples(),
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error: any) {
      console.error('Error importing wallet:', error);
      
      if (error.message === 'User already has a wallet') {
        await ctx.reply('⚠️ You already have a wallet!');
      } else {
        await ctx.reply('❌ Failed to import wallet. Please check the format and try again.');
      }
    }
  }

  /**
   * Export private key (dangerous - use with caution)
   */
  async handleExportPrivateKey(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      // Get user from database
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      if (!user.wallet) {
        await ctx.editMessageText('❌ No wallet found.', backKeyboard);
        return;
      }

      // Send warning with user ID in callback data
      await ctx.editMessageText(
        '⚠️ **WARNING**\n\n' +
        'You are about to view your private key.\n' +
        'Anyone with this key can steal your funds!\n\n' +
        'Continue?',
        {
          parse_mode: 'Markdown',
          ...require('telegraf').Markup.inlineKeyboard([
            [
              require('telegraf').Markup.button.callback('✅ Yes, Show Key', `confirm_export_${user.id}`)
            ],
            [
              require('telegraf').Markup.button.callback('❌ Cancel', 'wallet_info')
            ]
          ])
        }
      );

    } catch (error) {
      console.error('Error exporting private key:', error);
      await ctx.editMessageText('❌ Failed to export private key.', backKeyboard);
    }
  }

  /**
   * Handle confirmed export (after warning)
   */
  async handleConfirmExport(ctx: Context, userId: string): Promise<void> {
    try {
      // Export private key directly from database
      const privateKeyJson = await this.walletService.exportPrivateKey(userId);
      
      if (!privateKeyJson) {
        await ctx.editMessageText('❌ Failed to export private key.', backKeyboard);
        return;
      }

      // Convert to base58 format
      const bs58 = require('bs58');
      const secretKey = new Uint8Array(JSON.parse(privateKeyJson));
      const privateKeyBase58 = bs58.encode(secretKey);

      // Send private key with delete button
      const { Markup } = await import('telegraf');
      await ctx.editMessageText(
        '🔐 **Secret Recovery Key**\n\n' +
        `\`${privateKeyBase58}\`\n\n` +
        '⚠️ **IMPORTANT:**\n' +
        '• Save this in a secure location\n' +
        '• Never share it with anyone\n' +
        '• Delete this message after saving',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Saved (Delete)', 'delete_pk_msg')
            ]
          ])
        }
      );

      console.log(`⚠️ User ${ctx.from?.id} exported their private key`);
    } catch (error) {
      console.error('Error in confirm export:', error);
      await ctx.editMessageText('❌ Failed to export private key.', backKeyboard);
    }
  }

  /**
   * Show wallet menu
   */
  async handleWalletMenu(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await getOrCreateUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name
      );

      const hasWallet = !!user.wallet;

      await ctx.editMessageText(
        `👛 **Wallet Management**\n\n` +
        `${hasWallet ? '✅ You have a wallet' : '❌ No wallet found'}\n\n` +
        `Choose an option below:`,
        { 
          parse_mode: 'Markdown',
          ...walletKeyboard 
        }
      );
    } catch (error) {
      console.error('Error showing wallet menu:', error);
      await ctx.editMessageText(
        '👛 **Wallet Management**\n\nChoose an option:',
        walletKeyboard
      );
    }
  }
}