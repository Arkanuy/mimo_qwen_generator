/**
 * QwenCloud auto-signup + API key extractor.
 * Node.js port of qwencloud_full.py.
 *
 * Uses tempmail API (same as MiMo) for email verification.
 */

import { EventEmitter } from 'events';

const COUNTRIES = [
  "Indonesia", "Malaysia", "Singapore", "Thailand", "Philippines",
  "Vietnam", "United States", "United Kingdom", "Germany",
  "Australia", "Canada", "Netherlands", "France", "India", "Brazil",
  "Mexico", "Turkey", "Spain", "Italy", "Sweden",
  "Norway", "Denmark", "Finland", "Poland", "Portugal",
  "Ireland", "Belgium", "Austria", "Switzerland", "Czech Republic",
  "Romania", "Greece", "Croatia", "Argentina", "Chile", "Colombia",
  "Peru", "South Africa", "New Zealand", "United Arab Emirates",
  "Saudi Arabia", "Egypt", "Morocco", "Kenya", "Nigeria",
];

const BASE_OPENAI = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const BASE_ANTHROPIC = "https://dashscope-intl.aliyuncs.com/apps/anthropic";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomCountry() { return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)]; }

export class QwenRegistration extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.browser = null;
    this.page = null;
    this.tempmailSession = null;
    this.tempmailUrl = config.tempmail?.apiUrl || 'https://tempik.hindiabelanda.my.id/api';
  }

  log(msg) { this.emit('log', msg); }

  // ── Tempmail API (same as MiMo) ──────────────────────
  async _initTempmailSession() {
    if (this.tempmailSession) return this.tempmailSession;
    const res = await fetch(`${this.tempmailUrl}/session`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Tempmail session failed: ${res.status}`);
    const data = await res.json();
    this.tempmailSession = data.sessionId || data.id || data.session_id;
    return this.tempmailSession;
  }

  async _createTempmailInbox() {
    const sid = await this._initTempmailSession();
    const res = await fetch(`${this.tempmailUrl}/inboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sid,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Tempmail inbox creation failed: ${res.status}`);
    const data = await res.json();
    return data.address;
  }

  async _pollTempmailMessages(address, timeout = 120000, interval = 5000) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.tempmailSession) headers['x-session-id'] = this.tempmailSession;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.tempmailUrl}/inboxes/${encodeURIComponent(address)}/messages`, { headers });
        if (res.ok) {
          const messages = await res.json();
          if (messages && messages.length > 0) return messages;
        }
      } catch {}
      await sleep(interval);
    }
    throw new Error('Timeout waiting for email');
  }

  _extractCode(messages) {
    for (const msg of messages) {
      const content = (msg.subject || '') + ' ' + (msg.body || msg.text || '');
      const patterns = [
        /verification code[:\s]+([0-9]{4,8})/i,
        /code[:\s]+([0-9]{4,8})/i,
        /Your verification code is[:\s]+([0-9]{4,8})/i,
        /([0-9]{6})/,
      ];
      for (const p of patterns) {
        const m = content.match(p);
        if (m) return m[1];
      }
    }
    return null;
  }

  // ── Main Run ─────────────────────────────────────────
  async run({ email: inputEmail, proxy, country, apiKeyDesc = "default" }) {
    const { chromium } = await import('playwright');
    const selectedCountry = country || randomCountry();

    // Create tempmail inbox
    let email = inputEmail;
    try {
      if (!email) {
        email = await this._createTempmailInbox();
        this.log(`Email created: ${email}`);
      }
    } catch (e) {
      return { status: 'error', email: inputEmail, reason: `Email creation failed: ${e.message}` };
    }

    try {
      const launchOpts = {
        headless: this.config.browser?.headless ?? true,
        args: ['--disable-blink-features=AutomationControlled'],
      };
      if (proxy) launchOpts.proxy = this._parseProxy(proxy);

      this.browser = await chromium.launch(launchOpts);
      const ctx = await this.browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      });
      this.page = await ctx.newPage();
      this.page.setDefaultTimeout(30000);

      this.log(`QwenCloud | email=${email} | country=${selectedCountry}`);

      // 1. Go to QwenCloud
      await this.page.goto('https://home.qwencloud.com/', { waitUntil: 'commit', timeout: 30000 });
      await this._waitForText('Log In', 20000);

      const url = this.page.url();
      this.log(`landing: ${url}`);

      // 2. Navigate to signup
      if (url.includes('sso/login') || (await this.page.title()).includes('Log In')) {
        await this.page.getByRole('link', { name: 'Sign Up' }).click();
        await this.page.waitForURL(/\/sso\/register/, { timeout: 15000 });
      }

      // 3. Do signup
      const signupResult = await this._doSignup(email, selectedCountry);

      if (signupResult.status === 'already-registered') {
        this.log(`[${email}] already registered, trying login`);
        await this.page.goto('https://home.qwencloud.com/', { waitUntil: 'commit', timeout: 15000 });
        await this._waitForText('Log In', 10000);
        const loginResult = await this._doLogin(email);
        if (loginResult.status !== 'login-ok') return { ...loginResult, email };
      } else if (signupResult.status !== 'signup-ok') {
        return { ...signupResult, email };
      }

      // 4. Create API key
      const apiKey = await this._createApiKey(apiKeyDesc);
      if (!apiKey) return { status: 'success-no-key', email };

      return {
        status: 'success', email, apiKey,
        baseUrlOpenai: BASE_OPENAI, baseUrlAnthropic: BASE_ANTHROPIC,
        country: selectedCountry,
      };
    } catch (err) {
      this.log(`[${email}] error: ${err.message}`);
      return { status: 'error', email, reason: err.message };
    } finally {
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }

  // ── Signup Flow ──────────────────────────────────────
  async _doSignup(email, country) {
    this.log(`starting signup for ${email}`);

    try {
      await this.page.locator('input[placeholder="Email"]').fill(email);
      await this.page.locator('button:has-text("Next")').click();
    } catch (e) {
      return { status: 'error', reason: `signup-fill-failed: ${e.message}` };
    }

    await this._waitForPageLoad(10000);
    await sleep(500);

    // Detect "already registered" or OTP page
    const deadline = Date.now() + 10000;
    let foundOtp = false;
    while (Date.now() < deadline) {
      try {
        const body = await this.page.evaluate(() => document.body.innerText.toLowerCase());
        if (body.includes('already') || body.includes('registered')) return { status: 'already-registered' };
        if (body.includes('enter verification code') || body.includes('verification code')) { foundOtp = true; break; }
      } catch {}
      await sleep(500);
    }
    if (!foundOtp) return { status: 'error', reason: 'verification-code-page-not-found' };

    // Get verification code from tempmail
    const code = await this._getVerificationCode(email);
    if (!code) return { status: 'error', reason: 'verification-code-not-found' };

    // Type OTP
    try {
      const otpInput = this.page.locator('input[type="text"]').first();
      await otpInput.waitFor({ state: 'visible', timeout: 10000 });
      await otpInput.click();
      await sleep(300);
      await this.page.keyboard.press('Control+a');
      await this.page.keyboard.press('Delete');
      await sleep(300);
      await otpInput.pressSequentially(code, { delay: 50 });
    } catch (e) {
      return { status: 'error', reason: `otp-fill-failed: ${e.message}` };
    }

    // Wait for country page
    try { await this._waitForText('Please select your country/region', 10000); } catch {
      try {
        const validateBtn = this.page.locator('button:has-text("Validate")');
        if (await validateBtn.count() > 0 && !(await validateBtn.isDisabled())) {
          await validateBtn.click();
          await this._waitForText('Please select your country/region', 10000);
        }
      } catch {}
    }

    // Select country
    if (!(await this._selectCountry(country))) return { status: 'error', reason: 'country-selection-failed' };

    // Check agreement checkbox
    try {
      await this.page.evaluate(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
      });
      await sleep(500);
    } catch (e) {
      return { status: 'error', reason: `agreement-click-failed: ${e.message}` };
    }

    // Click Continue
    try {
      const continueBtn = this.page.locator('button:has-text("Continue")');
      if (!(await continueBtn.isDisabled())) await continueBtn.click();
    } catch (e) {
      return { status: 'error', reason: `continue-click-failed: ${e.message}` };
    }

    // Wait for dashboard
    try {
      await this.page.waitForURL(/home\.qwencloud\.com/, { timeout: 30000 });
      await this._waitForPageLoad(15000);
    } catch {
      return { status: 'error', reason: 'dashboard-timeout' };
    }

    this.log(`[${email}] signup completed`);
    return { status: 'signup-ok' };
  }

  // ── Login Flow ───────────────────────────────────────
  async _doLogin(email) {
    this.log(`login for ${email}`);
    try {
      await this.page.getByRole('textbox', { name: 'Email' }).fill(email);
      await sleep(500);
      const sendBtn = this.page.getByRole('button', { name: 'Send Code' });
      if (await sendBtn.count() > 0) {
        await sendBtn.click();
      } else {
        const nextBtn = this.page.locator('button:has-text("Next")');
        if (await nextBtn.count() > 0) {
          await nextBtn.click();
          await this._waitForPageLoad(10000);
          await sleep(500);
          const sendBtn2 = this.page.getByRole('button', { name: 'Send Code' });
          if (await sendBtn2.count() > 0) await sendBtn2.click();
        }
      }
    } catch (e) {
      return { status: 'error', reason: `login-fill-failed: ${e.message}` };
    }

    const code = await this._getVerificationCode(email);
    if (!code) return { status: 'error', reason: 'login-verification-code-not-found' };

    try {
      const vcInput = this.page.getByRole('textbox', { name: 'Verification Code' });
      await vcInput.waitFor({ state: 'visible', timeout: 10000 });
      await vcInput.fill(code);
      await sleep(500);
    } catch {
      try { await this.page.locator('input[type="text"]').nth(1).fill(code); }
      catch (e) { return { status: 'error', reason: `login-code-fill-failed: ${e.message}` }; }
    }

    try { await this.page.getByRole('button', { name: 'Next' }).click(); }
    catch (e) { return { status: 'error', reason: `login-next-failed: ${e.message}` }; }

    await this._waitForPageLoad(10000);
    await sleep(500);

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(500);
      try {
        if (this.page.url().includes('home.qwencloud.com')) {
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
          return { status: 'login-ok' };
        }
      } catch { continue; }
    }
    return { status: 'error', reason: 'login-dashboard-timeout' };
  }

  // ── Verification Code ────────────────────────────────
  async _getVerificationCode(email) {
    this.log(`polling tempmail for verification code...`);
    try {
      const messages = await this._pollTempmailMessages(email, 90000, 5000);
      const code = this._extractCode(messages);
      if (code) this.log(`verification code: ${code}`);
      return code;
    } catch (e) {
      this.log(`verification code error: ${e.message}`);
      return null;
    }
  }

  // ── API Key Creation ─────────────────────────────────
  async _createApiKey(description = "default") {
    this.log('navigating to API keys page');
    await this._dismissOverlays();

    try { await this.page.goto('https://home.qwencloud.com/api-keys', { waitUntil: 'commit', timeout: 15000 }); } catch {}

    if (!(await this._waitFor('button:has-text("Create API key")', 30000))) {
      try {
        await this._dismissOverlays();
        await this.page.getByRole('link', { name: 'API Keys' }).first().click();
      } catch {}
      if (!(await this._waitFor('button:has-text("Create API key")', 15000))) {
        this.log('Create API key button not found');
        return null;
      }
    }

    await this._waitForPageLoad(10000);
    await this._dismissOverlays();

    try { await this.page.locator('button:has-text("Create API key")').first().click(); }
    catch (e) { this.log(`Create API key click failed: ${e.message}`); return null; }

    if (!(await this._waitForText('Create API Key', 15000))) { this.log('dialog not found'); return null; }
    await this._waitForPageLoad(5000);

    try {
      const desc = this.page.locator('input[placeholder*="Production API key"]');
      await desc.waitFor({ state: 'visible', timeout: 10000 });
      await desc.fill(description);
    } catch (e) { this.log(`desc fill failed: ${e.message}`); return null; }

    // Wait for Generate Key enabled
    const genDeadline = Date.now() + 10000;
    while (Date.now() < genDeadline) {
      try { if (!(await this.page.locator('button:has-text("Generate Key")').isDisabled())) break; }
      catch { break; }
      await sleep(500);
    }

    try {
      const genBtn = this.page.locator('button:has-text("Generate Key")');
      await genBtn.waitFor({ state: 'visible', timeout: 10000 });
      await genBtn.click();
    } catch (e) { this.log(`Generate Key failed: ${e.message}`); return null; }

    if (!(await this._waitForText('Copy your API Key', 20000))) { this.log('Copy dialog not found'); return null; }

    const keyDeadline = Date.now() + 10000;
    while (Date.now() < keyDeadline) {
      try {
        const key = await this.page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          const visible = inputs.filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          const ki = visible.find(i => i.value && i.value.startsWith('sk-'));
          return ki ? ki.value : null;
        });
        if (key) { this.log(`API key: ${key.substring(0, 20)}...`); return key; }
      } catch {}
      await sleep(1000);
    }

    this.log('API key extraction failed');
    return null;
  }

  // ── Country Selection ────────────────────────────────
  async _selectCountry(country) {
    this.log(`selecting country: ${country}`);
    try {
      const input = this.page.locator('input[placeholder="Select your country/region"]');
      await input.click();
      await sleep(500);
      await input.fill(country);
      await sleep(500);
    } catch (e) { this.log(`country input failed: ${e.message}`); return false; }

    try {
      const opt = this.page.locator(`[role="option"]:has-text("${country}")`);
      await opt.waitFor({ state: 'visible', timeout: 10000 });
      await opt.click({ timeout: 10000 });
    } catch {
      try {
        const sel = await this.page.evaluate((c) => {
          const o = Array.from(document.querySelectorAll('[role=option]')).find(el => el.innerText.includes(c));
          if (o) { o.click(); return true; } return false;
        }, country);
        if (!sel) return false;
      } catch { return false; }
    }

    await sleep(500);
    try { return !(await this.page.locator('button:has-text("Continue")').isDisabled()); }
    catch { return false; }
  }

  // ── Helpers ──────────────────────────────────────────
  async _dismissOverlays() {
    try {
      await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const close = btns.find(b => b.innerText.trim() === 'Close' && b.getBoundingClientRect().width > 0);
        if (close) { close.click(); return true; } return false;
      });
    } catch {}
  }

  _parseProxy(proxy) {
    if (!proxy) return undefined;
    let p = proxy.trim();
    if (!p.includes('://')) p = `http://${p}`;
    const m = p.match(/^(?:https?:\/\/)?(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
    if (m) return { server: `http://${m[3]}:${m[4]}`, username: m[1] || undefined, password: m[2] || undefined };
    return { server: p };
  }

  async _waitFor(selector, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { const loc = this.page.locator(selector).first(); if (await loc.count() > 0 && await loc.isVisible()) return true; }
      catch {}
      await sleep(1000);
    }
    return false;
  }

  async _waitForText(text, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await this.page.getByText(text, { exact: false }).count() > 0) return true; }
      catch {}
      await sleep(1000);
    }
    return false;
  }

  async _waitForPageLoad(timeout = 15000) {
    try { await this.page.waitForLoadState('networkidle', { timeout }); } catch {}
  }
}

export { BASE_OPENAI, BASE_ANTHROPIC, COUNTRIES };
