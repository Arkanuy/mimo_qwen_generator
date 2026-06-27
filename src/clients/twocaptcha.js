/**
 * 2Captcha Solver Client
 *
 * Mendukung:
 *   - reCAPTCHA v2 (method=userrecaptcha)
 *   - Image captcha (method=base64)
 */

import fetch from 'node-fetch';

class CaptchaSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://2captcha.com';
  }

  async solveCaptcha(sitekey, pageUrl) {
    console.log('[Captcha] Creating task...');

    const taskId = await this.createTask(sitekey, pageUrl);
    console.log(`[Captcha] Task ID: ${taskId}`);

    const solution = await this.waitForSolution(taskId);
    console.log('[Captcha] ✓ Solved');

    return solution;
  }

  async solveImageCaptcha(base64Image) {
    console.log('[Captcha] Creating image captcha task...');
    const url = `${this.baseUrl}/in.php`;

    const params = new URLSearchParams();
    params.append('key', this.apiKey);
    params.append('method', 'base64');
    params.append('body', base64Image);
    params.append('json', '1');

    const response = await fetch(url, {
      method: 'POST',
      body: params
    });

    const data = await response.json();
    if (data.status !== 1) {
      throw new Error(`2Captcha image task failed: ${data.request || 'Unknown error'}`);
    }

    const taskId = data.request;
    console.log(`[Captcha] Image Task ID: ${taskId}`);

    const solution = await this.waitForSolution(taskId);
    console.log('[Captcha] ✓ Solved');

    return solution;
  }

  async createTask(sitekey, pageUrl) {
    const url = `${this.baseUrl}/in.php?key=${this.apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 1) {
      throw new Error(`2Captcha task creation failed: ${data.request || 'Unknown error'}`);
    }

    return data.request;
  }

  async waitForSolution(taskId, maxWait = 180000, interval = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));

      const url = `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${taskId}&json=1`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 1) {
        return data.request;
      }

      if (data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha error: ${data.request}`);
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[Captcha] Waiting... (${elapsed}s)`);
    }

    throw new Error('Captcha solving timeout');
  }
}

export { CaptchaSolver };
