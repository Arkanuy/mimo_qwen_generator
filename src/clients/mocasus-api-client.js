/**
 * Mocasus API Client — Wrapper untuk mocasus-api.js HTTP server.
 *
 * Dipakai oleh registration.js / mimo-api-registration.js
 * supaya tidak perlu akses Supabase langsung.
 *
 * Pastikan mocasus-api.js sudah jalan di port 3030 (atau custom).
 */

import fetch from 'node-fetch';

const DEFAULT_BASE = 'http://localhost:3030';

class MocasusApiClient {
  constructor(baseUrl = DEFAULT_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async _get(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }

  /**
   * Generate email + password.
   * Compatible interface with old TempmailClient.createInbox()
   */
  async createInbox() {
    const data = await this._get('/api/email');
    this._lastEmail = data.email;
    this._lastPassword = data.password;
    return data.email;
  }

  /**
   * Generate email + password (returns both).
   */
  async generateEmailWithPassword() {
    const data = await this._get('/api/email');
    return { email: data.email, password: data.password };
  }

  /**
   * Get messages for an address.
   */
  async getMessages(address, maxWait = 180000, interval = 5000) {
    const data = await this._get(`/api/messages/${encodeURIComponent(address)}`, {
      wait: Math.floor(maxWait / 1000),
      interval: Math.floor(interval / 1000),
    });
    return data.messages;
  }

  /**
   * Get OTP for an address.
   */
  async getOtp(address, maxWait = 180000, interval = 5000) {
    const data = await this._get(`/api/otp/${encodeURIComponent(address)}`, {
      wait: Math.floor(maxWait / 1000),
      interval: Math.floor(interval / 1000),
    });
    return data.otp;
  }

  /**
   * Extract verification code from messages.
   * Compatible interface with old TempmailClient.extractVerificationCode()
   */
  extractVerificationCode(messages) {
    for (const msg of messages) {
      const content = `${msg.subject || ''} ${msg.body || ''} ${msg.html || ''}`;
      const patterns = [
        /verification code[:\s]+([0-9]{4,8})/i,
        /Your verification code is[:\s]+([0-9]{4,8})/i,
        /code[:\s]+([0-9]{4,8})/i,
        /OTP[:\s]+([0-9]{4,8})/i,
        /([0-9]{6})/,
      ];
      for (const p of patterns) {
        const m = content.match(p);
        if (m) return m[1];
      }
    }
    throw new Error('Could not extract verification code from emails');
  }

  async initSession() {
    // No-op for compatibility
    return 'mocasus-api';
  }
}

export { MocasusApiClient };
