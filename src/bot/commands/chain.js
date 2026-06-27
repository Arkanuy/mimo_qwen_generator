/**
 * /register & /stop command handlers.
 */

import { regCountMenu, stopConfirmMenu, mainMenu } from '../ui/keyboard.js';
import { brandHeader } from '../watermark.js';

let runner = null;
function setRunner(r) { runner = r; }

async function cleanReply(ctx, text, markup) {
  try { await ctx.deleteMessage(); } catch (e) {}
  return ctx.replyWithMarkdown(text, markup);
}

async function cleanEditOrReply(ctx, text, markup) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...markup });
  } catch (e) {
    try { await ctx.deleteMessage(); } catch (e2) {}
    return ctx.replyWithMarkdown(text, markup);
  }
}

// ---- /start — main menu ----------------------------------------------

function startCommand(ctx) {
  const proxyCount = runner?.proxyManager ? runner.proxyManager.status() : null;
  const proxyEnabled = runner?.config?.proxy?.enabled !== false;
  const seed = runner?.config?.xiaomi?.inviteCode || '?';

  let text = `🔷 *MiMo Register* v3.0.0\n\n`;
  text += `_Xiaomi MiMo Auto-Registration_\n\n`;
  text += `📌 Seed: \`${seed}\`\n`;
  if (proxyCount) text += `🔌 Proxy: ${proxyCount.healthy}/${proxyCount.total} healthy\n`;
  if (runner?.running) text += `⚡ *Registration running...*\n`;
  text += `\n_Select an action:_`;

  return cleanReply(ctx, text, mainMenu(proxyCount, proxyEnabled));
}

// ---- /register — show count selector ---------------------------------

function registerCommand(ctx) {
  if (runner?.running) {
    return cleanReply(ctx, '⚠ *Already running.*\n\n_Use ⏹ Stop to halt._', stopConfirmMenu());
  }
  const seed = runner?.config?.xiaomi?.inviteCode || '?';
  return cleanReply(ctx, `🚀 *Start Registration*\n\n📌 Seed: \`${seed}\`\n\n_Select count:_`, regCountMenu(seed));
}

// ---- Progress bar helpers ---------------------------------------------

