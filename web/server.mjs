/**
 * Standalone API server for batch management.
 * All data persisted to local JSON files.
 * Admin requires login, public pages are open.
 * Supports real parallel execution via threads config.
 * Supports proxy rotation with TCP pre-check + live retry.
 */
import http from "http";
import { startTunnel } from "./socks-tunnel.mjs";
import net from "net";
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MocasusTempMail } from "../src/clients/mocasus-tempmail.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Load project config ───────────────────────────────────────────────
const PROJECT_ROOT = join(__dirname, "..");
let PROJECT_CONFIG = {};
try { PROJECT_CONFIG = JSON.parse(readFileSync(join(PROJECT_ROOT, "config", "default.json"), "utf8")); } catch {}

// ── Mocasus TempMail client ──────────────────────────────
const mocasusMail = new MocasusTempMail({
  supabaseUrl: PROJECT_CONFIG.tempmail?.supabaseUrl,
  anonKey: PROJECT_CONFIG.tempmail?.anonKey,
  ownerToken: PROJECT_CONFIG.tempmail?.ownerToken,
});

// ── Paths ────────────────────────────────────────────────
const DB_DIR = join(__dirname, "..", "db");
const DB_FILE = join(DB_DIR, "batches.json");
const MASTER_KEYS_FILE = join(DB_DIR, "master-keys.json");
const OUTPUT_DIR = join(__dirname, "..", "output");
mkdirSync(DB_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── JSON Database ────────────────────────────────────────
function loadDB() {
  if (!existsSync(DB_FILE)) return {};
  try { return JSON.parse(readFileSync(DB_FILE, "utf8")); } catch { return {}; }
}
function saveDB(data) { writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8"); }
const db = loadDB();

// ── Auth ─────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "mimo2024";
const sessions = new Map();
function createSession(role) { const t = crypto.randomBytes(32).toString("hex"); sessions.set(t, { role, created: Date.now() }); return t; }
function getSession(t) { const s = sessions.get(t); if (!s) return null; if (Date.now() - s.created > 86400000) { sessions.delete(t); return null; } return s; }
function parseCookies(h) { const c = {}; if (!h) return c; h.split(";").forEach(x => { const [k,...v] = x.trim().split("="); c[k] = v.join("="); }); return c; }
function getAuth(req) { const c = parseCookies(req.headers.cookie); const t = c["session_token"]; return t ? getSession(t) : null; }
function isAdmin(req) { return getAuth(req)?.role === "admin"; }
function setCors(req, res) { res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Credentials", "true"); }

// ═══════════════════════════════════════════════════════════
// ── Proxy helpers ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
// All proxies default to socks5 (user's proxy pool is all SOCKS5)

function parseProxyLine(raw) {
  if (!raw) return null;
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  // Validate: host must look like IP or hostname (no spaces, no special chars)
  const isValidHost = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^[a-zA-Z0-9.-]+$/.test(h);

  // protocol://ip:port:user:pass
  const pm = line.match(/^(socks[45]|http):\/\//);
  if (pm) {
    const rest = line.slice(pm[0].length).split(":");
    const host = rest[0], port = parseInt(rest[1], 10);
    if (!host || isNaN(port) || !isValidHost(host)) return null;
    const r = { server: `${pm[1]}://${host}:${port}` };
    if (rest.length >= 4) { r.username = rest[2]; r.password = rest[3]; }
    return r;
  }
  // plain ip:port:user:pass
  const p = line.split(":");
  if (p.length < 2) return null;
  const host = p[0], port = parseInt(p[1], 10);
  if (!host || isNaN(port) || !isValidHost(host)) return null;
  const proto = "socks5";
  const r = { server: `${proto}://${host}:${port}` };
  if (p.length >= 4) { r.username = p[2]; r.password = p[3]; }
  return r;
}

function parseProxyList(text) {
  if (!text || typeof text !== "string") return [];
  return text.split("\n").map(parseProxyLine).filter(Boolean);
}

function testProxyTCP(proxyObj, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyObj.server);
      const sock = new net.Socket();
      const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
      sock.once("connect", () => { clearTimeout(timer); sock.destroy(); resolve(true); });
      sock.once("error", () => { clearTimeout(timer); sock.destroy(); resolve(false); });
      sock.connect(parseInt(url.port), url.hostname);
    } catch { resolve(false); }
  });
}

