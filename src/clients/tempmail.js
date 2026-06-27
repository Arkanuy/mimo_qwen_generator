/**
 * Tempmail Client — Self-hosted disposable email service
 *
 * API endpoints:
 *   GET  /api/session                → { sessionId }
 *   POST /api/inboxes                → { address }  (body: { localPart } optional)
 *   GET  /api/inboxes/{addr}/messages → [ { subject, body, from_address, received_at } ]
 *
 * Auth: x-session-id header setelah session dibuat.
 * Session di-persist ke file supaya bisa di-share dengan web UI.
 */

import fetch from 'node-fetch';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSION_FILE = join(__dirname, '..', '..', 'db', 'tempmail-session.json');

class TempmailClient {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
    this.sessionId = null;
  }

  _loadSession() {
    try {
      if (existsSync(SESSION_FILE)) {
        const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
        if (data.sessionId) return data.sessionId;
      }
    } catch {}
    return null;
  }

  _saveSession(sid) {
    try {
      const dir = dirname(SESSION_FILE);
      mkdirSync(dir, { recursive: true });
      writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: sid, saved_at: new Date().toISOString() }), 'utf8');
    } catch {}
  }

  async initSession() {
    if (this.sessionId) return this.sessionId;

    // Try to reuse persisted session first
    const saved = this._loadSession();
    if (saved) {
      this.sessionId = saved;
      return this.sessionId;
    }

    const response = await fetch(`${this.apiUrl}/session`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to init session: ${response.status}`);
    }

    const data = await response.json();
    this.sessionId = data.sessionId || data.id || data.session_id;
    this._saveSession(this.sessionId);
    return this.sessionId;
  }

  async createInbox() {
    await this.initSession();

    const response = await fetch(`${this.apiUrl}/inboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': this.sessionId
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Tempmail API error: ${response.status}`);
    }

    const data = await response.json();
    return data.address;
  }

  async getMessages(address, maxWait = 180000, interval = 5000) {
    await this.initSession();
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const headers = {
        'Content-Type': 'application/json',
        'x-session-id': this.sessionId
      };

      try {
        const response = await fetch(`${this.apiUrl}/inboxes/${address}/messages`, {
          method: 'GET',
          headers: headers
        });

        if (response.ok) {
          const messages = await response.json();
          if (messages && messages.length > 0) {
            return messages;
          }
        } else {
          console.log(`  [Tempmail] Poll warning: HTTP ${response.status} ${response.statusText}`);
        }
      } catch (err) {
        console.log(`  [Tempmail] Fetch error: ${err.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('Timeout waiting for email');
  }

  extractVerificationCode(messages) {
    for (const msg of messages) {
      const subject = msg.subject || '';
      const body = msg.body || msg.text || '';
      const content = subject + ' ' + body;

      const patterns = [
        /verification code[:\s]+([0-9]{4,8})/i,
        /Your verification code is[:\s]+([0-9]{4,8})/i,
        /code[:\s]+([0-9]{4,8})/i,
        /([0-9]{6})/,
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }

    throw new Error('Could not extract verification code from emails');
  }
}

export { TempmailClient };
