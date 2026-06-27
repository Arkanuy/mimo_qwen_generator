/**
 * CapMonster Cloud Solver Client
 *
 * Mendukung:
 *   - reCAPTCHA v2 (RecaptchaV2TaskProxyless)
 *   - Image captcha (ImageToTextTask)
 *
 * API docs: https://docs.capmonster.cloud/docs/getting-started/
 */

import fetch from 'node-fetch';

class CapMonsterSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.capmonster.cloud';
  }

  async solveCaptcha(sitekey, pageUrl) {
    console.log('[CapMonster] Creating reCAPTCHA v2 task...');

    const taskId = await this.createRecaptchaV2Task(sitekey, pageUrl);
    console.log(`[CapMonster] Task ID: ${taskId}`);

    const solution = await this.waitForSolution(taskId);
    console.log('[CapMonster] ✓ Solved');

    return solution;
  }

  async solveImageCaptcha(base64Image) {
    console.log('[CapMonster] Creating image captcha task...');

    const taskId = await this.createImageToTextTask(base64Image);
    console.log(`[CapMonster] Image Task ID: ${taskId}`);

    const solution = await this.waitForSolution(taskId);
    console.log('[CapMonster] ✓ Solved');

    return solution;
  }

  async createRecaptchaV2Task(sitekey, pageUrl) {
    const response = await fetch(`${this.baseUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.apiKey,
        task: {
          type: 'RecaptchaV2TaskProxyless',
          websiteURL: pageUrl,
          websiteKey: sitekey,
        },
      }),
    });

    const data = await response.json();
    if (data.errorId !== 0) {
      throw new Error(`CapMonster reCAPTCHA task failed: ${data.errorCode || data.errorDescription || 'Unknown error'}`);
    }

    return data.taskId;
  }

  async createImageToTextTask(base64Image) {
    const body = base64Image.startsWith('data:')
      ? base64Image.split(',')[1]
      : base64Image;

    const response = await fetch(`${this.baseUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.apiKey,
        task: {
          type: 'ImageToTextTask',
          body: body,
          CapMonsterCaseSensitive: true,
          CapMonsterNumeric: 0,
          recognizingThreshold: 80,
        },
      }),
    });

    const data = await response.json();
    if (data.errorId !== 0) {
      throw new Error(`CapMonster image task failed: ${data.errorCode || data.errorDescription || 'Unknown error'}`);
    }

    return data.taskId;
  }

  async waitForSolution(taskId, maxWait = 180000, interval = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));

      const response = await fetch(`${this.baseUrl}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: this.apiKey,
          taskId: taskId,
        }),
      });

      const data = await response.json();

      if (data.errorId !== 0) {
        throw new Error(`CapMonster error: ${data.errorCode || data.errorDescription || 'Unknown error'}`);
      }

      if (data.status === 'ready') {
        // reCAPTCHA → gRecaptchaResponse, image → text
        return data.solution.gRecaptchaResponse || data.solution.text;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[CapMonster] Waiting... (${elapsed}s)`);
    }

    throw new Error('CapMonster solving timeout');
  }
}

export { CapMonsterSolver };