// Test proxy can actually fetch a page (not just TCP connect)
async function testProxyHTTP(proxyObj, timeoutMs = 8000) {
  const { execFile } = await import('child_process');
  return new Promise((resolve) => {
    try {
      const isSocks = proxyObj.server.startsWith('socks');
      const flag = isSocks ? '--socks5-hostname' : '--proxy';
      // Build proxy URL with credentials: socks5://user:pass@host:port
      const url = new URL(proxyObj.server);
      if (proxyObj.username) url.username = proxyObj.username;
      if (proxyObj.password) url.password = proxyObj.password;
      const proxyArg = url.toString();
      const timer = setTimeout(() => resolve(false), timeoutMs);
      execFile('curl', [
        '-s', '-o', '/dev/null', '-w', '%{http_code}',
        flag, proxyArg,
        '--connect-timeout', '5',
        '--max-time', '6',
        'http://connectivitycheck.gstatic.com/generate_204'
      ], { timeout: timeoutMs }, (err, stdout) => {
        clearTimeout(timer);
        const code = parseInt(stdout.trim(), 10);
        resolve(!err && code >= 200 && code < 400);
      });
    } catch { resolve(false); }
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/**
 * Pick a working proxy. Tests up to 10 in parallel via TCP.
 * Returns first reachable, or null → direct.
 */
async function pickWorkingProxy(proxyText, logFn) {
  const log = logFn || (() => {});
  const all = parseProxyList(proxyText);
  if (all.length === 0) return null;
  const candidates = shuffle([...all]).slice(0, 10);
  log(`Testing ${candidates.length} proxy(ies)...`);
  // First: TCP check in parallel
  const tcpResults = await Promise.allSettled(candidates.map(async (proxy) => {
    const label = proxy.server.replace(/^(socks[45]|http):\/\//, "");
    const ok = await testProxyTCP(proxy, 3000);
    return { proxy, label, ok };
  }));
  const alive = tcpResults
    .filter(r => r.status === "fulfilled" && r.value.ok)
    .map(r => r.value);
  for (const r of tcpResults) {
    if (r.status === "fulfilled" && !r.value.ok) log(`✗ Proxy dead: ${r.value.label}`);
  }
  if (alive.length === 0) {
    log("⚠ All proxies failed — falling back to direct connection");
    return null;
  }
  log(`✓ Proxy alive: ${alive[0].label} (${alive[0].proxy.server.split("://")[0]})`);
  return alive[0].proxy;
}

function buildChromeArgs(fp, useProxy) {
  const args = [`--window-size=${fp.viewport.width},${fp.viewport.height}`, "--disable-blink-features=AutomationControlled"];
  if (useProxy) args.push("--ignore-certificate-errors");
  return args;
}

// ═══════════════════════════════════════════════════════════
// ── Batch helpers ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
const logListeners = new Map();
function getBatch(id) { return db[id] || null; }
function getAllBatches() { return Object.values(db).sort((a, b) => (b.startedAt || b.id).localeCompare(a.startedAt || a.id)); }
function persistBatch(batch) { db[batch.id] = batch; saveDB(db); }

function createBatch(config) {
  const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const batch = { id, config, status: "idle", generator: config.generator || "mimo",
    progress: { current: 0, total: config.count, success: 0, failed: 0 },
    results: [], logs: [], startedAt: null, completedAt: null };
  persistBatch(batch);
  const batchDir = join(OUTPUT_DIR, id);
  mkdirSync(batchDir, { recursive: true });
  writeFileSync(join(batchDir, "apiKey.txt"), "", "utf8");
  writeFileSync(join(batchDir, "results.json"), "[]", "utf8");
  return batch;
}

function addLog(batchId, message) {
  const batch = db[batchId]; if (!batch) return;
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  const line = `[${ts}] ${message}`;
  batch.logs.push(line);
  if (batch.logs.length > 2000) batch.logs.shift();
  if (batch.logs.length % 5 === 0) saveDB(db);
  const batchDir = join(OUTPUT_DIR, batchId);
  if (existsSync(batchDir)) appendFileSync(join(batchDir, "batch.log"), line + "\n", "utf8");
  const listeners = logListeners.get(batchId);
  if (listeners) listeners.forEach(fn => fn(line, batch));
}

// ── Master Keys Storage (persists across all batches) ──
function loadMasterKeys() {
  if (!existsSync(MASTER_KEYS_FILE)) return [];
  try { return JSON.parse(readFileSync(MASTER_KEYS_FILE, "utf8")); } catch { return []; }
}

function appendMasterKey(entry) {
  const keys = loadMasterKeys();
  // Deduplicate by email
  if (keys.some(k => k.email === entry.email)) return;
  keys.push({
    email: entry.email,
    password: entry.password,
    apiKey: entry.apiKey,
    cookies: entry.cookies || {},
    provider: entry.provider || "mimo",
    created_at: entry.created_at || new Date().toISOString(),
  });
  writeFileSync(MASTER_KEYS_FILE, JSON.stringify(keys, null, 2), "utf8");
  // Also append to master txt file
  const masterTxt = join(DB_DIR, "master-keys.txt");
  appendFileSync(masterTxt, entry.apiKey + "\n", "utf8");
}

function setStatus(batchId, status) {
  const batch = db[batchId]; if (!batch) return;
  batch.status = status;
  if (status === "running" && !batch.startedAt) batch.startedAt = new Date().toISOString();
  if (["completed", "stopped", "error"].includes(status)) batch.completedAt = new Date().toISOString();
  saveDB(db);
}

function saveBatchResult(batchId, row) {
  const batch = db[batchId]; if (!batch) return;
  const batchDir = join(OUTPUT_DIR, batchId);
  if (row.apiKey && existsSync(batchDir)) appendFileSync(join(batchDir, "apiKey.txt"), row.apiKey + "\n", "utf8");
  const entry = { email: row.email, password: row.password,
    cookies: { passToken: row.passToken || null, cUserId: row.cUserId || null, userId: row.userId || null },
    apiKey: row.apiKey || null, created_at: new Date().toISOString(),
    status: row.apiKey ? "success" : "failed", ultraspeed: row.ultraspeed || false, error: row.error || null, extra: row.extra || null };
  batch.results.push(entry);
  const rf = join(batchDir, "results.json");
  if (existsSync(rf)) { try { const a = JSON.parse(readFileSync(rf, "utf8")); a.push(entry); writeFileSync(rf, JSON.stringify(a, null, 2), "utf8"); } catch {} }
  saveDB(db);
}

// ═══════════════════════════════════════════════════════════
// ── Registration Runners ──────────────────────────────────
// ═══════════════════════════════════════════════════════════
async function runBatch(batchId, config) {
  if (config.generator === "qwencloud") return runQwenBatch(batchId, config);
  return runMimoBatch(batchId, config);
}

// ── MiMo (PARALLEL — API-first, browser fallback) ────────
async function runMimoBatch(batchId, config) {
  const useApiMode = config.mode !== "browser"; // default: api mode
  const threadCount = Math.min(config.threads || 1, config.count);
  let currentRef = config.seedCode;
  let nextIdx = 0, activeCount = 0, stopped = false;
  const useProxy = parseProxyList(config.proxies || "").length > 0;

  addLog(batchId, `🚀 Launching ${threadCount} thread(s) for ${config.count} accounts (${useApiMode ? "API" : "Browser"} mode)...`);
  if (useProxy) addLog(batchId, `🌐 ${parseProxyList(config.proxies).length} proxy loaded`);

  async function runAccount(idx, total, ref, threadId) {
    const batch = db[batchId];
    if (!batch || batch.status === "stopped") return { ok: false };
    const tag = `[T${threadId}]`;
    addLog(batchId, `${tag} Account ${idx + 1}/${total} starting...`);
    batch.progress.current = Math.max(batch.progress.current, idx + 1);

    const iterConfig = {
      tempmail: { apiBaseUrl: PROJECT_CONFIG.tempmail?.apiBaseUrl || "http://localhost:3030" },
      captcha: { provider: config.captchaProvider, apiKey: config.captchaApiKey },
      nineRouter: { url: process.env.NINEROUTER_URL || PROJECT_CONFIG.nineRouter?.url, key: process.env.NINEROUTER_KEY || PROJECT_CONFIG.nineRouter?.key, model: PROJECT_CONFIG.nineRouter?.model },
      xiaomi: { inviteCode: ref, referralLink: `https://platform.xiaomimimo.com/?ref=${encodeURIComponent(ref)}`,
        password: config.password, betaApplication: "MiMo-V2.5-Pro-UltraSpeed" },
      browser: { headless: config.headless, timeout: 60000, screenshots: false },
      proxy: { enabled: false, rotatePerAccount: true, defaultCountry: "US", maxRetries: 3, proxyList: [] },
    };

    let email = null, apiKey = null, passToken = null, cUserId = null, userId = null;

    try {
      if (useApiMode) {
        // ── API mode ───────────────────────────────────────
        const { MimoApiRegistration } = await import("../src/core/mimo-api-registration.js");
        const apiReg = new MimoApiRegistration(iterConfig);
        const result = await apiReg.run();
        email = result.email;
        apiKey = result.apiKey;
        passToken = result.passToken;
        cUserId = result.cUserId;
        userId = result.userId;

        // Forward API logs to batch log
        if (result.logs) {
          for (const line of result.logs) {
            addLog(batchId, `${tag} ${line.replace(/^\[[\d:]+\]\s*/, '')}`);
          }
        }

        if (apiKey) {
          addLog(batchId, `${tag} ✅ Account ${idx + 1} success (API) — ${email}`);
          batch.progress.success++;
          saveBatchResult(batchId, { email, password: config.password, apiKey, passToken, cUserId, userId, ultraspeed: true });
          appendMasterKey({ email, password: config.password, apiKey, cookies: { passToken, cUserId, userId }, provider: "mimo" });
          return { ok: true };
        } else if (passToken) {
          // Got session but no API key — try to create via platform REST
          addLog(batchId, `${tag} ⚠ Got session cookies, trying platform REST for API key...`);
          try {
            const platRes = await fetch(`https://platform.xiaomimimo.com/api/v1/keys`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cookie": `passToken=${passToken}; cUserId=${cUserId || ""}; userId=${userId || ""}`,
              },
              body: JSON.stringify({ name: "mykey" }),
            });
            const platText = await platRes.text().catch(() => "");
            addLog(batchId, `${tag} Platform /api/v1/keys: ${platRes.status} — ${platText.substring(0, 150)}`);
            let platData = {};
            try { platData = JSON.parse(platText); } catch {}
            const foundKey = platData.key || platData.apiKey || platData.data?.key;
            if (foundKey) {
              apiKey = foundKey;
              addLog(batchId, `${tag} ✅ API key created via platform REST`);
            }
          } catch (e) {
            addLog(batchId, `${tag} Platform REST error: ${e.message}`);
          }

          if (apiKey) {
            batch.progress.success++;
            saveBatchResult(batchId, { email, password: config.password, apiKey, passToken, cUserId, userId, ultraspeed: true });
            appendMasterKey({ email, password: config.password, apiKey, cookies: { passToken, cUserId, userId }, provider: "mimo" });
            return { ok: true };
          }
        }

        // API mode failed — report error, do NOT fall back to browser
        addLog(batchId, `${tag} ❌ API mode failed — ${result.error || "no key obtained"}`);
        batch.progress.failed++;
        saveBatchResult(batchId, { email, password: config.password, ultraspeed: false, error: result.error || "API mode: no key" });
        return { ok: false };
      }

      // ── Browser mode (original flow or API fallback) ─────
      const { MimoRegistration } = await import("../src/core/registration.js");
      const { generateFingerprint, buildInitScript, buildExtraHeaders } = await import("../src/browser/fingerprint.js");
      const { chromium } = await import("playwright");

      if (!email) {
        const tmpReg = new MimoRegistration(iterConfig);
        email = await tmpReg.tempmail.createInbox();
      }
      addLog(batchId, `${tag} Email: ${email}`);
      const fp = generateFingerprint();
      addLog(batchId, `${tag} Chrome ${fp.chromeMajor}`);

      const maxAttempts = useProxy ? 4 : 1;
      let connected = false;
      let lastErr = null;

      for (let attempt = 0; attempt < maxAttempts && !connected; attempt++) {
        let proxyObj = null;
        if (useProxy && attempt < 3) {
          proxyObj = await pickWorkingProxy(config.proxies, msg => addLog(batchId, `${tag} ${msg}`));
          if (!proxyObj) addLog(batchId, `${tag} No working proxy, trying direct`);
        } else if (useProxy && attempt === 3) {
          addLog(batchId, `${tag} Falling back to direct connection`);
        }

        const reg = new MimoRegistration(iterConfig);
        if (!reg.tempmail) reg.tempmail = new (await import("../src/clients/mocasus-api-client.js")).MocasusApiClient(PROJECT_CONFIG.tempmail?.apiBaseUrl || "http://localhost:3030");
        let tunnel = null;
        try {
          const chromeArgs = buildChromeArgs(fp, !!proxyObj);
          const launchOpts = { headless: config.headless, channel: "chrome", args: chromeArgs };
          if (proxyObj) {
            if (proxyObj.username && proxyObj.password) {
              tunnel = await startTunnel(proxyObj);
              launchOpts.proxy = { server: `socks5://127.0.0.1:${tunnel.port}` };
              addLog(batchId, `${tag} Tunnel: 127.0.0.1:${tunnel.port}`);
            } else {
              launchOpts.proxy = proxyObj;
            }
          }

          reg.browser = await chromium.launch(launchOpts);
          const ctx = await reg.browser.newContext({
            userAgent: fp.userAgent, viewport: fp.viewport, deviceScaleFactor: fp.deviceScaleFactor,
            locale: fp.locale, timezoneId: fp.timezone,
            screen: { width: fp.screen.width, height: fp.screen.height },
            extraHTTPHeaders: buildExtraHeaders(fp),
          });
          await ctx.addInitScript({ content: buildInitScript(fp) });
          reg.page = await ctx.newPage();

          if (proxyObj) addLog(batchId, `${tag} Proxy: ${proxyObj.server.replace(/^(socks[45]|http):\/\//, "")}`);
          addLog(batchId, `${tag} Navigating...`);
          await reg.page.goto(iterConfig.xiaomi.referralLink, { waitUntil: "networkidle", timeout: 60000 });

          addLog(batchId, `${tag} Filling form...`);
          await reg.fillRegistrationForm(email);
          addLog(batchId, `${tag} Submitting...`);
          await reg.submitRegistration();
          addLog(batchId, `${tag} Solving captcha...`);
          await reg.handleXiaomiCaptcha();
          await reg.handleImageCaptcha();
          addLog(batchId, `${tag} Captcha solved ✓`);
          addLog(batchId, `${tag} Verifying email...`);
          await reg.verifyEmail(email);
          addLog(batchId, `${tag} Email verified ✓`);
          addLog(batchId, `${tag} Creating API key...`);
          try { apiKey = await reg.createApiKey(); } catch (e) { addLog(batchId, `${tag} API key error: ${e.message}`); }
          addLog(batchId, `${tag} Filling Ultraspeed...`);
          try { await reg.fillUltraspeedForm(email); } catch (e) { addLog(batchId, `${tag} Ultraspeed error: ${String(e?.message || e)}`); }

          try {
            const cookies = await reg.page.context().cookies();
            passToken = cookies.find(c => c.name === "passToken")?.value || passToken;
            cUserId = cookies.find(c => c.name === "cUserId")?.value || cUserId;
            userId = cookies.find(c => c.name === "userId")?.value || userId;
          } catch {}
          connected = true;
        } catch (err) {
          lastErr = err;
          addLog(batchId, `${tag} Error: ${String(err?.message || err).substring(0, 200)}`);
          const isConnErr = /ERR_CONNECTION|ERR_CERT|ERR_PROXY|net::|ECONNRESET|ECONNREFUSED|tunnel|CERT_AUTHORITY/i.test(err?.message || "");
          if (isConnErr && attempt < maxAttempts - 1) addLog(batchId, `${tag} ⚠ Connection error, trying next proxy...`);
        } finally {
          if (reg.browser) await reg.browser.close().catch(() => {});
          if (tunnel) { try { tunnel.close(); } catch {} }
        }
      }

      if (!connected) throw lastErr || new Error("Failed to connect after all attempts");

      if (apiKey) {
        addLog(batchId, `${tag} ✅ Account ${idx + 1} success — ${email}`);
        batch.progress.success++;
        saveBatchResult(batchId, { email, password: config.password, apiKey, passToken, cUserId, userId, ultraspeed: true });
        appendMasterKey({ email, password: config.password, apiKey, cookies: { passToken, cUserId, userId }, provider: "mimo" });
        return { ok: true };
      } else {
        addLog(batchId, `${tag} ❌ Account ${idx + 1} failed — no API key`);
        batch.progress.failed++;
        saveBatchResult(batchId, { email, password: config.password, ultraspeed: false, error: "No API key obtained" });
        return { ok: false };
      }
    } catch (err) {
      const errMsg = String(err?.message || err || "unknown");
      const isRetryable = /captcha|CAPTCHA|unsolvable|timeout|ECONNREFUSED|ETIMEDOUT|proxy|restrict/i.test(errMsg);
      if (isRetryable) { addLog(batchId, `${tag} ⚠ Account ${idx + 1} error, retrying...`); return { ok: false, retry: true }; }
      addLog(batchId, `${tag} ❌ Account ${idx + 1} error: ${errMsg.substring(0, 200)}`);
      batch.progress.failed++;
      saveBatchResult(batchId, { email, password: config.password, ultraspeed: false, error: errMsg });
      return { ok: false, retry: false };
    }
  }

  return new Promise((resolve) => {
    const retryCount = new Map();
    function launchNext() {
      while (activeCount < threadCount && nextIdx < config.count && !stopped) {
        const idx = nextIdx++; const threadId = (idx % threadCount) + 1; activeCount++;
        runAccount(idx, config.count, currentRef, threadId).then(result => {
          if (result.retry) {
            const retries = retryCount.get(idx) || 0;
            if (retries < 3) {
              retryCount.set(idx, retries + 1);
              addLog(batchId, `[T${threadId}] ↻ Retry ${retries + 1}/3`);
              nextIdx = idx;
            } else {
              addLog(batchId, `[T${threadId}] ❌ Max retries reached`);
              if (db[batchId]) db[batchId].progress.failed++;
            }
          }
        }).finally(() => {
          activeCount--;
          const b = db[batchId];
          if (!b || b.status === "stopped") stopped = true;
          if (nextIdx >= config.count && activeCount === 0) { if (b && b.status === "running") { setStatus(batchId, "completed"); addLog(batchId, `Done — ${b.progress.success} success, ${b.progress.failed} failed`); } resolve(); }
          else if (!stopped) setTimeout(launchNext, 100);
          else if (activeCount === 0) { if (b && b.status === "running") { setStatus(batchId, "stopped"); addLog(batchId, `Stopped — ${b.progress.success} success, ${b.progress.failed} failed`); } resolve(); }
        });
      }
    }
    launchNext();
  });
}

// ── QwenCloud (PARALLEL) ────────────────────────────────
async function runQwenBatch(batchId, config) {
  const { QwenRegistration } = await import("../src/core/qwen-registration.js");
  const threadCount = Math.min(config.threads || 1, config.count);
  let nextIdx = 0, activeCount = 0, stopped = false;
  const useProxy = parseProxyList(config.proxies || "").length > 0;

  addLog(batchId, `🚀 Launching ${threadCount} parallel thread(s) for ${config.count} QwenCloud accounts...`);
  if (useProxy) addLog(batchId, `🌐 ${parseProxyList(config.proxies).length} proxy loaded`);

  async function runAccount(idx, total, threadId) {
    const batch = db[batchId];
    if (!batch || batch.status === "stopped") return { ok: false };
    const tag = `[T${threadId}]`;
    addLog(batchId, `${tag} Account ${idx+1}/${total} starting...`);
    batch.progress.current = Math.max(batch.progress.current, idx + 1);

    // Proxy retry: try up to 3 proxies + direct fallback
    const maxAttempts = useProxy ? 4 : 1;
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let proxyStr = null;
      if (useProxy && attempt < 3) {
        const proxyObj = await pickWorkingProxy(config.proxies, msg => addLog(batchId, `${tag} ${msg}`));
        if (proxyObj) {
          proxyStr = proxyObj.server;
          if (proxyObj.username) proxyStr = proxyObj.server.replace("://", `://${proxyObj.username}:${proxyObj.password}@`);
          addLog(batchId, `${tag} Proxy: ${proxyObj.server.replace(/^(socks[45]|http):\/\//, "")}`);
        } else {
          addLog(batchId, `${tag} No working proxy, trying direct`);
        }
      } else if (useProxy && attempt === 3) {
        addLog(batchId, `${tag} Falling back to direct connection`);
      }

      const qwenConfig = {
        browser: { headless: config.headless, timeout: 60000 },
        tempmail: { apiUrl: config.tempmailUrl || "https://tempik.hindiabelanda.my.id/api" },
      };

      const reg = new QwenRegistration(qwenConfig);
      reg.on("log", msg => addLog(batchId, `${tag} ${msg}`));

      try {
        const result = await reg.run({ email: null, proxy: proxyStr, country: config.country || "", apiKeyDesc: "default" });
        const rEmail = result.email || "unknown";

        if (result.status === "success" && result.apiKey) {
          addLog(batchId, `${tag} ✅ Account ${idx+1} success — ${rEmail}`);
          batch.progress.success++;
          saveBatchResult(batchId, { email: rEmail, password: "", apiKey: result.apiKey, ultraspeed: false,
            extra: { baseUrlOpenai: result.baseUrlOpenai, baseUrlAnthropic: result.baseUrlAnthropic, country: result.country } });
          try { appendMasterKey({ email: rEmail, password: "", apiKey: result.apiKey, provider: "qwencloud" }); } catch {}
          return { ok: true };
        } else if (result.status === "success-no-key") {
          addLog(batchId, `${tag} ⚠ Account ${idx+1} registered but no API key — ${rEmail}`);
          batch.progress.failed++;
          saveBatchResult(batchId, { email: rEmail, password: "", ultraspeed: false, error: "No API key obtained" });
          return { ok: false };
        } else {
          lastErr = new Error(result.reason || result.status);
          const isConnErr = /ERR_CONNECTION|ERR_CERT|ERR_PROXY|net::|ECONNRESET|ECONNREFUSED|tunnel|CERT_AUTHORITY/i.test(lastErr.message);
          if (isConnErr && attempt < maxAttempts - 1) {
            addLog(batchId, `${tag} ⚠ Connection error, trying next proxy...`);
            continue;
          }
          addLog(batchId, `${tag} ❌ Account ${idx+1} failed: ${lastErr.message}`);
          batch.progress.failed++;
          saveBatchResult(batchId, { email: rEmail, password: "", ultraspeed: false, error: lastErr.message });
          return { ok: false };
        }
      } catch (err) {
        lastErr = err;
        const isConnErr = /ERR_CONNECTION|ERR_CERT|ERR_PROXY|net::|ECONNRESET|ECONNREFUSED|tunnel|CERT_AUTHORITY/i.test(err.message);
        if (isConnErr && attempt < maxAttempts - 1) {
          addLog(batchId, `${tag} ⚠ Connection error, trying next proxy...`);
          continue;
        }
        addLog(batchId, `${tag} ❌ Account ${idx+1} error: ${err.message}`);
        batch.progress.failed++;
        saveBatchResult(batchId, { email: "unknown", password: "", ultraspeed: false, error: err.message });
        return { ok: false };
      }
    }

    // All attempts exhausted
    addLog(batchId, `${tag} ❌ Account ${idx+1} failed after all proxy attempts`);
    batch.progress.failed++;
    saveBatchResult(batchId, { email: "unknown", password: "", ultraspeed: false, error: "All proxy attempts failed" });
    return { ok: false };
  }

  return new Promise((resolve) => {
    function launchNext() {
      while (activeCount < threadCount && nextIdx < config.count && !stopped) {
        const idx = nextIdx++; const threadId = (idx % threadCount) + 1; activeCount++;
        runAccount(idx, config.count, threadId).finally(() => {
          activeCount--;
          const b = db[batchId];
          if (!b || b.status === "stopped") stopped = true;
          if (nextIdx >= config.count && activeCount === 0) { if (b && b.status === "running") { setStatus(batchId, "completed"); addLog(batchId, `Done — ${b.progress.success} success, ${b.progress.failed} failed`); } resolve(); }
          else if (!stopped) setTimeout(launchNext, 500);
          else if (activeCount === 0) { if (b && b.status === "running") { setStatus(batchId, "stopped"); addLog(batchId, `Stopped — ${b.progress.success} success, ${b.progress.failed} failed`); } resolve(); }
        });
      }
    }
    launchNext();
  });
}

// ═══════════════════════════════════════════════════════════
// ── HTTP Server ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
function parseBody(req) { return new Promise((r) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b)); } catch { r({}); } }); }); }
function sendJSON(req, res, data, status = 200) { setCors(req, res); res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin || "*";
    res.writeHead(204, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Credentials": "true" });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Auth
  if (req.method === "POST" && url.pathname === "/api/login") {
    const { username, password } = await parseBody(req);
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = createSession("admin");
      setCors(req, res); res.setHeader("Set-Cookie", `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
      return sendJSON(req, res, { ok: true, role: "admin" });
    }
    return sendJSON(req, res, { ok: false, error: "Invalid credentials" }, 401);
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    setCors(req, res); res.setHeader("Set-Cookie", `session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return sendJSON(req, res, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    const s = getAuth(req);
    return sendJSON(req, res, s ? { ok: true, role: s.role } : { ok: false, role: "guest" });
  }

  function sanitizeBatch(b) { const { config: c, ...rest } = b; return { ...rest, config: { generator: c?.generator, count: c?.count, headless: c?.headless, threads: c?.threads } }; }

  // Batches list
  if (req.method === "GET" && url.pathname === "/api/batches") {
    const all = getAllBatches(); const admin = isAdmin(req);
    return sendJSON(req, res, admin ? all : all.map(sanitizeBatch));
  }
  // Single batch
  if (req.method === "GET" && url.pathname === "/api/batch") {
    const id = url.searchParams.get("id"); if (!id) return sendJSON(req, res, { error: "id required" }, 400);
    const batch = getBatch(id); if (!batch) return sendJSON(req, res, { error: "Not found" }, 404);
    return sendJSON(req, res, isAdmin(req) ? batch : sanitizeBatch(batch));
  }
  // SSE logs
  if (req.method === "GET" && url.pathname === "/api/logs") {
    const id = url.searchParams.get("id"); if (!id) return sendJSON(req, res, { error: "id required" }, 400);
    const batch = getBatch(id); if (!batch) return sendJSON(req, res, { error: "Not found" }, 404);
    const admin = isAdmin(req);
    setCors(req, res);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    for (const line of batch.logs) res.write(`data: ${JSON.stringify({ log: line, batch: admin ? batch : sanitizeBatch(batch) })}\n\n`);
    const listener = (line, ub) => { try { res.write(`data: ${JSON.stringify({ log: line, batch: admin ? ub : sanitizeBatch(ub) })}\n\n`); } catch {} };
    if (!logListeners.has(id)) logListeners.set(id, new Set());
    logListeners.get(id).add(listener);
    const interval = setInterval(() => { try { const b = db[id]; res.write(`data: ${JSON.stringify({ heartbeat: true, batch: admin ? b : sanitizeBatch(b) })}\n\n`); } catch { clearInterval(interval); } }, 15000);
    req.on("close", () => { logListeners.get(id)?.delete(listener); clearInterval(interval); });
    return;
  }
  // Stats
  if (req.method === "GET" && url.pathname === "/api/stats") {
    const all = Object.values(db);
    return sendJSON(req, res, { totalBatches: all.length, running: all.filter(b => b.status === "running").length,
      completed: all.filter(b => b.status === "completed").length,
      totalSuccess: all.reduce((s, b) => s + b.progress.success, 0), totalFailed: all.reduce((s, b) => s + b.progress.failed, 0) });
  }


  // Fetch proxies from ProxyScrape API — test in parallel, return only alive
  if (req.method === "GET" && url.pathname === "/api/proxies") {
    try {
      const protocol = url.searchParams.get("protocol") || "socks5";
      const apiUrl = `https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=${protocol}&timeout=5000`;
      const resp = await fetch(apiUrl);
      if (!resp.ok) return sendJSON(req, res, { error: `ProxyScrape returned ${resp.status}` }, 502);
      const text = await resp.text();
      const rawLines = text.split("\n").filter(l => l.trim());
      const parsed = rawLines.map(parseProxyLine).filter(Boolean);

      // Test up to 50 proxies in parallel, 3s timeout each
      const toTest = shuffle([...parsed]).slice(0, 50);
      // TCP check — fast
      const tcpResults = await Promise.allSettled(toTest.map(async (p) => {
        const ok = await testProxyTCP(p, 3000);
        return { proxy: p, ok };
      }));
      const alive = tcpResults
        .filter(r => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value.proxy.server);

      return sendJSON(req, res, { proxies: alive, count: alive.length, tested: toTest.length, raw: rawLines.length, protocol });
    } catch (e) {
      return sendJSON(req, res, { error: e.message }, 500);
    }
  }

  // Save proxies to file
  const PROXY_FILE = join(DB_DIR, "proxies.txt");
  if (req.method === "POST" && url.pathname === "/api/proxies/save") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const body = await parseBody(req);
    const proxyText = body.proxies || "";
    writeFileSync(PROXY_FILE, proxyText, "utf8");
    const count = parseProxyList(proxyText).length;
    return sendJSON(req, res, { ok: true, count });
  }

  // Load saved proxies
  if (req.method === "GET" && url.pathname === "/api/proxies/saved") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    if (existsSync(PROXY_FILE)) {
      const text = readFileSync(PROXY_FILE, "utf8");
      const count = parseProxyList(text).length;
      return sendJSON(req, res, { proxies: text, count });
    }
    return sendJSON(req, res, { proxies: "", count: 0 });
  }

  // Master keys API — all keys from all MiMo batches
  if (req.method === "GET" && url.pathname === "/api/master-keys") {
    const keys = loadMasterKeys();
    const successKeys = keys.filter(k => k.apiKey);
    return sendJSON(req, res, { keys: successKeys, total: successKeys.length });
  }

  // Checker API — submit to external checker, return queue_id immediately
  if (req.method === "POST" && url.pathname === "/api/checker") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const body = await parseBody(req);
    let accounts = body.accounts || [];

    if (accounts.length === 0) {
      const masterKeys = loadMasterKeys().filter(k => k.provider === "mimo");
      accounts = masterKeys;
    }
    if (accounts.length === 0) {
      return sendJSON(req, res, { error: "No accounts found." });
    }

    const validAccounts = accounts.filter(a => a.email && a.cookies?.passToken && a.cookies?.cUserId && a.cookies?.userId);
    if (validAccounts.length === 0) {
      return sendJSON(req, res, { error: "No valid accounts (need email + cookies)" });
    }

    try {
      console.log(`[Checker] Submitting ${validAccounts.length} accounts`);
      const resp = await fetch("https://apikey.jimixz.tech/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: validAccounts.map(a => ({
            email: a.email, password: a.password || "", apiKey: a.apiKey || "",
            cookies: { passToken: a.cookies.passToken, cUserId: a.cookies.cUserId, userId: a.cookies.userId },
            provider: a.provider || "mimo", created_at: a.created_at || new Date().toISOString(),
          })),
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown");
        return sendJSON(req, res, { error: `API ${resp.status}: ${errText.substring(0, 200)}` });
      }
      const data = await resp.json();
      const queueId = data.task_id || data.queue_id || data.id;
      console.log(`[Checker] Queue: ${queueId}`);
      if (!queueId) return sendJSON(req, res, { error: "No task_id", raw: JSON.stringify(data).substring(0, 300) });
      return sendJSON(req, res, { queueId, total: validAccounts.length });
    } catch (e) {
      return sendJSON(req, res, { error: e.message });
    }
  }


  // Download master keys as txt or json
  if (req.method === "GET" && url.pathname === "/api/master-keys/download") {
    const format = url.searchParams.get("format") || "txt";
    const keys = loadMasterKeys().filter(k => k.apiKey);
    if (format === "json") {
      setCors(req, res);
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="master-keys.json"' });
      return res.end(JSON.stringify(keys, null, 2));
    }
    const txt = keys.map(k => k.apiKey).join("\n") + "\n";
    setCors(req, res);
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="master-keys.txt"' });
    return res.end(txt);
  }

  // Admin-only
  if (req.method === "POST" && url.pathname === "/api/batch") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const config = await parseBody(req);
    // Auto-load saved proxies if none provided
    if (!config.proxies && existsSync(PROXY_FILE)) {
      const savedProxies = readFileSync(PROXY_FILE, "utf8").trim();
      if (savedProxies) config.proxies = savedProxies;
    }
    const batch = createBatch(config);
    setStatus(batch.id, "running");
    const proxyInfo = parseProxyList(config.proxies || "").length;
    addLog(batch.id, `Started — ${config.count} accounts, headless: ${config.headless}, threads: ${config.threads || 1}, generator: ${config.generator || "mimo"}${proxyInfo ? `, proxies: ${proxyInfo}` : ""}`);
    if (config.generator === "qwencloud") {
      addLog(batch.id, '⚠ QwenCloud generator is disabled. Use MiMo instead.');
      setStatus(batch.id, "error");
    } else {
      runBatch(batch.id, config).catch(err => { addLog(batch.id, `Fatal: ${err.message}`); setStatus(batch.id, "error"); });
    }
    return sendJSON(req, res, batch);
  }
  if (req.method === "PATCH" && url.pathname === "/api/batch") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const { id, action } = await parseBody(req);
    const batch = db[id]; if (!batch) return sendJSON(req, res, { error: "Not found" }, 404);
    if (action === "stop") { setStatus(id, "stopped"); addLog(id, "Stopped by user"); }
    return sendJSON(req, res, batch);
  }
  if (req.method === "DELETE" && url.pathname === "/api/batch") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const { id } = await parseBody(req);
    if (!db[id]) return sendJSON(req, res, { error: "Not found" }, 404);
    delete db[id]; logListeners.delete(id); saveDB(db);
    return sendJSON(req, res, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/download") {
    if (!isAdmin(req)) return sendJSON(req, res, { error: "Unauthorized" }, 401);
    const id = url.searchParams.get("id"); const type = url.searchParams.get("type") || "json";
    const batchDir = join(OUTPUT_DIR, id);
    if (type === "txt") { const fp = join(batchDir, "apiKey.txt"); if (existsSync(fp)) { setCors(req, res); res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": `attachment; filename="${id}-apiKeys.txt"` }); return res.end(readFileSync(fp, "utf8")); } }
    if (type === "json") { const fp = join(batchDir, "results.json"); if (existsSync(fp)) { setCors(req, res); res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${id}-results.json"` }); return res.end(readFileSync(fp, "utf8")); } }
    const batch = db[id]; if (!batch) return sendJSON(req, res, { error: "Not found" }, 404);
    if (type === "txt") { const c = batch.results.filter(r => r.apiKey).map(r => r.apiKey).join("\n") + "\n"; setCors(req, res); res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": `attachment; filename="api-keys.txt"` }); return res.end(c); }
    const json = JSON.stringify(batch.results.map(r => ({ email: r.email, password: r.password, cookies: { passToken: r.passToken, cUserId: r.cUserId, userId: r.userId }, created_at: r.created_at, status: r.status, ultraspeed: r.ultraspeed, error: r.error })), null, 2);
    setCors(req, res); res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="results.json"` }); return res.end(json);
  }

  // ── Mocasus TempMail API ────────────────────────────────
  // GET /api/tempmail/email?domain=moymoy.me → generate email
  if (req.method === "GET" && url.pathname === "/api/tempmail/email") {
    try {
      const domain = url.searchParams.get("domain") || null;
      const result = domain
        ? { email: await mocasusMail.createInbox(null, domain), password: null }
        : await mocasusMail.generateEmailWithPassword();
      return sendJSON(req, res, { ok: true, email: result.email, password: result.password });
    } catch (e) { return sendJSON(req, res, { ok: false, error: e.message }, 500); }
  }
  // GET /api/tempmail/messages?addr=xxx → get messages
  if (req.method === "GET" && url.pathname === "/api/tempmail/messages") {
    const addr = url.searchParams.get("addr"); if (!addr) return sendJSON(req, res, { error: "addr required" }, 400);
    try {
      const wait = parseInt(url.searchParams.get("wait") || "180") * 1000;
      const interval = parseInt(url.searchParams.get("interval") || "5") * 1000;
      const messages = await mocasusMail.getMessages(addr, wait, interval);
      return sendJSON(req, res, { ok: true, count: messages.length, messages });
    } catch (e) { return sendJSON(req, res, { ok: false, error: e.message }, 500); }
  }
  // GET /api/tempmail/otp?addr=xxx → get OTP code
  if (req.method === "GET" && url.pathname === "/api/tempmail/otp") {
    const addr = url.searchParams.get("addr"); if (!addr) return sendJSON(req, res, { error: "addr required" }, 400);
    try {
      const wait = parseInt(url.searchParams.get("wait") || "180") * 1000;
      const interval = parseInt(url.searchParams.get("interval") || "5") * 1000;
      const otp = await mocasusMail.getOtp(addr, wait, interval);
      return sendJSON(req, res, { ok: true, email: addr, otp });
    } catch (e) { return sendJSON(req, res, { ok: false, error: e.message }, 500); }
  }
  // GET /api/tempmail/status → health check
  if (req.method === "GET" && url.pathname === "/api/tempmail/status") {
    return sendJSON(req, res, { ok: true, ownerToken: mocasusMail.ownerToken?.substring(0, 20) + "..." });
  }

  res.writeHead(404); res.end("Not found");
});

const PORT = 3001;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`\n  🔷 MiMo API Server running on http://${HOST}:${PORT}`);
  console.log(`  Admin login: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`  Database: ${DB_FILE}`);
  console.log(`  Loaded ${Object.keys(db).length} existing batch(es)\n`);
});
