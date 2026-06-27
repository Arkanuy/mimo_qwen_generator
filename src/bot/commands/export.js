/**
 * /export — send api-keys.txt + results.json files.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let outputDir = null;

function setOutputDir(dir) { outputDir = dir; }

// Retry wrapper dengan exponential backoff
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 15000) // 15s per attempt
        )
      ]);
    } catch (err) {
      const isLast = attempt === maxAttempts;
      console.error(`  Export attempt ${attempt}/${maxAttempts}: ${err.message}`);
      if (isLast) throw err;
      await new Promise(r => setTimeout(r, baseDelayMs * attempt)); // 1s, 2s, 3s
    }
  }
}

async function exportCommand(ctx) {
  const dir = outputDir || '.';
  const jsonFile = join(dir, 'results.json');
  const txtFile = join(dir, 'chain-result.txt');

  let sent = false;

  // --- Kirim API keys .txt ---
  if (existsSync(txtFile)) {
    const content = readFileSync(txtFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    if (lines.length > 0) {
      try {
        // Coba kirim sebagai dokumen dulu
        await withRetry(() =>
          ctx.replyWithDocument(
            { source: Buffer.from(content), filename: 'api-keys.txt' },
            { caption: `🔑 ${lines.length} API key(s)` }
          )
        );
        sent = true;
      } catch (err) {
        console.error(`  Dokumen gagal, fallback ke teks: ${err.message}`);
        try {
          // Fallback: kirim sebagai pesan teks (potong jika terlalu panjang)
          const preview = lines.slice(0, 20).join('\n');
          const truncated = lines.length > 20 ? `\n... +${lines.length - 20} lagi` : '';
          await ctx.reply(
            `🔑 *API Keys (${lines.length}):*\n\`\`\`\n${preview}${truncated}\n\`\`\``,
            { parse_mode: 'Markdown' }
          );
          sent = true;
        } catch (e2) {
          console.error(`  Fallback teks juga gagal: ${e2.message}`);
        }
      }
    }
  }

  // --- Kirim results .json ---
  if (existsSync(jsonFile)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(jsonFile, 'utf8'));
    } catch (err) {
      console.error(`  Gagal parse JSON: ${err.message}`);
    }

    if (parsed && parsed.length > 0) {
      const ok = parsed.filter(r => r.status === 'success').length;

      try {
        // Coba kirim sebagai dokumen dulu
        await withRetry(() =>
          ctx.replyWithDocument(
            { source: Buffer.from(JSON.stringify(parsed, null, 2)), filename: 'results.json' },
            { caption: `📊 ${ok}/${parsed.length} success` }
          )
        );
        sent = true;
      } catch (err) {
        console.error(`  Dokumen JSON gagal, fallback ke teks: ${err.message}`);
        try {
          // Fallback: summary teks (max 50 item)
          const summary = parsed.slice(0, 50).map((r, i) =>
            `${i + 1}. ${r.email} — ${r.status === 'success' ? '✅' : '❌'}`
          ).join('\n');
          const truncated = parsed.length > 50 ? `\n... +${parsed.length - 50} lagi` : '';
          await ctx.reply(
            `📊 *Results (${ok}/${parsed.length}):*\n\n${summary}${truncated}`,
            { parse_mode: 'Markdown' }
          );
          sent = true;
        } catch (e2) {
          console.error(`  Fallback summary juga gagal: ${e2.message}`);
        }
      }
    }
  }

  if (!sent) {
    await ctx.reply('📭 No results yet. Run /register first.').catch(() => {});
  }
}

export { setOutputDir, exportCommand };