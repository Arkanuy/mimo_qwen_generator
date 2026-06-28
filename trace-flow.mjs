const sleep = ms => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class CookieJar {
  constructor() { this.cookies = new Map(); }
  setFromHeaders(headers) {
    let list = [];
    if (typeof headers.getSetCookie === 'function') list = headers.getSetCookie();
    else { const r = headers.get('set-cookie'); if (r) list = [r]; }
    for (const c of list) {
      if (!c) continue;
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) {
        this.cookies.set(name, value);
        console.log(`  [cookie set] ${name}=${value.substring(0, 60)}...`);
      }
    }
  }
  toString() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  has(n) { return this.cookies.has(n); }
  get(n) { return this.cookies.get(n); }
  keys() { return [...this.cookies.keys()]; }
}

const jar = new CookieJar();

async function req(url, opts = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    ...opts.headers,
  };
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
  console.log(`\n[reqFollow] ${cur} → ${res.status}`);
  while ([301, 302, 303, 307, 308].includes(res.status) && hops < maxHops) {
    const loc = res.headers.get('location');
    if (!loc) break;
    cur = loc.startsWith('http') ? loc : new URL(loc, cur).toString();
    console.log(`  → redirect to ${cur.substring(0, 120)}`);
    res = await req(cur, { ...opts, method: 'GET', body: undefined });
    console.log(`  → ${res.status}`);
    hops++;
  }
  return { res, finalUrl: cur, hops };
}

async function main() {
  // === SIMULATION: After successful registration with user_synced_url ===
  
  // Step 1: Follow referral like the real code does
  console.log('=== Step 1: Follow referral ===');
  const refUrl = 'https://platform.xiaomimimo.com/?ref=T8K299';
  const { finalUrl: pageUrl } = await reqFollow(refUrl, {
    method: 'GET', headers: { Accept: 'text/html,*/*' }
  });
  console.log(`Final URL: ${pageUrl}`);
  console.log(`Cookies: [${jar.keys()}]`);
  
  // Step 2: Check what the registration page looks like
  console.log('\n=== Step 2: Load registration page ===');
  const pageRes = await reqFollow(pageUrl, {
    method: 'GET', headers: { Accept: 'text/html,*/*' }
  });
  console.log(`Final URL: ${pageRes.finalUrl}`);
  const pageBody = await pageRes.res.text().catch(() => '');
  console.log(`Body length: ${pageBody.length}`);
  
  // Extract useful info from the page
  const sidMatch = pageBody.match(/sid['":\s]+['"]([\w-]+)['"]/);
  const serviceTokenMatch = pageBody.match(/serviceToken/);
  console.log(`SID found: ${sidMatch?.[1]}`);
  console.log(`serviceToken mentioned: ${!!serviceTokenMatch}`);
  
  // Check for any hidden form data or JS config
  const configMatch = pageBody.match(/window\.__[A-Z_]+\s*=\s*(\{[^<]+\})/);
  if (configMatch) console.log(`Config: ${configMatch[1].substring(0, 200)}`);
  
  // Look for serviceLogin related URLs in the page
  const loginUrls = [...pageBody.matchAll(/https?:\/\/account\.xiaomi\.com\/pass\/[\w?=&\-\/]+/g)];
  console.log(`\nAccount URLs found in page (${loginUrls.length}):`);
  loginUrls.forEach(m => console.log(`  ${m[0]}`));
  
  // Step 3: Check what serviceLogin returns
  console.log('\n=== Step 3: serviceLogin?_json=true ===');
  const slRes = await req('https://account.xiaomi.com/pass/serviceLogin?sid=api-platform&_json=true', {
    method: 'GET',
    headers: { Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest' },
  });
  const slText = await slRes.text().catch(() => '');
  console.log(`Status: ${slRes.status}`);
  console.log(`Body: ${slText.substring(0, 500)}`);
  console.log(`Cookies: [${jar.keys()}]`);
  
  // Step 4: Check what the pass/ endpoint gives
  console.log('\n=== Step 4: Check pass/cookie2st ===');
  const c2sRes = await req('https://account.xiaomi.com/pass/cookie2st?sid=api-platform', {
    method: 'GET',
    headers: { Accept: '*/*' },
  });
  console.log(`Status: ${c2sRes.status}`);
  const c2sText = await c2sRes.text().catch(() => '');
  console.log(`Body: ${c2sText.substring(0, 300)}`);
  console.log(`Cookies: [${jar.keys()}]`);
  
  // Step 5: Try serviceLogin with full page
  console.log('\n=== Step 5: serviceLogin full page ===');
  const slFullRes = await reqFollow('https://account.xiaomi.com/pass/serviceLogin?sid=api-platform', {
    method: 'GET', headers: { Accept: 'text/html,*/*' }
  });
  console.log(`Final URL: ${slFullRes.finalUrl}`);
  const slFullBody = await slFullRes.res.text().catch(() => '');
  console.log(`Body length: ${slFullBody.length}`);
  console.log(`Body snippet: ${slFullBody.substring(0, 500)}`);
  console.log(`Cookies: [${jar.keys()}]`);
  
  // Extract _sign and other fields from the login page
  const signMatch = slFullBody.match(/name="_sign"[^>]*value="([^"]+)"/);
  const qsMatch = slFullBody.match(/name="qs"[^>]*value="([^"]+)"/);
  console.log(`\n_sign: ${signMatch?.[1]?.substring(0, 50)}`);
  console.log(`qs: ${qsMatch?.[1]?.substring(0, 50)}`);
  
  // Step 6: Now simulate what browser does AFTER registration success
  // The user_synced_url is the key - browser follows it
  console.log('\n=== Step 6: Simulate userSynced flow ===');
  // Use a fake externalId but trace the flow
  const syncRes = await reqFollow('https://account.xiaomi.com/pass/userSynced?externalId=test@test.com&region=ID&externalType=EM', {
    method: 'GET', headers: { Accept: 'text/html,*/*' }
  });
  console.log(`Final URL: ${syncRes.finalUrl}`);
  const syncBody = await syncRes.res.text().catch(() => '');
  console.log(`Body length: ${syncBody.length}`);
  console.log(`Body snippet: ${syncBody.substring(0, 500)}`);
  console.log(`Cookies: [${jar.keys()}]`);
  
  // Step 7: Check platform after all these steps
  console.log('\n=== Step 7: Check platform API with current cookies ===');
  const apiRes = await req('https://platform.xiaomimimo.com/api/v1/keys', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  console.log(`Status: ${apiRes.status}`);
  const apiBody = await apiRes.text().catch(() => '');
  console.log(`Body: ${apiBody.substring(0, 300)}`);
  
  console.log('\n=== Final state ===');
  console.log(`All cookies: [${jar.keys()}]`);
  console.log(`passToken: ${jar.has('passToken') ? jar.get('passToken').substring(0, 30) : 'MISSING'}`);
  console.log(`cUserId: ${jar.has('cUserId') ? jar.get('cUserId').substring(0, 30) : 'MISSING'}`);
}

main().catch(e => console.error('Fatal:', e.message));
