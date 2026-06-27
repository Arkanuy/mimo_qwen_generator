/**
 * ChainRunner — reusable chain loop runner tanpa process.exit().
 * Emits events untuk integrasi bot Telegram / UI lainnya.
 *
 * Events:
 *   'start'    → { count, seedRef }
 *   'progress' → { idx, total, ok, email, refCode, apiKey, error }
 *   'done'     → { okCount, failCount, results[] }
 *   'stopped'  → { okCount, failCount, atIteration }
 *   'log'      → string (console replacement)
 */

import { EventEmitter } from 'events';
import { chromium } from 'playwright';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MimoRegistration } from '../core/registration.js';
import { generateFingerprint, buildInitScript, buildExtraHeaders } from '../browser/fingerprint.js';

const PROXY_ERROR_PATTERN = /ERR_TUNNEL|ERR_PROXY|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang|timeout|NS_ERROR/i;

class ChainRunner extends EventEmitter {
  constructor(config, proxyManager, outputDir) {
    super();
    this.config = config;
    this.proxyManager = proxyManager;
    this.outputDir = outputDir || join(import.meta.dirname || '.', '..', '..', 'output');
    this.outputFile = join(this.outputDir, 'chain-result.txt');
    this.failLog = join(this.outputDir, 'chain-fail.log');
    this._aborted = false;
    this._running = false;
    this._sessionResults = []; // Track results for current session only
    this._sessionJsonFile = join(this.outputDir, 'results.json');
  }

  get running() { return this._running; }

  stop() {
    this._aborted = true;
    this.emit('log', '⏹ Stop requested — finishing current iteration...');
  }

