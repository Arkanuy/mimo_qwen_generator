/**
 * QwenCloud auto-signup + API key extractor.
 * Node.js port of qwencloud_full.py.
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

  // ── Tempmail API ─────────────────────────────────────
  async _initTempmailSession() {
    if (this.tempmailSession) return this.tempmailSession;

    // Try to load persisted session (shared with MiMo runner)
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const sessionFile = path.join(__dirname, '..', '..', 'db', 'tempmail-session.json');
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        if (data.sessionId) {
          this.tempmailSession = data.sessionId;
          return this.tempmailSession;
        }
      }
    } catch {}

    const res = await fetch(`${this.tempmailUrl}/session`, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Tempmail session failed: ${res.status}`);
    const data = await res.json();
    this.tempmailSession = data.sessionId || data.id || data.session_id;

    // Persist session for web UI visibility
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const sessionFile = path.join(__dirname, '..', '..', 'db', 'tempmail-session.json');
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify({ sessionId: this.tempmailSession, saved_at: new Date().toISOString() }));
    } catch {}

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
    if (!res.ok) throw new Error(`Tempmail inbox failed: ${res.status}`);
    const data = await res.json();
    return data.address;
  }

  async _pollTempmailMessages(address, timeout = 300000, interval = 3000) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.tempmailSession) headers['x-session-id'] = this.tempmailSession;
    this.log(`polling ${address} (session: ${(this.tempmailSession || 'none').slice(0, 8)}..., timeout: ${timeout/1000}s)`);

    const deadline = Date.now() + timeout;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const res = await fetch(`${this.tempmailUrl}/inboxes/${encodeURIComponent(address)}/messages`, { headers });
        if (res.ok) {
          const messages = await res.json();
          if (messages && messages.length > 0) return messages;
          if (attempt <= 3 || attempt % 10 === 0) this.log(`poll #${attempt}: 0 messages`);
        } else {
          this.log(`poll #${attempt}: HTTP ${res.status}`);
        }
      } catch (e) {
        if (attempt <= 3) this.log(`poll #${attempt}: error ${e.message}`);
      }
      await sleep(interval);
    }
    throw new Error('Timeout waiting for email');
  }

  _extractCode(messages) {
    // Sort newest first so we check the latest message
    const sorted = [...messages].sort((a, b) => {
      const ta = a.createdAt || a.date || a.timestamp || '';
      const tb = b.createdAt || b.date || b.timestamp || '';
      return tb.localeCompare(ta);
    });
    for (const msg of sorted) {
      // Prefer plain text over HTML to avoid matching CSS/attribute numbers
      const rawText = (msg.text || msg.body || '');
      const htmlStripped = (msg.html || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ');
      const content = ((msg.subject || '') + ' ' + rawText + ' ' + htmlStripped).replace(/\s+/g, ' ');

      const patterns = [
        // "verification code ... is: 231882" (handles "for Qwen Cloud is:" etc.)
        /verification\s+code[^0-9]*?(\d{4,8})/i,
        // "Your verification code ... 231882"
        /your\s+verification[^0-9]*?(\d{4,8})/i,
        // "code: 231882" or "code is: 231882"
        /code[:\s]+is[:\s]+(\d{4,8})/i,
        /code[:\s]+(\d{4,8})/i,
        // Standalone 4-8 digit code on its own line (from plain text only)
        /^\s*(\d{4,8})\s*$/m,
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
      const launchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1366,768',
      ];
      if (proxy) launchArgs.push('--ignore-certificate-errors');
      const launchOpts = {
        headless: this.config.browser?.headless ?? true,
        args: launchArgs,
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
      await this.page.goto('https://home.qwencloud.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this._waitForText('Log In', 25000);

      const url = this.page.url();
      this.log(`landing: ${url.substring(0, 80)}...`);

      // 2. Navigate to signup
      if (url.includes('sso/login') || (await this.page.title()).includes('Log In')) {
        await this.page.getByRole('link', { name: 'Sign Up' }).click();
        try {
          await this.page.waitForURL(/\/sso\/register/, { timeout: 20000 });
        } catch {
          // Maybe already on register page or page loaded differently
          const curUrl = this.page.url();
          if (!curUrl.includes('register')) {
            this.log(`still on ${curUrl.substring(0, 60)} after clicking Sign Up, trying direct nav`);
            await this.page.goto('https://account.alibabacloud.com/sso/register', { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
          }
        }
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
    const requestTime = Date.now(); // Track when we sent the request

    try {
      await this.page.locator('input[placeholder="Email"]').fill(email);
      await this.page.locator('button:has-text("Next")').click();
    } catch (e) {
      return { status: 'error', reason: `signup-fill-failed: ${e.message}` };
    }

    await this._waitForPageLoad(10000);
    await sleep(1000);

    // Detect "already registered" or OTP page
    const deadline = Date.now() + 15000;
    let foundOtp = false;
    while (Date.now() < deadline) {
      try {
        const body = await this.page.evaluate(() => document.body.innerText.toLowerCase());
        if (body.includes('already') && body.includes('registered')) return { status: 'already-registered' };
        if (body.includes('verification code') || body.includes('enter code') || body.includes('otp')) {
          foundOtp = true;
          break;
        }
        // Check if we're on OTP page by looking for input fields
        const inputCount = await this.page.locator('input[type="text"]').count();
        if (inputCount >= 4) { foundOtp = true; break; }
      } catch {}
      await sleep(500);
    }
    if (!foundOtp) {
      const bodyText = await this.page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => 'unknown');
      this.log(`page text: ${bodyText.substring(0, 100)}`);
      return { status: 'error', reason: 'verification-code-page-not-found' };
    }

    // Get verification code — only accept emails after requestTime
    const code = await this._getVerificationCode(email, requestTime);
    if (!code) return { status: 'error', reason: 'verification-code-not-found' };

    // Type OTP into the individual boxes or single input
    try {
      // Try individual OTP boxes first (QwenCloud uses 6 separate inputs)
      const otpInputs = this.page.locator('input[type="text"]');
      const count = await otpInputs.count();
      if (count >= 6) {
        for (let i = 0; i < 6; i++) {
          await otpInputs.nth(i).click();
          await sleep(100);
          await otpInputs.nth(i).pressSequentially(code[i], { delay: 50 });
          await sleep(100);
        }
      } else {
        // Single input fallback
        const otpInput = otpInputs.first();
        await otpInput.waitFor({ state: 'visible', timeout: 10000 });
        await otpInput.click();
        await sleep(300);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Delete');
        await sleep(300);
        await otpInput.pressSequentially(code, { delay: 80 });
      }
      this.log(`OTP entered: ${code}`);
    } catch (e) {
      return { status: 'error', reason: `otp-fill-failed: ${e.message}` };
    }

    await sleep(2000);

    // Try clicking Validate if present
    try {
      const validateBtn = this.page.locator('button:has-text("Validate")');
      if (await validateBtn.count() > 0 && !(await validateBtn.isDisabled())) {
        await validateBtn.click();
        this.log('Validate clicked');
      }
    } catch {}

    // Take screenshot after OTP for debugging
    try {
      const ssPath = `/tmp/otp-after-${email?.split('@')[0] || 'unknown'}.png`;
      await this.page.screenshot({ path: ssPath, fullPage: false });
      this.log(`screenshot saved: ${ssPath}`);
    } catch {}

    // Check current URL for debugging
    const otpUrl = this.page.url();
    this.log(`after OTP URL: ${otpUrl}`);

    // Check for OTP / validation error messages immediately
    try {
      const pageText = await this.page.evaluate(() => document.body.innerText);
      const lowerText = pageText.toLowerCase();
      const errorPhrases = ['incorrect', 'invalid', 'wrong code', 'expired', 'verification failed', 'account number format', 'try again', 'error occurred'];
      const foundError = errorPhrases.find(p => lowerText.includes(p));
      if (foundError) {
        // Extract surrounding context
        const idx = lowerText.indexOf(foundError);
        const snippet = pageText.substring(Math.max(0, idx - 30), idx + 80).replace(/\s+/g, ' ').trim();
        this.log(`OTP error detected (${foundError}): ${snippet}`);
        return { status: 'error', reason: `otp-error: ${snippet}` };
      }
    } catch {}

    // Wait for country page or dashboard with expanded detection
    let onCountryPage = false;
    const countryDeadline = Date.now() + 30000;
    while (Date.now() < countryDeadline) {
      try {
        const body = await this.page.evaluate(() => document.body.innerText.toLowerCase());
        const url = this.page.url();

        // Country/region selection page
        if (body.includes('select your country') || body.includes('country/region')
          || body.includes('select country') || body.includes('choose your country')
          || body.includes('country or region') || (body.includes('country') && body.includes('region') && body.includes('select'))
          || (url.includes('/register') && (body.includes('agree') || body.includes('continue')))) {
          onCountryPage = true;
          this.log('detected country/registration page');
          break;
        }
        // Already on dashboard — skip country
        if (body.includes('dashboard') || body.includes('api key') || body.includes('welcome')
          || url.includes('/api-keys') || url.includes('/dashboard')) {
          this.log('reached dashboard directly');
          return { status: 'signup-ok' };
        }
        // Check if we were redirected back to landing/home (OTP likely failed)
        if (url.includes('home.qwencloud.com') && !url.includes('/sso/') && !url.includes('/register')) {
          const elapsed = Date.now() - (countryDeadline - 30000);
          if (elapsed > 15000) {
            this.log(`redirected to homepage after ${(elapsed/1000).toFixed(0)}s — OTP likely failed`);
            try {
              const ssPath = `/tmp/otp-redirect-${email?.split('@')[0] || 'unknown'}.png`;
              await this.page.screenshot({ path: ssPath, fullPage: false });
              this.log(`redirect screenshot: ${ssPath}`);
            } catch {}
            return { status: 'error', reason: 'country-page-not-found: redirected-to-homepage (OTP may have failed)' };
          }
        }
      } catch {}
      await sleep(1000);
    }

    if (!onCountryPage) {
      const bodyText = await this.page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => 'unknown');
      const finalUrl = this.page.url();
      this.log(`country page not found. URL=${finalUrl} body=${bodyText.substring(0, 100)}`);
      try {
        const ssPath = `/tmp/otp-fail-${email?.split('@')[0] || 'unknown'}.png`;
        await this.page.screenshot({ path: ssPath, fullPage: false });
        this.log(`fail screenshot: ${ssPath}`);
      } catch {}
      return { status: 'error', reason: 'country-page-not-found' };
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
      if (await continueBtn.count() > 0 && !(await continueBtn.isDisabled())) {
        await continueBtn.click();
      }
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
    const requestTime = Date.now();

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

    const code = await this._getVerificationCode(email, requestTime);
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
  async _getVerificationCode(email, afterTime = 0) {
    this.log(`polling tempmail for verification code...`);
    const deadline = Date.now() + 300000;
    let attempt = 0;
    let lastMsgCount = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const res = await fetch(`${this.tempmailUrl}/inboxes/${encodeURIComponent(email)}/messages`, {
          headers: { 'Content-Type': 'application/json', ...(this.tempmailSession ? { 'x-session-id': this.tempmailSession } : {}) }
        });
        if (res.ok) {
          const messages = await res.json();
          if (messages && messages.length > 0) {
            if (messages.length !== lastMsgCount) {
              lastMsgCount = messages.length;
              this.log(`got ${messages.length} message(s), checking for code...`);
            }
            const code = this._extractCode(messages);
            if (code) { this.log(`verification code: ${code}`); return code; }
          }
        }
      } catch (e) {
        if (attempt <= 3) this.log(`poll error: ${e.message}`);
      }
      await sleep(3000);
    }
    this.log(`verification code not found after ${attempt} polls`);
    return null;
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

    // Try multiple selectors
    const selectors = [
      'input[placeholder="Select your country/region"]',
      'input[placeholder*="country"]',
      'input[placeholder*="region"]',
      'input[role="combobox"]',
    ];

    let inputFound = false;
    for (const sel of selectors) {
      try {
        const el = this.page.locator(sel);
        if (await el.count() > 0) {
          await el.first().click();
          await sleep(500);
          await el.first().fill(country);
          await sleep(500);
          inputFound = true;
          break;
        }
      } catch {}
    }

    if (!inputFound) {
      // JS fallback — click any combobox-like element
      try {
        const clicked = await this.page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          const combo = inputs.find(i =>
            i.placeholder?.toLowerCase().includes('country') ||
            i.placeholder?.toLowerCase().includes('region') ||
            i.getAttribute('role') === 'combobox'
          );
          if (combo) { combo.click(); return true; }
          return false;
        });
        if (clicked) {
          await sleep(500);
          await this.page.keyboard.type(country, { delay: 50 });
          await sleep(500);
          inputFound = true;
        }
      } catch {}
    }

    if (!inputFound) {
      this.log('country input not found');
      return false;
    }

    // Click the option
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
    const m = p.match(/^(socks[45]|https?):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
    if (m) return { server: `${m[1]}://${m[4]}:${m[5]}`, username: m[2] || undefined, password: m[3] || undefined };
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
