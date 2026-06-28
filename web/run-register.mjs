#!/usr/bin/env node
/**
 * CLI: Jalankan 1x registrasi MiMo langsung dari terminal.
 *
 * Usage:
 *   node run-register.mjs                     # default config
 *   node run-register.mjs --count 3           # 3 akun sekaligus
 *   node run-register.mjs --pw MyPass123      # custom password
 *   node run-register.mjs --ref T8K299        # custom invite code
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse args ──────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}

const COUNT = parseInt(getArg('count', '1'), 10);
const PASSWORD = getArg('pw', 'Arkan123!');
const REF = getArg('ref', 'T8K299');
const MODE = getArg('mode', 'api'); // api or browser

// ── Load config ─────────────────────────────────────────
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'default.json'), 'utf8'));

const iterConfig = {
  tempmail: { apiUrl: cfg.tempmail?.apiUrl || 'https://tempik.sutros.my.id/api' },
  captcha: { provider: cfg.captcha?.provider, apiKey: cfg.captcha?.apiKey },
  nineRouter: {
    url: cfg.nineRouter?.url,
    key: cfg.nineRouter?.key,
    model: cfg.nineRouter?.model || 'mimo/mimo-v2-flash',
  },
  xiaomi: {
    inviteCode: REF,
    referralLink: `https://platform.xiaomimimo.com/?ref=${encodeURIComponent(REF)}`,
    password: PASSWORD,
    betaApplication: 'MiMo-V2.5-Pro-UltraSpeed',
  },
  browser: {
    headless: true,
    timeout: 60000,
    screenshots: false,
  },
};

// ── Run ─────────────────────────────────────────────────
console.log(`\n🔷 MiMo Register CLI — ${COUNT} akun, mode: ${MODE}`);
console.log(`   Password: ${PASSWORD} | Ref: ${REF}\n`);

async function runOne(idx) {
  const tag = `[${idx + 1}/${COUNT}]`;
  try {
    if (MODE === 'api') {
      const { MimoApiRegistration } = await import('../src/core/mimo-api-registration.js');
      const reg = new MimoApiRegistration(iterConfig);
      const result = await reg.run();

      if (result.apiKey) {
        console.log(`\n${tag} ✅ SUCCESS`);
        console.log(`   Email:    ${result.email}`);
        console.log(`   Password: ${result.password}`);
        console.log(`   API Key:  ${result.apiKey}`);
        console.log(`   passToken: ${result.passToken || 'n/a'}`);
      } else if (result.passToken) {
        console.log(`\n${tag} ⚠️  PARTIAL — passToken obtained but no API key`);
        console.log(`   Email:     ${result.email}`);
        console.log(`   passToken: ${result.passToken}`);
        console.log(`   cUserId:   ${result.cUserId || 'n/a'}`);
        console.log(`   userId:    ${result.userId || 'n/a'}`);
      } else {
        console.log(`\n${tag} ❌ FAILED — ${result.error || 'unknown'}`);
      }
      return result;
    } else {
      // Browser mode
      const { MimoRegistration } = await import('../src/core/registration.js');
      const reg = new MimoRegistration(iterConfig);
      const result = await reg.run();
      if (result?.apiKey) {
        console.log(`\n${tag} ✅ SUCCESS — ${result.email} — ${result.apiKey}`);
      } else {
        console.log(`\n${tag} ❌ FAILED`);
      }
      return result;
    }
  } catch (err) {
    console.error(`\n${tag} ❌ ERROR: ${err.message}`);
    return null;
  }
}

const results = [];
for (let i = 0; i < COUNT; i++) {
  if (i > 0) {
    console.log('\n' + '─'.repeat(60));
  }
  const r = await runOne(i);
  results.push(r);
}

// ── Summary ─────────────────────────────────────────────
const success = results.filter(r => r?.apiKey).length;
const partial = results.filter(r => r?.passToken && !r?.apiKey).length;
const failed = results.filter(r => !r?.apiKey && !r?.passToken).length;

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 Hasil: ${success} ✅ sukses | ${partial} ⚠️ partial | ${failed} ❌ gagal`);
if (success > 0) {
  console.log(`\n🔑 API Keys:`);
  results.filter(r => r?.apiKey).forEach(r => {
    console.log(`   ${r.apiKey}  (${r.email})`);
  });
}
console.log('');

// Write results to output file
import { appendFileSync, writeFileSync, mkdirSync } from 'fs';
const outDir = join(__dirname, '..', 'output');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'register-results.txt');
results.filter(r => r?.apiKey).forEach(r => {
  appendFileSync(outFile, r.apiKey + '\n', 'utf8');
});
if (success > 0) console.log(`💾 Keys saved to ${outFile}\n`);
