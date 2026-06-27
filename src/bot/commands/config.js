/**
 * /config — view & edit configuration. Auto-clean chat.
 */

import { writeFileSync } from 'fs';
import { configMenu, configBack } from '../ui/keyboard.js';

let config = null;
let configPath = null;

function setConfig(cfg, cfgPath) { config = cfg; configPath = cfgPath; }
function _save() { if (configPath) writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8'); }

async function cleanReply(ctx, text, markup) {
  try { await ctx.deleteMessage(); } catch (e) {}
  return ctx.replyWithMarkdown(text, markup);
}

// ---- /config — show current config -----------------------------------

function configShowCommand(ctx) {
  const x = config.xiaomi;
  const c = config.captcha;
  const t = config.tempmail;
  const provider = c.provider || '2captcha';
  const providerLabel = provider === 'capmonster' ? 'CapMonster' : '2Captcha';
  return cleanReply(ctx,
    `⚙ *Configuration*\n\n` +
    `📧 *Tempmail*: \`${t.apiUrl}\`\n` +
    `🤖 *Captcha Provider*: \`${providerLabel}\`\n` +
    `🔑 *API Key*: ...\`${(c.apiKey || '').slice(-6)}\`\n` +
    `🔗 *Ref Code*: \`${x.inviteCode}\`\n` +
    `🔐 *Password*: \`${'*'.repeat(x.password.length)}\`\n` +
    `🖥 *Headless*: ${config.browser.headless ? '✅ on' : '❌ off'}\n` +
    `🔌 *Proxy*: ${config.proxy.enabled ? '✅ on' : '❌ off'} (${(config.proxy.proxyList || []).length} in pool)`,
    configMenu(config)
  );
}

// ---- Edit actions ----------------------------------------------------

async function configEditRefAction(ctx) {
  await cleanReply(ctx, '✏ *Edit Referral Code*\n\nKirim kode baru (6 karakter):\nContoh: `ABC123`', configBack());
  config._editing = { chatId: ctx.chat.id, field: 'ref' };
}

async function configEditPassAction(ctx) {
  await cleanReply(ctx, '✏ *Edit Password*\n\nKirim password baru:', configBack());
  config._editing = { chatId: ctx.chat.id, field: 'password' };
}

async function configEditApiKeyAction(ctx) {
  await cleanReply(ctx, '✏ *Edit API Key*\n\nKirim API key baru:', configBack());
  config._editing = { chatId: ctx.chat.id, field: 'apikey' };
}

// ---- Toggle captcha provider -----------------------------------------

async function configToggleProviderAction(ctx) {
  const current = config.captcha.provider || '2captcha';
  config.captcha.provider = current === '2captcha' ? 'capmonster' : '2captcha';
  _save();

  const label = config.captcha.provider === 'capmonster' ? 'CapMonster' : '2Captcha';
  await ctx.answerCbQuery(`Provider: ${label}`);
  await cleanReply(ctx,
    `🤖 *Captcha Provider:* \`${label}\`\n\n` +
    `Pastikan API key sesuai dengan provider yang dipilih!`,
    configMenu(config)
  );
}

// ---- Handle text input for config edits -------------------------------

async function handleConfigText(ctx) {
  const edit = config._editing;
  if (!edit || edit.chatId !== ctx.chat.id) return false;
  const text = ctx.message.text.trim();
  delete config._editing;

  switch (edit.field) {
    case 'ref':
      if (!/^[A-Z0-9]{6}$/i.test(text)) {
        return ctx.reply('❌ Invalid format. Must be 6 alphanumeric chars.\nExample: `ABC123`', { parse_mode: 'Markdown', ...configBack() });
      }
      config.xiaomi.inviteCode = text.toUpperCase();
      config.xiaomi.referralLink = `https://platform.xiaomimimo.com/?ref=${text.toUpperCase()}`;
      _save();
      return ctx.reply(`✅ Referral code updated: \`${text.toUpperCase()}\``, { parse_mode: 'Markdown', ...configMenu(config) });

    case 'password':
      if (text.length < 6) return ctx.reply('❌ Too short (min 6).', configBack());
      config.xiaomi.password = text;
      _save();
      return ctx.reply(`✅ Password updated: \`${'*'.repeat(text.length)}\``, { parse_mode: 'Markdown', ...configMenu(config) });

    case 'apikey':
      if (text.length < 20) return ctx.reply('❌ Invalid format.', configBack());
      config.captcha.apiKey = text;
      _save();
      return ctx.reply(`✅ API key updated: ...\`${text.slice(-6)}\``, { parse_mode: 'Markdown', ...configMenu(config) });

    default: return false;
  }
}

// ---- Toggle proxy ----------------------------------------------------

async function configToggleProxyAction(ctx, proxyManager) {
  config.proxy.enabled = !config.proxy.enabled;
  _save();

  // Reload proxy manager
  if (!config.proxy.enabled) {
    if (proxyManager) proxyManager.proxies = [];
  } else if (proxyManager && config.proxy.proxyList?.length > 0) {
    const { parseProxy } = await import('../../browser/proxy.js');
    proxyManager.proxies = config.proxy.proxyList.map(raw => ({
      raw, config: parseProxy(raw), failures: 0, lastUsed: 0,
    })).filter(p => p.config !== null);
    proxyManager.index = 0;
  }

  const status = config.proxy.enabled ? '🟢 ON' : '🔴 OFF';
  await ctx.answerCbQuery(`Proxy: ${status}`);
  await cleanReply(ctx,
    `🔌 *Proxy:* ${status}\n📦 ${config.proxy.proxyList?.length || 0} in pool`,
    configMenu(config)
  );
}

// ---- Toggle headless -------------------------------------------------

async function configToggleHeadlessAction(ctx) {
  config.browser.headless = !config.browser.headless;
  _save();
  const status = config.browser.headless ? '🟢 ON' : '🔴 OFF';
  await ctx.answerCbQuery(`Headless: ${status}`);
  await cleanReply(ctx, `🖥 *Headless:* ${status}`, configMenu(config));
}

export { setConfig, configShowCommand, configEditRefAction, configEditPassAction, configEditApiKeyAction, configToggleProviderAction, configToggleProxyAction, configToggleHeadlessAction, handleConfigText };
