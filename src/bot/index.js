#!/usr/bin/env node
/**
 * MiMo Register Bot — Telegram admin bot.
 */

import { Telegraf } from 'telegraf';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ProxyManager } from '../browser/proxy.js';
import { ChainRunner } from '../runner/chain-runner.js';
import { adminOnly } from './admin.js';
import {
  startCommand, registerCommand, registerStartAction, stopCommand, stopConfirmAction, setRunner,
} from './commands/chain.js';
import {
  proxyMenuCommand, proxyListAction, proxyAddAction, proxyDelMenuAction, proxyDelAction,
  handleProxyText, setProxyManager,
} from './commands/proxy.js';
import {
  configShowCommand, configEditRefAction, configEditPassAction, configEditApiKeyAction,
  configToggleProviderAction, configToggleProxyAction, configToggleHeadlessAction, handleConfigText, setConfig,
} from './commands/config.js';
import { exportCommand, setOutputDir } from './commands/export.js';
import { mainMenu } from './ui/keyboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Load config -------------------------------------------------------

const configPath = process.env.HERMES_BOT_MIMO_CONFIG
  || join(__dirname, '..', '..', 'config', 'default.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---- Init services -----------------------------------------------------

const outputDir = process.env.HERMES_BOT_MIMO_CWD || join(__dirname, '..', '..', 'output');

const proxyConfig = config.proxy || { enabled: false };
const proxyManager = proxyConfig.enabled && proxyConfig.proxyList?.length > 0
  ? new ProxyManager(proxyConfig.proxyList, {
      rotatePerAccount: proxyConfig.rotatePerAccount !== false,
      defaultCountry: proxyConfig.defaultCountry || 'US',
      maxRetries: proxyConfig.maxRetries ?? 3,
    })
  : null;

const runner = new ChainRunner(config, proxyManager, outputDir);

setRunner(runner);
setProxyManager(proxyManager, configPath);
setConfig(config, configPath);
setOutputDir(outputDir);

// ---- Bot setup ---------------------------------------------------------

const token = config.telegram?.botToken;
if (!token || token === 'YOUR_BOT_TOKEN') {
  console.error('❌ Bot token not configured. Set telegram.botToken in config/default.json');
  process.exit(1);
}

const bot = new Telegraf(token);
bot.use(adminOnly(config));

// ---- Register bot commands (menu list) ---------------------------------

bot.telegram.setMyCommands([
  { command: 'start', description: '🏠 Main menu' },
  { command: 'register', description: '🚀 Start registration' },
  { command: 'stop', description: '⏹ Stop running process' },
  { command: 'export', description: '📤 Download results' },
  { command: 'config', description: '⚙ Settings' },
  { command: 'proxies', description: '🔌 Manage proxies' },
]).catch(() => {});

// ---- Commands ----------------------------------------------------------

bot.command('start', startCommand);
bot.command('register', registerCommand);
bot.command('stop', stopCommand);
bot.command('proxies', proxyMenuCommand);
bot.command('export', exportCommand);
bot.command('config', configShowCommand);

// ---- Inline actions: Registration --------------------------------------

bot.action(/^reg_menu$/, registerCommand);
bot.action(/^reg_(\d+)$/, registerStartAction);
bot.action(/^stop_btn$/, stopCommand);
bot.action(/^stop_confirm$/, stopConfirmAction);

// ---- Inline actions: Proxy ---------------------------------------------

bot.action(/^proxy_menu$/, proxyMenuCommand);
bot.action(/^proxy_list$/, proxyListAction);
bot.action(/^proxy_page_(\d+)$/, proxyListAction);
bot.action(/^proxy_add$/, proxyAddAction);
bot.action(/^proxy_del_menu$/, proxyDelMenuAction);
bot.action(/^proxy_del_(\d+)$/, (ctx) => proxyDelAction(ctx, config));

// ---- Inline actions: Config --------------------------------------------

bot.action(/^config_menu$/, configShowCommand);
bot.action(/^config_edit_ref$/, configEditRefAction);
bot.action(/^config_edit_pass$/, configEditPassAction);
bot.action(/^config_edit_apikey$/, configEditApiKeyAction);
bot.action(/^config_toggle_proxy$/, (ctx) => configToggleProxyAction(ctx, proxyManager));
bot.action(/^config_toggle_headless$/, configToggleHeadlessAction);
bot.action(/^config_toggle_provider$/, configToggleProviderAction);

// ---- Inline actions: Export --------------------------------------------

bot.action(/^export_btn$/, exportCommand);

// ---- Inline actions: Navigation ----------------------------------------

bot.action('menu', startCommand);
bot.action('proxy_nop', (ctx) => ctx.answerCbQuery());

// ---- Text message handler ----------------------------------------------

bot.on('text', async (ctx, next) => {
  const configHandled = await handleConfigText(ctx);
  if (configHandled) return;

  if (proxyManager?._waitingForProxy === ctx.chat.id) {
    delete proxyManager._waitingForProxy;
    await handleProxyText(ctx, config);
    return;
  }

  return next();
});

// ---- Launch ------------------------------------------------------------

// Prevent crashes from unhandled Telegram API errors
bot.catch((err, ctx) => {
  console.error(`  [Bot Error] ${err.message}`);
  ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
});
bot.launch().then(() => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     🤖 MiMo Register Bot             ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Config  : ${configPath.slice(-24).padEnd(24)} ║`);
  console.log(`  ║  Output  : ${outputDir.slice(-24).padEnd(24)} ║`);
  console.log(`  ║  Proxies : ${(proxyManager ? proxyManager.count + ' in pool' : 'disabled').padEnd(24)} ║`);
  console.log(`  ║  Admins  : ${(config.telegram?.adminIds || []).join(', ').padEnd(24)} ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});

process.once('SIGINT', () => {
  console.log('\n  ⏹ Shutting down...');
  if (runner.running) runner.stop();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  if (runner.running) runner.stop();
  bot.stop('SIGTERM');
});
