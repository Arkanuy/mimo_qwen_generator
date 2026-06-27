/**
 * Helper untuk interaksi browser ala manusia.
 *
 * Tujuan: menghindari pola bot yang kentara (paste instan via .fill(),
 * klik tanpa hover/jeda, dsb). Bukan stealth penuh — cuma menambah
 * jitter di layer event yang biasa diukur skrip antifraud
 * (waktu antar keystroke, klik tanpa pointermove, fokus tanpa klik).
 *
 * Pakai begini:
 *   import { humanType, humanClick, humanDelay, humanFill } from './human.js';
 *   await humanFill(page, 'input[name="email"]', email);
 *   await humanClick(page, 'button[type="submit"]');
 */

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

export function humanDelay(min = 80, max = 220) {
  return new Promise((resolve) => setTimeout(resolve, randInt(min, max)));
}

/**
 * Resolve target ke ElementHandle/Locator yang punya method click/fill/type.
 * - String → page.$(selector)  (ElementHandle)
 * - Locator → return apa adanya
 * - ElementHandle → return apa adanya
 */
async function resolveTarget(pageOrFrame, target) {
  if (typeof target === 'string') {
    const handle = await pageOrFrame.$(target);
    if (!handle) throw new Error(`humanFill: selector tidak ketemu: ${target}`);
    return handle;
  }
  return target;
}

/**
 * Klik element dengan sedikit hover dulu. Hover memicu pointermove,
 * yang sering dipakai sebagai sinyal "user benerian" oleh script antibot.
 */
export async function humanClick(pageOrFrame, target, options = {}) {
  const el = await resolveTarget(pageOrFrame, target);
  try {
    // Move pointer ke element pelan-pelan (Playwright hover sudah
    // terjemahkan jadi serangkaian pointermove)
    await el.hover({ timeout: options.hoverTimeout || 4000 }).catch(() => {});
  } catch (e) {}
  await humanDelay(60, 180);
  await el.click({ ...options, delay: randInt(40, 120) });
}

/**
 * Ketik teks ala manusia: per karakter dengan delay acak,
 * sesekali jeda 200-500ms seolah-olah "mikir".
 */
export async function humanType(pageOrFrame, text, options = {}) {
  const minDelay = options.minDelay ?? 60;
  const maxDelay = options.maxDelay ?? 180;
  const thinkProb = options.thinkProb ?? 0.07;        // 7% chance jeda mikir per char
  const thinkMin = options.thinkMin ?? 220;
  const thinkMax = options.thinkMax ?? 520;

  const keyboard = pageOrFrame.keyboard;
  for (const ch of text) {
    await keyboard.type(ch, { delay: randInt(minDelay, maxDelay) });
    if (Math.random() < thinkProb) {
      await humanDelay(thinkMin, thinkMax);
    }
  }
}

/**
 * Set value via React-compatible native setter + dispatch events.
 * React controlled inputs use Object.getOwnPropertyDescriptor to hijack
 * the value setter — we need to call the NATIVE setter to bypass that,
 * then dispatch 'input' + 'change' events so React picks up the change.
 */
async function reactSetValue(el, value) {
  await el.evaluate((node, val) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(node, val);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * Fokus ke field, bersihkan isi lama secara natural, lalu ketik nilai baru.
 * Menggunakan native setter untuk React compatibility + keyboard.type
 * untuk event keystroke yang natural.
 *
 * options:
 *   - clear:  'select-all' (default) atau 'backspace' atau 'none'
 *   - clickFirst: true (default) — klik field dulu sebelum ngetik
 *   - reactMode: 'native' (default) — pakai native setter + dispatch
 *                'keyboard' — keyboard.type murni (lama, bisa fail di React)
 */
export async function humanFill(pageOrFrame, target, value, options = {}) {
  const el = await resolveTarget(pageOrFrame, target);

  // Click to focus the field
  if (options.clickFirst !== false) {
    try { await el.hover({ timeout: 3000 }); } catch (e) {}
    await humanDelay(80, 200);
    try {
      await el.click({ delay: randInt(40, 120) });
    } catch (e) {
      try { await el.focus(); } catch (e2) {}
    }
  } else {
    try { await el.focus(); } catch (e) {}
  }
  await humanDelay(80, 200);

  // STRATEGY 1: Playwright .fill() — paling reliable untuk React/Ant Design
  // Properly handles controlled inputs, dispatches correct events
  try {
    await el.fill(value);
    await humanDelay(100, 200);
    const actual = await el.evaluate(n => n.value).catch(() => '');
    if (actual === value) return;
  } catch (e) {
    // .fill() failed, try next strategy
  }

  // STRATEGY 2: Native setter (for inputs that reject .fill())
  const clearMode = options.clear ?? 'select-all';
  if (clearMode === 'select-all') {
    await pageOrFrame.keyboard.press('Control+A');
    await humanDelay(40, 100);
    await pageOrFrame.keyboard.press('Backspace');
  } else if (clearMode === 'backspace') {
    for (let i = 0; i < 100; i++) {
      const v = await el.evaluate((node) => node.value || '').catch(() => '');
      if (!v) break;
      await pageOrFrame.keyboard.press('Backspace');
      await humanDelay(20, 60);
    }
  }
  await humanDelay(60, 160);

  await reactSetValue(el, value);
  await humanDelay(100, 200);
  const actual2 = await el.evaluate(n => n.value).catch(() => '');
  if (actual2 === value) return;

  // STRATEGY 3: Keyboard typing as last resort
  await el.evaluate(n => { n.value = ''; n.focus(); });
  await humanDelay(40, 80);
  await humanType(pageOrFrame, String(value), options);
}

/**
 * Versi humanFill khusus Locator API (page.locator(...)) — kadang lebih
 * stabil daripada selector string karena Locator auto-wait.
 */
export async function humanFillLocator(page, locator, value, options = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.hover({ timeout: 3000 }).catch(() => {});
  await humanDelay(80, 200);
  await locator.click({ delay: randInt(40, 120) }).catch(async () => {
    // fallback: focus aja
    await locator.focus().catch(() => {});
  });
  await humanDelay(80, 200);

  await page.keyboard.press('Control+A');
  await humanDelay(40, 100);
  await page.keyboard.press('Backspace');
  await humanDelay(60, 160);

  // Native setter for React compatibility
  const handle = await locator.elementHandle();
  if (handle) {
    await reactSetValue(handle, value);
  } else {
    await humanType(page, String(value), options);
  }
  await humanDelay(80, 200);
}
