/**
 * Captcha Solver Factory
 *
 * Mendukung provider:
 *   - 2captcha  (default)
 *   - capmonster (CapMonster Cloud)
 *
 * Setiap provider mendukung:
 *   - reCAPTCHA v2
 *   - Image captcha
 */

import { CaptchaSolver } from './twocaptcha.js';
import { CapMonsterSolver } from './capmonster.js';

/**
 * Factory: buat solver berdasarkan config captcha provider.
 *
 * config.captcha:
 *   provider: '2captcha' | 'capmonster'
 *   apiKey  : string
 */
function createCaptchaSolver(captchaConfig) {
  const provider = captchaConfig.provider || '2captcha';

  switch (provider) {
    case 'capmonster':
      return new CapMonsterSolver(captchaConfig.apiKey);
    case '2captcha':
    default:
      return new CaptchaSolver(captchaConfig.apiKey);
  }
}

// Re-export classes for backward compatibility
export { CaptchaSolver, CapMonsterSolver, createCaptchaSolver };
