import { Markup } from 'telegraf';

export const mainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('💰 Create Position', 'create_position')],
  [Markup.button.callback('📊 View Positions', 'view_positions')],
  [Markup.button.callback('🔴 Close Position', 'close_position')],
  [Markup.button.callback('📜 Position History', 'view_history')],
  [Markup.button.callback('👛 Wallet Info', 'wallet_info')],
  [Markup.button.callback('🔄 Reposition', 'toggle_monitoring')],
  [Markup.button.callback('📈 Pool Status', 'pool_status')]
]);

export const walletKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🆕 Create New Wallet', 'create_wallet')],
  [Markup.button.callback('📥 Import Wallet', 'import_wallet')],
  [Markup.button.callback('📤 Export Private Key', 'export_key')],
  [Markup.button.callback('⬅️ Back', 'main_menu')]
]);

export const backKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back to Menu', 'main_menu')]
]);

export const helpKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('👛 Wallet Commands', 'help_wallet')],
  [Markup.button.callback('💼 Position Commands', 'help_positions')],
  [Markup.button.callback('⚙️ Settings & Auto', 'help_settings')],
  [Markup.button.callback('💳 Payment & Credits', 'help_payment')],
  [Markup.button.callback('🔗 Wallet Linking', 'help_linking')],
  [Markup.button.callback('⬅️ Back to Menu', 'main_menu')]
]);