function renderProgressBar(current, total) {
  const barLen = 14;
  const filled = Math.round((current / total) * barLen);
  const empty = barLen - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function renderDots(count = 0) {
  const frames = ['', '.', '..', '...'];
  return `Processing${frames[count % frames.length]}`;
}

// ---- Register start action --------------------------------------------

let _updateTimer = null;
let _progressMsgId = null;

async function registerStartAction(ctx) {
  const count = parseInt(ctx.match[1], 10);
  if (!count || count < 1 || count > 100) {
    await ctx.answerCbQuery('❌ Invalid count');
    return cleanReply(ctx, '❌ Invalid count. Use 1-100.', mainMenu());
  }

  if (!runner || runner.running) {
    await ctx.answerCbQuery('⚠ Already running');
    return;
  }

  await ctx.answerCbQuery('🚀 Starting...');

  try { await ctx.deleteMessage(); } catch (e) {}
  cleanupOldProgress();

  const seed = runner.config.xiaomi.inviteCode;
  const chatId = ctx.chat.id;

  const startMsg = await ctx.telegram.sendMessage(chatId,
    `🚀 *Registration Started*\n📌 Seed: \`${seed}\`\n⏱ Elapsed: 0s\n\n░░░░░░░░░░░░░░\n🔵 Processing  ·  _0/${count}_\n✅ 0 success  ·  ❌ 0 failed`,
    { parse_mode: 'Markdown' }
  );
  _progressMsgId = startMsg.message_id;

  let completedCount = 0;
  let failedCount = 0;
  let startTime = Date.now();
  const progressHistory = [];

  let loadingFrame = 0;
  _updateTimer = setInterval(async () => {
    if (!_progressMsgId) return;
    loadingFrame++;

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed > 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`;

    let text = `🚀 *Registration Running*\n`;
    text += `📌 Seed: \`${seed}\`\n`;
    text += `⏱ Elapsed: ${elapsedStr}\n`;
    text += `\n${renderProgressBar(completedCount, count)}`;
    text += `\n🔵 ${renderDots(loadingFrame)}  ·  _${completedCount + failedCount}/${count}_`;
    text += `\n✅ ${completedCount} success  ·  ❌ ${failedCount} failed`;

    if (progressHistory.length > 0) {
      text += `\n\n📋 *Latest:*\n`;
      progressHistory.slice(-6).reverse().forEach(line => { text += `${line}\n`; });
    }

    try {
      await ctx.telegram.editMessageText(chatId, _progressMsgId, null, text, { parse_mode: 'Markdown' });
    } catch (e) {}
  }, 1500);

  const onProgress = (r) => {
    if (r.ok) {
      completedCount++;
      progressHistory.push(`✅ \`${(r.email || '').slice(0, 20)}\` → \`${r.apiKey ? r.apiKey.slice(0, 12) + '...' : '-'}\``);
    } else {
      failedCount++;
      progressHistory.push(`❌ \`${(r.email || '?').slice(0, 18)}\` _${(r.error || '').slice(0, 40)}_`);
    }
  };

  const onDone = async ({ okCount, failCount }) => {
    clearInterval(_updateTimer);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed > 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`;

    let text = '✅ *REGISTRATION COMPLETE*\n\n';
    text += `📌 Seed: \`${seed}\`\n`;
    text += `⏱ Total: ${elapsedStr}\n`;
    text += `\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰ 100%\n`;
    text += `\n✨ *${okCount} success*  |  ❌ *${failCount} failed*\n`;
    text += `\n_Use /export to download results_`;

    if (_progressMsgId) {
      try { await ctx.telegram.editMessageText(chatId, _progressMsgId, null, text, { parse_mode: 'Markdown' }); } catch (e) {}
    }
    _progressMsgId = null;
    cleanup();
  };

  const onStopped = async ({ okCount, failCount }) => {
    clearInterval(_updateTimer);
    let text = '⏹ *STOPPED*\n\n';
    text += `⏸ Dihentikan oleh admin\n`;
    text += `✨ ${okCount} success | ❌ ${failCount} failed\n`;
    text += `\n_Use /export to download results_`;

    if (_progressMsgId) {
      try { await ctx.telegram.editMessageText(chatId, _progressMsgId, null, text, { parse_mode: 'Markdown' }); } catch (e) {}
    }
    _progressMsgId = null;
    cleanup();
  };

  const cleanup = () => {
    runner.off('progress', onProgress);
    runner.off('done', onDone);
    runner.off('stopped', onStopped);
  };

  runner.on('progress', onProgress);
  runner.on('done', onDone);
  runner.on('stopped', onStopped);

  runner.start({ count, seedRef: seed }).catch(async (err) => {
    clearInterval(_updateTimer);
    await ctx.telegram.sendMessage(chatId, `💥 *Fatal error:* ${err.message}`, { parse_mode: 'Markdown' });
    _progressMsgId = null;
    cleanup();
  });
}

function cleanupOldProgress() {
  clearInterval(_updateTimer);
  _progressMsgId = null;
}

// ---- /stop -----------------------------------------------------------

async function stopCommand(ctx) {
  if (!runner?.running) {
    await ctx.answerCbQuery('Tidak ada proses berjalan');
    return cleanReply(ctx, '✅ Tidak ada proses yang berjalan.', mainMenu(runner?.proxyManager?.status()));
  }
  return cleanReply(ctx, '⚠ *Yakin ingin stop?*\n\n_Iterasi yang sedang berjalan akan diselesaikan dulu._', stopConfirmMenu());
}

async function stopConfirmAction(ctx) {
  if (!runner?.running) {
    await ctx.answerCbQuery('Tidak ada proses berjalan');
    return cleanEditOrReply(ctx, '✅ Tidak ada proses yang berjalan.', mainMenu(runner?.proxyManager?.status()));
  }
  await ctx.answerCbQuery('⏹ Menghentikan...');
  runner.stop();
  return cleanEditOrReply(ctx, '⏹ *Menghentikan...*\n_Menunggu iterasi saat ini selesai._', undefined);
}

export { setRunner, startCommand, registerCommand, registerStartAction, stopCommand, stopConfirmAction };
