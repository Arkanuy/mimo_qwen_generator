/**
 * Xiaomi MiMo Registration — Full API (tanpa browser).
 *
 * Browser flow analysis:
 *   1. Referral → redirects to account.xiaomi.com/fe/service/login/password
 *   2. Click "Sign up" tab → fill form → click "Next"
 *   3. reCAPTCHA v2 modal → solve → email verification
 *   4. Sometimes image captcha after reCAPTCHA
 *
 * API flow:
 *   1. Follow referral redirects to get actual page URL
 *   2. Solve reCAPTCHA v2 via CapMonster (use actual page URL)
 *   3. POST registration with g-recaptcha-response
 *   4. If image captcha needed, solve and POST with icode
 *   5. Follow user_synced_url to complete user sync
 *   6. Do serviceLogin to get passToken cookie
 */

import { MocasusApiClient } from '../clients/mocasus-api-client.js';
import { createCaptchaSolver } from '../clients/captcha.js';
import { NineRouterCaptchaSolver } from '../clients/ninerouter-captcha.js';
import { CapMonsterSolver } from '../clients/capmonster.js';
import { createHash } from 'crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CookieJar {
  constructor() { this.cookies = new Map(); }
  setFromResponse(res) {
    let list = [];
    if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
    else { const r = res.headers.get('set-cookie'); if (r) list = [r]; }
    for (const c of list) {
      if (!c) continue;
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }
  toString() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  get(n) { return this.cookies.get(n) || null; }
  has(n) { return this.cookies.has(n); }
  remove(n) { this.cookies.delete(n); }
  keys() { return [...this.cookies.keys()]; }
}

async function req(url, opts, jar) {
  const headers = { ...(opts?.headers || {}) };
  if (jar) { const ck = jar.toString(); if (ck) headers['cookie'] = ck; }
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  if (jar) jar.setFromResponse(res);
  return res;
}

async function reqFollow(url, opts, jar, maxHops = 10) {
  let cur = url;
  let res = await req(cur, opts, jar);
  let hops = 0;
  while ([301, 302, 303, 307, 308].includes(res.status) && hops < maxHops) {
    const loc = res.headers.get('location');
    if (!loc) break;
    cur = loc.startsWith('http') ? loc : new URL(loc, cur).toString();
    res = await req(cur, { ...opts, method: 'GET', body: undefined }, jar);
    hops++;
  }
  return { res, finalUrl: cur, hops };
}

