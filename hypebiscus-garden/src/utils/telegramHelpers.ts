/**
 * Telegram Helper Utilities
 *
 * Safe wrappers for Telegram API calls to prevent crashes from common errors
 */

import { Context } from 'telegraf';

/**
 * Safely edit a Telegram message text
 * Prevents crashes from "message is not modified" errors
 *
 * @param ctx - Telegraf context
 * @param text - New message text
 * @param extra - Optional message formatting and keyboard
 * @returns Promise resolving to true if updated, false if skipped
 */
export async function safeEditMessageText(
  ctx: Context,
  text: string,
  extra?: any
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, extra);
    return true;
  } catch (error: any) {
    // Ignore "message is not modified" errors (error code 400)
    // This happens when the message content and keyboard haven't changed
    if (
      error?.response?.error_code === 400 &&
      (error?.response?.description?.includes('message is not modified') ||
        error?.message?.includes('message is not modified'))
    ) {
      console.log(
        `⚠️ Message not modified (user ${ctx.from?.id}), skipping update`
      );
      return false;
    }

    // Re-throw other errors (these are genuine issues)
    console.error('❌ Failed to edit message:', error);
    throw error;
  }
}

/**
 * Safely send or edit a message
 * Tries to edit first, falls back to sending a new message if edit fails
 *
 * @param ctx - Telegraf context
 * @param text - Message text
 * @param extra - Optional message formatting and keyboard
 * @returns Promise resolving when message is sent/edited
 */
export async function safeReplyOrEdit(
  ctx: Context,
  text: string,
  extra?: any
): Promise<void> {
  try {
    // Try editing first (for callback queries)
    if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
      await safeEditMessageText(ctx, text, extra);
    } else {
      // Send new message
      await ctx.reply(text, extra);
    }
  } catch (error) {
    console.error('❌ Failed to send/edit message:', error);
    // Try sending a new message as fallback
    try {
      await ctx.reply(text, extra);
    } catch (fallbackError) {
      console.error('❌ Fallback reply also failed:', fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Safely answer a callback query
 * Prevents crashes from timeout or invalid callback query errors
 *
 * @param ctx - Telegraf context
 * @param text - Answer text (optional)
 * @param extra - Optional alert or notification settings
 */
export async function safeAnswerCallback(
  ctx: Context,
  text?: string,
  extra?: { show_alert?: boolean }
): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text, extra);
    }
  } catch (error: any) {
    // Ignore "query is too old" errors - callback already processed
    if (
      error?.response?.error_code === 400 &&
      error?.response?.description?.includes('query is too old')
    ) {
      console.log('⚠️ Callback query too old, ignoring');
      return;
    }

    console.error('❌ Failed to answer callback query:', error);
    // Don't re-throw - this is not critical
  }
}

/**
 * Check if two message contents are identical
 * Useful for preventing "message is not modified" errors before calling edit
 *
 * @param text1 - First message text
 * @param text2 - Second message text
 * @param keyboard1 - First keyboard (optional)
 * @param keyboard2 - Second keyboard (optional)
 * @returns true if messages are identical
 */
export function areMessagesIdentical(
  text1: string,
  text2: string,
  keyboard1?: any,
  keyboard2?: any
): boolean {
  if (text1 !== text2) {
    return false;
  }

  // If only one has a keyboard, they're different
  if (!!keyboard1 !== !!keyboard2) {
    return false;
  }

  // If both have keyboards, compare them
  if (keyboard1 && keyboard2) {
    return JSON.stringify(keyboard1) === JSON.stringify(keyboard2);
  }

  return true;
}
