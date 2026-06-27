/**
 * Watermark & branding.
 */

const BRAND = {
  name: 'MiMo Register',
  version: '3.0.0',
  author: 'arkan',
};

function brandHeader() {
  return `🔷 *${BRAND.name}* v${BRAND.version}`;
}

function brandFooter() {
  return '';
}

function aboutMessage() {
  let text = `🤖 *${BRAND.name}*\n`;
  text += `🏷 v${BRAND.version}\n`;
  text += `👤 ${BRAND.author}\n`;
  return text;
}

export { BRAND, brandHeader, brandFooter, aboutMessage };
