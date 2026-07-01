/**
 * Mocasus Browser Manager — Persistent browser session untuk temp mail.
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSION_FILE = join(__dirname, '..', '..', 'db', 'mocasus-session.json');

const SUPABASE_URL = 'https://ijrccpgiulrmfpavazsl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc';

const HEADERS = {
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'apikey': SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

class MocasusBrowser {
  constructor(config = {}) {
    this.email = config.email || 'arkanbe123@gmail.com';
    this.password = config.password || 'Arkan123!45';
    this.ownerToken = config.ownerToken || null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ready = false;
  }

  async start() {
    console.log('[MocasusBrowser] Starting...');
    this.browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    await this._loadCookies();
    this.page = await this.context.newPage();
    await this._login();
    await this._extractOwnerToken();
    this.ready = true;
    console.log(`[MocasusBrowser] Ready! ownerToken: ${this.ownerToken?.substring(0, 20)}...`);
  }

  async stop() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.ready = false;
    }
  }

  async _login() {
    console.log('[MocasusBrowser] Logging in...');
    await this.page.goto('https://mocasus.my.id/auth', { waitUntil: 'networkidle', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    if (!this.page.url().includes('/auth')) {
      console.log('[MocasusBrowser] Already logged in');
      return;
    }

    const emailInput = this.page.locator('input[type="email"]').first();
    const passInput = this.page.locator('input[type="password"]').first();

    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill(this.email);
      await passInput.fill(this.password);
      await this.page.locator('button:has-text("Masuk →")').click();
      await this.page.waitForTimeout(5000);
      console.log('[MocasusBrowser] Login done, URL:', this.page.url());
    }

    await this._saveCookies();
  }

  async _extractOwnerToken() {
    if (this.ownerToken) return;
    await this.page.goto('https://mocasus.my.id/temp-mail', { waitUntil: 'networkidle', timeout: 30000 });
    await this.page.waitForTimeout(3000);
    const token = await this.page.evaluate(() => localStorage.getItem('temp_mail_owner_token'));
    if (token) {
      this.ownerToken = token;
      this._saveSession();
      console.log('[MocasusBrowser] Owner token extracted');
    }
  }

  /**
   * Generate email + password.
   * Prioritas: VIP browser → fallback API non-VIP.
   */
  async generateEmailPw() {
    if (!this.ready) throw new Error('Browser not ready');

    // Cek VIP status dulu (cepat, tanpa browser)
    const isVip = await this._checkVipQuick();

    if (isVip) {
      // VIP: pakai browser automation
      try {
        return await this._generateVipBrowser();
      } catch (err) {
        console.log(`[MocasusBrowser] VIP browser failed: ${err.message}, falling back`);
      }
    }

    // Non-VIP: pakai Supabase API
    return await this.generateInbox();
  }

  /**
   * Cek VIP status cepat via API.
   */
  async _checkVipQuick() {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/temp-mail-vip`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'status', owner_token: this.ownerToken }),
      });
      const data = await res.json();
      return !!data.vip;
    } catch {
      return false;
    }
  }

  /**
   * Generate via browser (VIP Email+PW).
   */
  async _generateVipBrowser() {
    await this.page.goto('https://mocasus.my.id/temp-mail', { waitUntil: 'networkidle', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // Tutup dialog yang mungkin terbuka
    await this._closeDialogs();

    // Klik "Email+PW"
    await this.page.locator('button:has(h4:has-text("Email+PW"))').first().click();
    await this.page.waitForTimeout(2000);

    // Klik "Generate Sekarang"
    const genBtn = this.page.locator('button:visible:has-text("Generate Sekarang")').first();
    if (!await genBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      throw new Error('Generate button not found');
    }
    await genBtn.click();
    await this.page.waitForTimeout(3000);

    // Baca hasil
    const result = await this._readResultDialog();
    if (result?.email) {
      console.log(`[MocasusBrowser] VIP generated: ${result.email}`);
      return result;
    }

    throw new Error('Failed to read VIP result');
  }

  /**
   * Baca dialog hasil — email + password dari span.truncate
   */
  async _readResultDialog() {
    try {
      const dialog = this.page.locator('[role="dialog"]:visible').first();
      if (!await dialog.isVisible({ timeout: 3000 }).catch(() => false)) return null;

      const spans = await dialog.locator('span.truncate').allTextContents();
      let email = null, password = null;

      for (const text of spans) {
        if (!email && text.includes('@')) email = text.trim();
        else if (!password && !text.includes('@') && text.length >= 8) password = text.trim();
      }

      if (!email) {
        const fullText = await dialog.innerText().catch(() => '');
        const em = fullText.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (em) email = em[0];
        const pw = fullText.match(/Password\s*\n\s*(\S+)/i);
        if (pw) password = pw[1];
      }

      return email ? { email, password } : null;
    } catch {
      return null;
    }
  }

  /**
   * Generate inbox via Supabase API (non-VIP).
   */
  async generateInbox(domain = null) {
    const domains = domain ? [domain] : await this._getDomains();
    const targetDomain = domains[Math.floor(Math.random() * domains.length)];

    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-inbox`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ owner_token: this.ownerToken, desired_local: null, domain: targetDomain }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.owner_token) {
      this.ownerToken = data.owner_token;
      this._saveSession();
    }

    return { email: data.address, password: null };
  }

  /**
   * Get messages via Supabase REST API.
   */
  async getMessages(address, maxWait = 180000, interval = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const url = `${SUPABASE_URL}/rest/v1/temp_messages?select=*&inbox_address=eq.${encodeURIComponent(address)}&order=received_at.desc`;
        const res = await fetch(url, { headers: HEADERS });
        if (res.ok) {
          const messages = await res.json();
          if (messages?.length > 0) {
            return messages.map(m => ({
              subject: m.subject || '',
              body: m.text_body || '',
              html: m.html_body || '',
              from_address: m.from_address || '',
              from_name: m.from_name || '',
              received_at: m.received_at,
            }));
          }
        }
      } catch (err) {
        console.log(`[MocasusBrowser] Poll error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }

    throw new Error('Timeout waiting for email');
  }

  /**
   * Get OTP/verification code.
   */
  async getOtp(address, maxWait = 180000, interval = 5000) {
    const messages = await this.getMessages(address, maxWait, interval);

    for (const msg of messages) {
      const content = `${msg.subject} ${msg.body} ${msg.html}`;
      const patterns = [
        /verification code[:\s]+([0-9]{4,8})/i,
        /Your verification code is[:\s]+([0-9]{4,8})/i,
        /code[:\s]+is[:\s]+([0-9]{4,8})/i,
        /code[:\s]+([0-9]{4,8})/i,
        /OTP[:\s]+([0-9]{4,8})/i,
        /([0-9]{6})/,
      ];
      for (const p of patterns) {
        const match = content.match(p);
        if (match) return match[1];
      }
    }

    throw new Error('Could not extract OTP from messages');
  }

  async _getDomains() {
    const url = `${SUPABASE_URL}/rest/v1/temp_domains?select=domain,vip_only&is_active=eq.true&order=sort_order.asc`;
    const res = await fetch(url, { headers: HEADERS });
    const all = await res.json();
    return all.filter(d => !d.vip_only).map(d => d.domain);
  }

  async _closeDialogs() {
    for (const txt of ['Close', 'Nanti dulu', 'Mengerti']) {
      const btns = await this.page.locator(`button:visible:has-text("${txt}")`).all();
      for (const btn of btns) await btn.click().catch(() => {});
    }
    await this.page.waitForTimeout(500);
  }

  async _saveCookies() {
    try {
      const cookies = await this.context.cookies();
      mkdirSync(dirname(SESSION_FILE), { recursive: true });
      const d = this._loadSessionData(); d.cookies = cookies;
      writeFileSync(SESSION_FILE, JSON.stringify(d, null, 2));
    } catch {}
  }

  async _loadCookies() {
    try {
      const d = this._loadSessionData();
      if (d.cookies?.length > 0) await this.context.addCookies(d.cookies);
    } catch {}
  }

  _saveSession() {
    try {
      mkdirSync(dirname(SESSION_FILE), { recursive: true });
      const d = this._loadSessionData();
      d.ownerToken = this.ownerToken;
      d.savedAt = new Date().toISOString();
      writeFileSync(SESSION_FILE, JSON.stringify(d, null, 2));
    } catch {}
  }

  _loadSessionData() {
    try {
      if (existsSync(SESSION_FILE)) return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    } catch {}
    return {};
  }
}

export { MocasusBrowser };
