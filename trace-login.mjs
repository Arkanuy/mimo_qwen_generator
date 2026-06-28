const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class CookieJar {
  constructor() { this.map = new Map(); }
  setFromHeaders(headers) {
    let list = [];
    if (typeof headers.getSetCookie === 'function') list = headers.getSetCookie();
    else { const r = headers.get('set-cookie'); if (r) list = [r]; }
    for (const c of (list || [])) {
      if (!c) continue;
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  toString() { return [...this.map.entries()].map(([k,v]) => `${k}=${v}`).join('; '); }
  has(n) { return this.map.has(n); }
  get(n) { return this.map.get(n); }
  keys() { return [...this.map.keys()]; }
  all() { return Object.fromEntries(this.map); }
}

const jar = new CookieJar();
const h = (extra = {}) => ({
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  ...extra,
});

async function req(url, opts = {}) {
  const headers = h(opts.headers || {});
  const ck = jar.toString();
  if (ck) headers['cookie'] = ck;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  jar.setFromHeaders(res.headers);
  return res;
}

async function reqFollow(url, opts = {}, maxHops = 10) {
  let cur = url;
  let res = await req(cur, opts);
  let hops = 0;
  console.log(`[follow] ${cur.substring(0,120)} → ${res.status}`);
  while ([301,302,303,307,308].includes(res.status) && hops < maxHops) {
    const loc = res.headers.get('location');
    if (!loc) break;
    cur = loc.startsWith('http') ? loc : new URL(loc, cur).toString();
    console.log(`  → redirect ${cur.substring(0,140)}`);
    res = await req(cur, { method: 'GET', body: undefined });
    jar.setFromHeaders(res.headers);
    console.log(`  → ${res.status} cookies:[${jar.keys()}]`);
    hops++;
  }
  return { res, finalUrl: cur };
}

async function main() {
  // === Trace 1: serviceLogin?_json=true (what the browser fetches for initial config) ===
  console.log('\n=== 1. serviceLogin JSON config ===');
  const sl1 = await req('https://account.xiaomi.com/pass/serviceLogin?sid=api-platform&_json=true', {
    method: 'GET', headers: h({ 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' }),
  });
  const sl1Text = await sl1.text().catch(() => '');
  console.log(`Status: ${sl1.status}`);
  console.log(`Body: ${sl1Text.substring(0, 600)}`);
  console.log(`Cookies: [${jar.keys()}]`);

  // Parse _sign from serviceLogin response
  const cleaned = sl1Text.replace(/^&&&START&&&/, '').trim();
  let slData;
  try { slData = JSON.parse(cleaned); } catch { slData = null; }
  if (slData) {
    console.log(`\nserviceLogin data keys: ${Object.keys(slData).join(', ')}`);
    console.log(`_sign: ${slData._sign?.substring(0, 50)}`);
    console.log(`qs: ${slData.qs?.substring(0, 50)}`);
    console.log(`callback: ${slData.callback}`);
    console.log(`location: ${slData.location?.substring(0, 150)}`);
    console.log(`notificationUrl: ${slData.notificationUrl}`);
    console.log(`passTokenResult: ${slData.passTokenResult}`);
    console.log(`busiResult: ${slData.busiResult}`);
    console.log(`sid: ${slData.sid}`);
  }

  // === Trace 2: Try POST serviceLogin with credentials ===
  console.log('\n\n=== 2. POST serviceLogin (sign in) ===');
  if (slData?._sign) {
    const loginBody = new URLSearchParams({
      _sign: slData._sign,
      qs: slData.qs || '',
      sid: 'api-platform',
      _json: 'true',
      user: 'test@fake.com', // just to see the response format
      hash: '', // Xiaomi uses MD5 hashed password
    });
    
    const loginRes = await req('https://account.xiaomi.com/pass/serviceLogin', {
      method: 'POST',
      headers: h({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': 'https://account.xiaomi.com',
        'Referer': 'https://account.xiaomi.com/pass/serviceLogin?sid=api-platform',
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: loginBody.toString(),
    });
    const loginText = await loginRes.text().catch(() => '');
    console.log(`Status: ${loginRes.status}`);
    console.log(`Body: ${loginText.substring(0, 500)}`);
    console.log(`Cookies: [${jar.keys()}]`);
    
    const loginCleaned = loginText.replace(/^&&&START&&&/, '').trim();
    let loginData;
    try { loginData = JSON.parse(loginCleaned); } catch { loginData = null; }
    if (loginData) {
      console.log(`\nlogin data: ${JSON.stringify(loginData).substring(0, 500)}`);
      console.log(`location: ${loginData.location?.substring(0, 200)}`);
      console.log(`passTokenResult: ${loginData.passTokenResult}`);
      console.log(`notificationUrl: ${loginData.notificationUrl}`);
    }
  }

  // === Trace 3: Follow userSynced URL (the one from registration response) ===
  console.log('\n\n=== 3. Follow userSynced URL ===');
  const syncUrl = 'https://account.xiaomi.com/pass/userSynced?externalId=test@test.com&region=ID&externalType=EM&uuid=test123';
  const syncRes = await reqFollow(syncUrl, { method: 'GET', headers: h({ Accept: 'text/html,*/*' }) });
  console.log(`Final URL: ${syncRes.finalUrl}`);
  const syncBody = await syncRes.res.text().catch(() => '');
  console.log(`Body length: ${syncBody.length}`);
  console.log(`Body snippet: ${syncBody.substring(0, 300)}`);
  console.log(`Cookies: [${jar.keys()}]`);

  // === Trace 4: Visit platform to trigger OAuth flow ===
  console.log('\n\n=== 4. Visit platform (triggers OAuth) ===');
  const platRes = await reqFollow('https://platform.xiaomimimo.com/', {
    method: 'GET', headers: h({ Accept: 'text/html,*/*' }),
  });
  console.log(`Final URL: ${platRes.finalUrl}`);
  const platBody = await platRes.res.text().catch(() => '');
  console.log(`Body length: ${platBody.length}`);
  // Look for redirect patterns
  const redirectMatch = platBody.match(/(account\.xiaomi\.com\/pass\/serviceLogin[^\s"'<]+)/);
  if (redirectMatch) console.log(`serviceLogin URL in page: ${redirectMatch[1]}`);
  console.log(`Cookies: [${jar.keys()}]`);

  // === Summary ===
  console.log('\n\n=== Summary ===');
  console.log(`All cookies: ${jar.keys().join(', ')}`);
  console.log(`passToken: ${jar.has('passToken') ? jar.get('passToken').substring(0,30) : 'MISSING'}`);
  console.log(`cUserId: ${jar.has('cUserId') ? jar.get('cUserId').substring(0,30) : 'MISSING'}`);
  console.log(`userId: ${jar.has('userId') ? jar.get('userId').substring(0,30) : 'MISSING'}`);
}

main().catch(e => console.error('Fatal:', e.message, e.stack?.substring(0, 300)));
