import { firefox } from 'playwright';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
  });
  
  const page = await context.newPage();
  
  page.on('response', async (response) => {
    const url = response.url();
    const headers = response.headers();
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      console.log(`[SET-COOKIE] ${url.substring(0, 120)}`);
      console.log(`  → ${setCookie.substring(0, 400)}`);
    }
  });

  // Step 1: Load platform (referral)
  console.log('\n=== Step 1: Load platform ===');
  await page.goto('https://platform.xiaomimimo.com/?ref=T8K299', { 
    waitUntil: 'networkidle',
    timeout: 30000 
  }).catch(e => console.log('Nav error:', e.message.substring(0, 200)));
  console.log(`Final URL: ${page.url()}`);
  
  await sleep(2000);
  const cookies1 = await context.cookies();
  console.log(`\nCookies after platform load (${cookies1.length}):`);
  cookies1.forEach(c => console.log(`  ${c.domain} | ${c.name}=${c.value.substring(0, 50)}`));

  // Step 2: Go to serviceLogin page
  console.log('\n=== Step 2: serviceLogin ===');
  await page.goto('https://account.xiaomi.com/pass/serviceLogin?sid=api-platform&_json=true', {
    waitUntil: 'networkidle',
    timeout: 15000
  }).catch(e => console.log('Nav error:', e.message.substring(0, 200)));
  console.log(`Final URL: ${page.url()}`);
  
  const body = await page.textContent('body').catch(() => '');
  console.log(`Body: ${body.substring(0, 500)}`);
  
  const cookies2 = await context.cookies();
  console.log(`\nCookies after serviceLogin (${cookies2.length}):`);
  cookies2.forEach(c => console.log(`  ${c.domain} | ${c.name}=${c.value.substring(0, 50)}`));

  // Step 3: Try a simulated userSynced URL
  console.log('\n=== Step 3: userSynced ===');
  await page.goto('https://account.xiaomi.com/pass/userSynced?externalId=test@test.com&region=ID&externalType=EM', {
    waitUntil: 'networkidle',
    timeout: 15000
  }).catch(e => console.log('Nav error:', e.message.substring(0, 200)));
  console.log(`Final URL: ${page.url()}`);
  
  const body3 = await page.textContent('body').catch(() => '');
  console.log(`Body: ${body3.substring(0, 500)}`);
  
  const cookies3 = await context.cookies();
  console.log(`\nFinal cookies (${cookies3.length}):`);
  cookies3.forEach(c => console.log(`  ${c.domain} | ${c.name}=${c.value.substring(0, 50)}`));

  await browser.close();
}

main().catch(e => console.error('Fatal:', e.message));