  async start({ count, seedRef }) {
    if (this._running) {
      this.emit('log', '⚠ Chain is already running');
      return;
    }

    this._aborted = false;
    this._running = true;

    const results = [];
    let currentRef = seedRef;
    let okCount = 0, failCount = 0;

    this.emit('start', { count, seedRef });

    for (let i = 0; i < count && !this._aborted; i++) {
      const result = await this._runIteration(i, count, currentRef);

      if (result.ok) {
        okCount++;
        results.push(result);
        if (result.refCode) {
          currentRef = result.refCode;
        } else {
          this.emit('log', `⚠ Stopping — iteration ${i + 1} succeeded but no refCode captured`);
          break;
        }
      } else {
        failCount++;
        results.push(result);
        if (result.restricted) {
          this.emit('log', `⛔ Chain stopped: ${result.stopReason}`);
          break;
        }
        this.emit('log', `↻ Iteration failed, retrying with same seed ${currentRef}`);
      }

      if (i < count - 1 && !this._aborted) {
        const wait = 8000 + Math.floor(Math.random() * 6000);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    this._running = false;

    if (this._aborted) {
      this.emit('stopped', { okCount, failCount, results });
    } else {
      this.emit('done', { okCount, failCount, results });
    }
  }

  async _runIteration(idx, total, currentRef) {
    const iterConfig = JSON.parse(JSON.stringify(this.config));
    iterConfig.xiaomi.inviteCode = currentRef;
    iterConfig.xiaomi.referralLink =
      `https://platform.xiaomimimo.com/?ref=${encodeURIComponent(currentRef)}`;

    const reg = new MimoRegistration(iterConfig);
    let email = null, refCode = null, apiKey = null;
    let currentProxy = null;

    try {
      email = await reg.tempmail.createInbox();

      const fp = generateFingerprint();
      reg.fingerprint = fp;

      currentProxy = null;
      if (this.proxyManager && this.proxyManager.count > 0) {
        currentProxy = this.proxyManager.getNext();
        if (currentProxy) {
          const hint = this.proxyManager.getFingerprintHint(this.config.proxy?.defaultCountry || 'US');
          fp.locale = hint.locale;
          fp.timezone = hint.timezone;
        }
      }

      reg.browser = await chromium.launch({
        headless: iterConfig.browser.headless,
        channel: 'chrome',
        args: [
          `--window-size=${fp.viewport.width},${fp.viewport.height}`,
          '--disable-blink-features=AutomationControlled',
        ],
      });

      const ctxOpts = {
        userAgent: fp.userAgent, viewport: fp.viewport,
        deviceScaleFactor: fp.deviceScaleFactor,
        locale: fp.locale, timezoneId: fp.timezone,
        screen: { width: fp.screen.width, height: fp.screen.height },
        extraHTTPHeaders: buildExtraHeaders(fp),
      };
      if (currentProxy) ctxOpts.proxy = currentProxy;

      const ctx = await reg.browser.newContext(ctxOpts);
      await ctx.addInitScript({ content: buildInitScript(fp) });
      reg.page = await ctx.newPage();

      const origScreenshot = reg.page.screenshot.bind(reg.page);
      reg.page.screenshot = async (opts = {}) => {
        const isError = opts.path && opts.path.includes('error');
        if (isError || iterConfig.browser.screenshots === true) return origScreenshot(opts);
        return Buffer.alloc(0);
      };

      await reg.page.goto(iterConfig.xiaomi.referralLink, {
        waitUntil: 'networkidle', timeout: iterConfig.browser.timeout,
      });

      await reg.fillRegistrationForm(email);
      await reg.submitRegistration();
      await reg.handleXiaomiCaptcha();
      await reg.handleImageCaptcha();
      await reg.verifyEmail(email);

      // Skip invite code redemption (risk control issues)
      console.log('  ⏭ Skipping invite code redemption');

      try { apiKey = await reg.createApiKey(); } catch (e) {}
      try { await reg.fillUltraspeedForm(email); } catch (e) {}

      // Skip getReferralCode — not needed, wastes time navigating balance page
      console.log('  ⏭ Skipping referral code scan');

      // Extract cookies
      let passToken = null, cUserId = null, userId = null;
      try {
        const cookies = await reg.page.context().cookies();
        passToken = cookies.find(c => c.name === 'passToken')?.value || null;
        cUserId = cookies.find(c => c.name === 'cUserId')?.value || null;
        userId = cookies.find(c => c.name === 'userId')?.value || null;
      } catch (e) {}

      this._saveResult({
        email,
        password: iterConfig.xiaomi.password,
        apiKey,
        passToken,
        cUserId,
        userId,
        ultraspeed: true,
      });

      const result = { ok: true, idx, total, email, refCode, apiKey };
      this.emit('progress', result);
      return result;

    } catch (err) {
      if (currentProxy && this.proxyManager && PROXY_ERROR_PATTERN.test(err.message)) {
        this.proxyManager.reportFailure(currentProxy);
      }

      this._logFailed(email, err.message);
      this._saveResult({ email, password: iterConfig.xiaomi.password, error: err.message });

      const result = {
        ok: false, idx, total, email, error: err.message,
        restricted: err.code === 'ACCOUNT_RESTRICTED' || err.code === 'BALANCE_NOT_CREDITED',
        stopReason: err.code,
      };
      this.emit('progress', result);
      return result;
    } finally {
      if (reg.browser) await reg.browser.close().catch(() => {});
    }
  }

  _saveResult(row) {
    // 1. Append API key to .txt (one per line)
    if (row.apiKey) {
      appendFileSync(this.outputFile, row.apiKey + '\n', 'utf8');
    }

    // 2. Build JSON entry
    const entry = {
      email: row.email,
      password: row.password,
      cookies: {
        passToken: row.passToken || null,
        cUserId: row.cUserId || null,
        userId: row.userId || null,
      },
      created_at: new Date().toISOString(),
      status: row.apiKey ? 'success' : 'failed',
      ultraspeed: row.ultraspeed || false,
      error: row.error || null,
    };
    this._sessionResults.push(entry);

    // 3. Write session results to JSON (overwrite each time — only current session)
    writeFileSync(this._sessionJsonFile, JSON.stringify(this._sessionResults, null, 2), 'utf8');
  }

  _logFailed(email, error) {
    const line = `[${new Date().toISOString()}] ${email || 'unknown'}  | ${error}\n`;
    appendFileSync(this.failLog, line, 'utf8');
  }
}

export { ChainRunner };