function parseXiaomi(text) {
  const cleaned = text.replace(/^&&&START&&&/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  return null;
}

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

export class MimoApiRegistration {
  constructor(config) {
    this.config = config;
    this.tempmail = new MocasusApiClient(config.tempmail?.apiBaseUrl);
    this.captcha = createCaptchaSolver(config.captcha);
    this.nineRouter = new NineRouterCaptchaSolver(config.nineRouter || {});
    this.capmonster = new CapMonsterSolver(config.captcha?.apiKey || '');
    this.jar = new CookieJar();
    this.email = null;
    this.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.platformBase = 'https://platform.xiaomimimo.com';
    this.logLines = [];
  }

  log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `[${ts}] ${msg}`;
    this.logLines.push(line);
    console.log(line);
  }

  h(extra = {}) {
    return {
      'User-Agent': this.ua,
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      ...extra,
    };
  }

  async createEmail() {
    this.log('Creating temp email...');
    this.email = await this.tempmail.createInbox();
    this.log(`Email: ${this.email}`);
    return this.email;
  }

  async solveImageCaptcha(base64, attempt) {
    const use9First = attempt % 2 === 0;
    const solvers = use9First
      ? [['9Router', () => this.nineRouter.solveImageCaptcha(base64)],
         ['CapMonster', () => this.captcha.solveImageCaptcha(base64)]]
      : [['CapMonster', () => this.captcha.solveImageCaptcha(base64)],
         ['9Router', () => this.nineRouter.solveImageCaptcha(base64)]];
    for (const [name, fn] of solvers) {
      try {
        const answer = await fn();
        this.log(`${name}: ${answer}`);
        return answer;
      } catch (e) { this.log(`${name} failed: ${e.message}`); }
    }
    throw new Error('All solvers failed');
  }

  async fetchCaptchaImage(accountHost) {
    const url = `https://${accountHost}/pass/getCode?icodeType=register`;
    this.log(`Image captcha from ${url}...`);
    const res = await req(url, {
      method: 'GET',
      headers: this.h({
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'same-origin',
      }),
    }, this.jar);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    this.log(`Image: ${buf.length} bytes, ick: ${this.jar.get('ick')?.substring(0, 15)}...`);
    try {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      const dir = join('/home/arkan/mekithil', 'output', 'captcha-debug');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `captcha-${Date.now()}.png`), buf);
    } catch {}
    return buf.toString('base64');
  }

  async register() {
    const email = this.email;
    const password = this.config.xiaomi.password;
    const refCode = this.config.xiaomi.inviteCode;
    const sitekey = '6LeBM0ocAAAAAEwYcFUjtxpVbs-0rnbSVXBBXmh4';

    // ── Step 1: Follow referral to get actual page URL ─────────────────
    this.log('Following referral...');
    const refUrl = `${this.platformBase}/?ref=${refCode}`;
    const { res: refRes, finalUrl } = await reqFollow(refUrl, {
      method: 'GET', headers: this.h({ Accept: 'text/html,*/*' }),
    }, this.jar);
    this.log(`Referral → ${finalUrl.substring(0, 120)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // Extract the host from the final URL
    const finalHost = new URL(finalUrl).host;
    const accountHost = finalHost.includes('xiaomi.com') ? finalHost : 'account.xiaomi.com';
    this.log(`Account host: ${accountHost}`);

    // Load the actual registration page
    const { res: pageRes, finalUrl: pageUrl } = await reqFollow(finalUrl, {
      method: 'GET', headers: this.h({ Accept: 'text/html,application/xhtml+xml,*/*' }),
    }, this.jar);
    this.log(`Page: ${pageRes.status} at ${pageUrl.substring(0, 100)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // The registration POST URL
    const registerUrl = `https://${accountHost}/pass/register`;

    // ── Step 2: Solve reCAPTCHA v2 ────────────────────────────────────
    this.log(`Solving reCAPTCHA for ${pageUrl.substring(0, 80)}...`);
    let recaptchaToken;
    try {
      recaptchaToken = await this.capmonster.solveCaptcha(sitekey, pageUrl);
      this.log(`reCAPTCHA: ${recaptchaToken.substring(0, 30)}...`);
    } catch (e) {
      this.log(`reCAPTCHA failed: ${e.message}`);
      return { success: false, error: `reCAPTCHA: ${e.message}` };
    }

    // ── Step 3: POST with reCAPTCHA ───────────────────────────────────
    this.log('POST with reCAPTCHA...');
    const body = new URLSearchParams({
      email, password, repassword: password,
      trustPrivacy: '1', hasAgreed: 'true',
      sid: 'api-platform',
      'g-recaptcha-response': recaptchaToken,
    });

    let regRes = await req(registerUrl, {
      method: 'POST',
      headers: this.h({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': `https://${accountHost}`,
        'Referer': pageUrl,
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: body.toString(),
    }, this.jar);

    let regText = await regRes.text().catch(() => '');
    let regData = parseXiaomi(regText);
    this.log(`Response: ${regText.substring(0, 250)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // Success?
    if (regData?.result === 'ok' || regData?.code === 0 || this.jar.has('passToken')) {
      this.log('Registration succeeded ✓');
      return { success: true, data: regData };
    }

    // Email verification?
    if (regData?.needVerify || regData?.step === 'verify' || regData?.code === 70016) {
      this.log('Email verification needed...');
      await this.verifyEmail(regData, pageUrl, accountHost);
      return { success: true, data: regData };
    }

    // ── Step 4: Image captcha (if reCAPTCHA wasn't enough) ────────────
    if (regData?.code === 87001) {
      this.log('Image captcha needed...');

      for (let attempt = 0; attempt < 5; attempt++) {
        this.jar.remove('ick_error');

        let base64;
        try { base64 = await this.fetchCaptchaImage(accountHost); }
        catch (e) { this.log(`Captcha error: ${e.message}`); continue; }

        let icode;
        try { icode = await this.solveImageCaptcha(base64, attempt); }
        catch (e) { this.log(`Solve error: ${e.message}`); continue; }

        await sleep(500 + Math.random() * 500);

        this.log(`Image attempt ${attempt + 1}: icode=${icode}`);

        const body2 = new URLSearchParams({
          email, password, repassword: password,
          trustPrivacy: '1', hasAgreed: 'true',
          sid: 'api-platform', icode,
          'g-recaptcha-response': recaptchaToken,
        });
        if (this.jar.get('ick')) body2.set('ick', this.jar.get('ick'));

        const imgRes = await req(registerUrl, {
          method: 'POST',
          headers: this.h({
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json, */*',
            'Origin': `https://${accountHost}`, 'Referer': pageUrl,
            'X-Requested-With': 'XMLHttpRequest',
          }),
          body: body2.toString(),
        }, this.jar);

        const imgText = await imgRes.text().catch(() => '');
        const imgData = parseXiaomi(imgText);
        this.log(`Response: ${imgText.substring(0, 200)}`);

        if (imgData?.result === 'ok' || imgData?.code === 0 || this.jar.has('passToken')) {
          this.log('Succeeded ✓');
          return { success: true, data: imgData };
        }

        if (imgData?.needVerify || imgData?.step === 'verify' || imgData?.code === 70016) {
          await this.verifyEmail(imgData, pageUrl, accountHost);
          return { success: true, data: imgData };
        }

        if (imgData?.code !== 87001) break;

        // Case variants
        for (const variant of [icode.toLowerCase(), icode.toUpperCase()].filter(v => v !== icode)) {
          this.log(`Variant: ${variant}`);
          const bodyV = new URLSearchParams(body2);
          bodyV.set('icode', variant);
          const resV = await req(registerUrl, {
            method: 'POST',
            headers: this.h({
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json, */*',
              'Origin': `https://${accountHost}`, 'Referer': pageUrl,
              'X-Requested-With': 'XMLHttpRequest',
            }),
            body: bodyV.toString(),
          }, this.jar);
          const textV = await resV.text().catch(() => '');
          const dataV = parseXiaomi(textV);
          this.log(`Variant ${variant}: ${textV.substring(0, 100)}`);
          if (dataV?.result === 'ok' || dataV?.code === 0 || this.jar.has('passToken')) {
            return { success: true, data: dataV };
          }
          if (dataV?.code !== 87001) break;
        }
        this.log(`Wrong, retrying...`);
      }
    }

    if (this.jar.has('passToken')) {
      this.log('Got passToken ✓');
      return { success: true, data: {} };
    }
    return { success: false, error: regData?.desc || regData?.reason || 'failed' };
  }

  async verifyEmail(regData, referer, accountHost) {
    this.log('Waiting for verification email...');
    let code = null;
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try {
        const messages = await this.tempmail.getMessages(this.email);
        code = this.tempmail.extractVerificationCode(messages);
        if (code) break;
      } catch {}
      this.log(`Waiting... (${i + 1}/12)`);
    }
    if (!code) { this.log('No verification email'); return; }
    this.log(`Code: ${code}`);

    const res = await req(`https://${accountHost}/pass/verifyEmail`, {
      method: 'POST',
      headers: this.h({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, */*',
        'Origin': `https://${accountHost}`, 'Referer': referer,
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: new URLSearchParams({ code, email: this.email, sid: 'api-platform' }).toString(),
    }, this.jar);
    this.log(`Verify: ${res.status} — ${(await res.text().catch(() => '')).substring(0, 200)}`);
  }

  /**
   * Follow user_synced_url to complete the user sync after registration.
   * This is what the browser does automatically via JS redirects.
   */
  async completeUserSync(userSyncedUrl, accountHost) {
    if (!userSyncedUrl) return;
    this.log(`Following user_synced_url...`);
    try {
      const { res, finalUrl } = await reqFollow(userSyncedUrl, {
        method: 'GET',
        headers: this.h({ Accept: 'text/html,application/xhtml+xml,*/*' }),
      }, this.jar);
      this.log(`userSynced → ${finalUrl.substring(0, 120)} (${res.status})`);
      this.log(`Cookies after sync: [${this.jar.keys()}]`);
    } catch (e) {
      this.log(`userSynced follow failed: ${e.message}`);
    }
  }

  /**
   * Do serviceLogin to get passToken cookie.
   * This simulates what the browser does in handleOAuthRedirect().
   *
   * Flow:
   * 1. GET serviceLogin?sid=api-platform to get _sign, qs, etc.
   * 2. POST serviceLogin with credentials
   * 3. Follow location redirect to get passToken
   */
  async doServiceLogin(accountHost) {
    if (this.jar.has('passToken')) {
      this.log('Already have passToken, skipping serviceLogin');
      return true;
    }

    const password = this.config.xiaomi.password;
    const email = this.email;

    this.log('Starting serviceLogin flow...');

    // Step 1: GET serviceLogin page to get _sign and other params
    const slUrl = `https://${accountHost}/pass/serviceLogin?sid=api-platform&_json=true`;
    this.log(`Fetching serviceLogin config...`);
    const slRes = await req(slUrl, {
      method: 'GET',
      headers: this.h({
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://${accountHost}/pass/serviceLogin?sid=api-platform`,
      }),
    }, this.jar);

    const slText = await slRes.text().catch(() => '');
    const slData = parseXiaomi(slText);
    if (!slData) {
      this.log(`serviceLogin parse failed: ${slText.substring(0, 200)}`);
      return false;
    }

    this.log(`serviceLogin config: _sign=${slData._sign?.substring(0, 20)}... qs=${slData.qs?.substring(0, 20)}...`);

    // If location is already set (auto-login), just follow it
    if (slData.location) {
      this.log(`serviceLogin has location, following...`);
      const { res } = await reqFollow(slData.location, {
        method: 'GET',
        headers: this.h({ Accept: 'text/html,*/*' }),
      }, this.jar);
      this.log(`Location redirect → ${res.status}`);
      this.log(`Cookies: [${this.jar.keys()}]`);
      if (this.jar.has('passToken')) {
        this.log('Got passToken from location redirect ✓');
        return true;
      }
    }

    // Step 2: POST login with credentials
    // Xiaomi uses MD5 hash of the password
    const pwHash = md5(password);

    this.log('POST serviceLogin with credentials...');
    const loginBody = new URLSearchParams({
      _json: 'true',
      qs: slData.qs || '',
      sid: 'api-platform',
      _sign: slData._sign || '',
      user: email,
      hash: pwHash,
    });

    const loginRes = await req(`https://${accountHost}/pass/serviceLogin`, {
      method: 'POST',
      headers: this.h({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': `https://${accountHost}`,
        'Referer': `https://${accountHost}/pass/serviceLogin?sid=api-platform`,
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: loginBody.toString(),
    }, this.jar);

    const loginText = await loginRes.text().catch(() => '');
    const loginData = parseXiaomi(loginText);
    this.log(`serviceLogin response: ${loginText.substring(0, 200)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    if (loginData?.location) {
      this.log(`Following login redirect...`);
      const { res } = await reqFollow(loginData.location, {
        method: 'GET',
        headers: this.h({ Accept: 'text/html,*/*' }),
      }, this.jar);
      this.log(`Login redirect → ${res.status}`);
      this.log(`Cookies after redirect: [${this.jar.keys()}]`);
    }

    if (this.jar.has('passToken')) {
      this.log('Got passToken from serviceLogin ✓');
      return true;
    }

    // Step 3: Try cookie2st if passToken still missing
    this.log('Trying cookie2st...');
    const c2sRes = await req(`https://${accountHost}/pass/cookie2st?sid=api-platform`, {
      method: 'GET',
      headers: this.h({ Accept: '*/*' }),
    }, this.jar);
    const c2sText = await c2sRes.text().catch(() => '');
    this.log(`cookie2st: ${c2sText.substring(0, 200)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    return this.jar.has('passToken');
  }

  /**
   * Build cookie string from jar for platform requests.
   */
  buildPlatformCookies() {
    return [
      this.jar.has('passToken') && `passToken=${this.jar.get('passToken')}`,
      this.jar.has('cUserId') && `cUserId=${this.jar.get('cUserId')}`,
      this.jar.has('userId') && `userId=${this.jar.get('userId')}`,
      this.jar.has('serviceToken') && `serviceToken=${this.jar.get('serviceToken')}`,
    ].filter(Boolean).join('; ');
  }

  /**
   * Establish platform session by following the OAuth loginUrl from 401.
   * The browser does this in handleOAuthRedirect() — navigates to platform,
   * gets redirected to account.xiaomi.com/pass/serviceLogin?callback=...,
   * logs in, then redirects back to platform with session cookies.
   */
  async establishPlatformSession() {
    this.log('Establishing platform session via OAuth...');

    const accountHost = 'account.xiaomi.com';

    const verifyPlatform = async () => {
      try {
        const r = await fetch(`${this.platformBase}/api/v1/keys`, {
          headers: { 'User-Agent': this.ua, 'Accept': 'application/json', 'Cookie': this.buildPlatformCookies() },
        });
        const t = await r.text().catch(() => '');
        this.log(`Verify: ${r.status} — ${t.substring(0, 120)}`);
        if (r.ok) return { ok: true };
        if (r.status === 401) {
          try { return { loginUrl: JSON.parse(t)?.loginUrl }; } catch {}
        }
        return null;
      } catch (e) { this.log(`Verify error: ${e.message}`); return null; }
    };

    // Step 1: Get loginUrl from platform 401
    this.log('Step 1: Get loginUrl from platform...');
    const v1 = await verifyPlatform();
    if (v1?.ok) { this.log('Platform already authenticated ✓'); return true; }
    if (!v1?.loginUrl) { this.log('No loginUrl from platform'); return false; }
    const loginUrl = v1.loginUrl;
    this.log(`loginUrl: ${loginUrl.substring(0, 120)}...`);

    // Step 2: GET loginUrl + _json=true to get _sign and qs
    // DO NOT follow any location from this response — it's not the platform redirect
    this.log('Step 2: Fetch serviceLogin config (_json=true)...');
    const sep = loginUrl.includes('?') ? '&' : '?';
    const slGetUrl = `${loginUrl}${sep}_json=true`;
    const slRes = await req(slGetUrl, {
      method: 'GET',
      headers: this.h({
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': loginUrl,
      }),
    }, this.jar);
    const slText = await slRes.text().catch(() => '');
    const slData = parseXiaomi(slText);
    this.log(`serviceLogin config: ${slText.substring(0, 300)}`);
    this.log(`_sign: ${slData?._sign?.substring(0, 30) || 'MISSING'}`);
    this.log(`qs: ${slData?.qs?.substring(0, 80) || 'MISSING'}`);
    this.log(`location: ${slData?.location?.substring(0, 100) || 'NONE'}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // Step 3: POST to /pass/serviceLogin (generic endpoint, like doServiceLogin does)
    // Use _sign and qs from Step 2 (which contain the platform callback)
    // DO NOT POST to loginUrl — POST to the generic endpoint
    if (!slData?._sign) {
      this.log('No _sign in response, cannot POST');
      return false;
    }

    this.log('Step 3: POST login to /pass/serviceLogin with platform params...');
    const pwHash = md5(this.config.xiaomi.password);
    const loginBody = new URLSearchParams({
      _json: 'true',
      qs: slData.qs || '',
      _sign: slData._sign || '',
      user: this.email,
      hash: pwHash,
    });

    const loginRes = await req(`https://${accountHost}/pass/serviceLogin`, {
      method: 'POST',
      headers: this.h({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': `https://${accountHost}`,
        'Referer': slGetUrl,
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: loginBody.toString(),
    }, this.jar);

    const loginText = await loginRes.text().catch(() => '');
    const loginData = parseXiaomi(loginText);
    this.log(`Login POST: ${loginRes.status} — ${loginText.substring(0, 300)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // Step 4: Follow login redirect → should go to platform with code
    if (loginData?.location) {
      this.log(`Step 4: Following redirect → ${loginData.location.substring(0, 120)}...`);
      const { res: redirRes, finalUrl: redirFinal } = await reqFollow(loginData.location, {
        method: 'GET',
        headers: this.h({ Accept: 'text/html,*/*' }),
      }, this.jar);
      this.log(`Redirect → ${new URL(redirFinal).hostname} (${redirRes.status})`);
      this.log(`Cookies: [${this.jar.keys()}]`);

      // If we're on the platform, verify session
      if (redirFinal.includes('platform.xiaomimimo.com')) {
        const v2 = await verifyPlatform();
        if (v2?.ok) { this.log('Platform session established ✓'); return true; }
      }

      // If we're back on account.xiaomi.com, follow more redirects
      if (redirFinal.includes('account.xiaomi.com')) {
        this.log('Back on account, following more redirects...');
        const { res: r2, finalUrl: f2 } = await reqFollow(redirFinal, {
          method: 'GET',
          headers: this.h({ Accept: 'text/html,*/*' }),
        }, this.jar);
        this.log(`→ ${new URL(f2).hostname} (${r2.status})`);
        this.log(`Cookies: [${this.jar.keys()}]`);
        if (f2.includes('platform.xiaomimimo.com')) {
          const v3 = await verifyPlatform();
          if (v3?.ok) { this.log('Platform session established ✓'); return true; }
        }
      }
    } else if (loginRes.status >= 300 && loginRes.status < 400) {
      const loc = loginRes.headers.get('location');
      if (loc) {
        this.log(`Step 4: HTTP ${loginRes.status} redirect → ${loc.substring(0, 100)}`);
        const { finalUrl: httpFinal } = await reqFollow(loc, {
          method: 'GET',
          headers: this.h({ Accept: 'text/html,*/*' }),
        }, this.jar);
        this.log(`→ ${httpFinal.substring(0, 120)}`);
        this.log(`Cookies: [${this.jar.keys()}]`);
        if (httpFinal.includes('platform.xiaomimimo.com')) {
          const v4 = await verifyPlatform();
          if (v4?.ok) { this.log('Platform session established ✓'); return true; }
        }
      }
    }

    // If POST returned HTML (like 405), try parsing for JS redirects
    if (!loginData?.location) {
      this.log('No location in POST response, checking HTML...');
      const jsRedirect = loginText.match(/(?:location\.href|window\.location(?:\.href)?)\s*=\s*["']([^"']+)/);
      if (jsRedirect) {
        this.log(`JS redirect: ${jsRedirect[1].substring(0, 100)}`);
        const { finalUrl: jsFinal } = await reqFollow(jsRedirect[1], {
          method: 'GET',
          headers: this.h({ Accept: 'text/html,*/*' }),
        }, this.jar);
        this.log(`→ ${jsFinal.substring(0, 120)}`);
        this.log(`Cookies: [${this.jar.keys()}]`);
        if (jsFinal.includes('platform.xiaomimimo.com')) {
          const v5 = await verifyPlatform();
          if (v5?.ok) { this.log('Platform session established ✓'); return true; }
        }
      }
    }

    // Final check
    this.log('Final verification...');
    const fv = await verifyPlatform();
    if (fv?.ok) { this.log('Platform session established ✓'); return true; }

    this.log('Platform session could not be established');
    return false;
  }


  async platformFallback(accountHost) {
    this.log('Platform fallback: trying serviceLogin with platform callback...');

    // Get fresh loginUrl from platform
    const v = await (async () => {
      try {
        const r = await fetch(`${this.platformBase}/api/v1/keys`, {
          headers: { 'User-Agent': this.ua, 'Accept': 'application/json', 'Cookie': this.buildPlatformCookies() },
        });
        const t = await r.text().catch(() => '');
        if (r.status === 401) return JSON.parse(t)?.loginUrl;
      } catch {}
      return null;
    })();
    if (!v) { this.log('No loginUrl for fallback'); return false; }

    const parsed = new URL(v);
    const callbackEncoded = parsed.searchParams.get('callback') || '';
    const callbackUrl = decodeURIComponent(callbackEncoded);
    if (!callbackUrl) { this.log('No callback in loginUrl'); return false; }

    // Try cookie2st with platform callback
    this.log('Trying cookie2st...');
    const c2sRes = await req(`https://${accountHost}/pass/cookie2st?callback=${encodeURIComponent(callbackUrl)}&_=${Date.now()}`, {
      method: 'GET',
      headers: this.h({ Accept: '*/*' }),
    }, this.jar);
    const c2sText = await c2sRes.text().catch(() => '');
    this.log(`cookie2st: ${c2sText.substring(0, 200)}`);
    this.log(`Cookies: [${this.jar.keys()}]`);

    // Verify
    try {
      const vr = await fetch(`${this.platformBase}/api/v1/keys`, {
        headers: { 'User-Agent': this.ua, 'Accept': 'application/json', 'Cookie': this.buildPlatformCookies() },
      });
      this.log(`Verify: ${vr.status}`);
      if (vr.ok) { this.log('Platform session established ✓'); return true; }
    } catch {}

    this.log('Platform fallback failed');
    return false;
  }


  async createApiKey() {
    this.log('Creating API key...');

    // Always establish platform session — account.xiaomi.com serviceToken
    // is NOT the same as platform.xiaomimimo.com session cookies.
    await this.establishPlatformSession();

    const ck = this.buildPlatformCookies();
    if (!ck) { this.log('No auth cookies'); return null; }

    for (const ep of [
      { url: `${this.platformBase}/api/v1/keys`, body: { name: 'mykey' } },
      { url: `${this.platformBase}/api/v1/apikeys`, body: { name: 'mykey' } },
    ]) {
      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: {
            'User-Agent': this.ua, 'Content-Type': 'application/json',
            'Accept': 'application/json', 'Origin': this.platformBase,
            'Referer': `${this.platformBase}/console/api-keys`, 'Cookie': ck,
          },
          body: JSON.stringify(ep.body),
        });
        const text = await res.text().catch(() => '');
        this.log(`Key: ${res.status} — ${text.substring(0, 150)}`);
        if (res.ok) {
          const data = JSON.parse(text || '{}');
          const key = data.key || data.apiKey || data.api_key || data.data?.key;
          if (key?.startsWith('sk-')) return key;
          const m = text.match(/sk-[a-zA-Z0-9_\-]{20,}/);
          if (m) return m[0];
        }
      } catch (e) { this.log(`Key error: ${e.message}`); }
    }

    try {
      const res = await fetch(`${this.platformBase}/api/v1/keys`, {
        headers: { 'User-Agent': this.ua, 'Accept': 'application/json', 'Cookie': ck },
      });
      if (res.ok) {
        const data = JSON.parse(await res.text());
        const keys = data.keys || data.data || data;
        if (Array.isArray(keys) && keys[0]?.key) return keys[0].key;
      }
    } catch {}

    this.log('Could not create API key');
    return null;
  }

  async run() {
    const t0 = Date.now();
    this.log('═'.repeat(60));
    this.log('MiMo Registration — Full API Mode');
    this.log('═'.repeat(60));

    try {
      await this.createEmail();
      const reg = await this.register();

      if (reg.success) {
        // ── Step 5: Follow user_synced_url to complete user sync ──────
        const userSyncedUrl = reg.data?.user_synced_url;
        const accountHost = userSyncedUrl
          ? new URL(userSyncedUrl).host
          : 'account.xiaomi.com';
        
        if (userSyncedUrl) {
          this.log(`user_synced_url found: ${userSyncedUrl.substring(0, 80)}...`);
          await this.completeUserSync(userSyncedUrl, accountHost);
        }

        // ── Step 6: serviceLogin to get passToken ────────────────────
        await this.doServiceLogin(accountHost);
      }

      let apiKey = reg.success ? await this.createApiKey() : null;

      const passToken = this.jar.get('passToken');
      const cUserId = this.jar.get('cUserId') || this.jar.get('userId');
      const userId = this.jar.get('userId');
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      this.log(`Done in ${elapsed}s — apiKey:${apiKey ? '✓' : '✗'} passToken:${passToken ? '✓' : '✗'}`);

      return {
        email: this.email, password: this.config.xiaomi.password,
        apiKey, passToken, cUserId, userId,
        status: apiKey ? 'success' : (passToken ? 'partial' : 'error'),
        method: 'api',
        error: reg.success ? null : (reg.error || 'failed'),
        logs: this.logLines,
      };
    } catch (err) {
      this.log(`Fatal: ${err.message}`);
      return {
        email: this.email, password: this.config.xiaomi.password,
        apiKey: null, passToken: null, cUserId: null, userId: null,
        status: 'error', method: 'api', error: err.message, logs: this.logLines,
      };
    }
  }
}

export default MimoApiRegistration;
