/**
 * MocasusTempMail Client — Temp mail via mocasus.my.id (Supabase backend)
 *
 * Menggunakan Supabase REST API + Edge Functions langsung (tanpa browser).
 * Mendukung:
 *   - Regular inbox: random domain dari pool non-VIP
 *   - VIP Email+PW: generate email + password (butuh VIP akses)
 *   - Poll messages: query temp_messages table by inbox_address
 *   - Extract verification code dari messages
 *
 * API endpoints:
 *   POST /functions/v1/generate-inbox     → { address, owner_token, domain }
 *   POST /functions/v1/temp-mail-vip      → { action: "generate_with_password" }
 *   GET  /rest/v1/temp_messages?inbox_address=eq.{addr}
 *   GET  /rest/v1/temp_domains?is_active=eq.true
 */

import fetch from 'node-fetch';
import { randomUUID, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = 'https://ijrccpgiulrmfpavazsl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc';

// Path ke session file (hasil login browser)
const SESSION_FILE = join(__dirname, '..', '..', 'db', 'mocasus-session.json');

class MocasusTempMail {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || SUPABASE_URL;
    this.anonKey = options.anonKey || SUPABASE_ANON_KEY;
    this.ownerToken = options.ownerToken || this._loadOwnerToken() || this._generateOwnerToken();
    this.domains = [];
    this._headers = {
      'Authorization': `Bearer ${this.anonKey}`,
      'apikey': this.anonKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Load owner_token dari session file (hasil login browser).
   */
  _loadOwnerToken() {
    try {
      if (existsSync(SESSION_FILE)) {
        const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
        if (data.ownerToken) return data.ownerToken;
      }
    } catch {}
    return null;
  }

  /**
   * Generate owner_token format: UUID + 28 hex chars
   */
  _generateOwnerToken() {
    const uuid = randomUUID();
    const extra = randomBytes(14).toString('hex');
    return `${uuid}${extra}`;
  }

  /**
   * Fetch available non-VIP domains from Supabase.
   */
  async _fetchDomains() {
    if (this.domains.length > 0) return this.domains;

    const url = `${this.supabaseUrl}/rest/v1/temp_domains?select=domain,label,vip_only&is_active=eq.true&order=sort_order.asc`;
    const res = await fetch(url, { headers: this._headers });

    if (!res.ok) {
      throw new Error(`Failed to fetch domains: ${res.status}`);
    }

    const all = await res.json();
    this.domains = all.filter(d => !d.vip_only).map(d => d.domain);

    if (this.domains.length === 0) {
      throw new Error('No non-VIP domains available');
    }

    return this.domains;
  }

  async _pickRandomDomain() {
    const domains = await this._fetchDomains();
    return domains[Math.floor(Math.random() * domains.length)];
  }

  /**
   * Create a new temp inbox (regular, non-VIP).
   */
  async createInbox(desiredLocal = null, domain = null) {
    const targetDomain = domain || await this._pickRandomDomain();

    const body = {
      owner_token: this.ownerToken,
      desired_local: desiredLocal,
      domain: targetDomain,
    };

    const res = await fetch(`${this.supabaseUrl}/functions/v1/generate-inbox`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`generate-inbox failed: ${res.status} ${errText}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(`generate-inbox error: ${data.error}`);
    }

    if (data.owner_token) {
      this.ownerToken = data.owner_token;
    }

    return data.address;
  }

  /**
   * Generate email + password (VIP feature).
   * Falls back to regular inbox + random password if not VIP.
   */
  async generateEmailWithPassword() {
    const res = await fetch(`${this.supabaseUrl}/functions/v1/temp-mail-vip`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify({
        action: 'generate_with_password',
        owner_token: this.ownerToken,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (!data.error && data.address) {
        if (data.owner_token) {
          this.ownerToken = data.owner_token;
        }
        return {
          email: data.address,
          password: data.password || this._randomPassword(),
        };
      }
    }

    // Fallback: regular inbox + random password
    const email = await this.createInbox();
    return {
      email,
      password: this._randomPassword(),
    };
  }

  _randomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const bytes = randomBytes(14);
    let pw = '';
    for (let i = 0; i < 14; i++) {
      pw += chars[bytes[i] % chars.length];
    }
    return pw;
  }

  /**
   * Poll for messages sent to an inbox address.
   */
  async getMessages(address, maxWait = 180000, interval = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const url = `${this.supabaseUrl}/rest/v1/temp_messages?select=*&inbox_address=eq.${encodeURIComponent(address)}&order=received_at.desc`;
        const res = await fetch(url, { headers: this._headers });

        if (res.ok) {
          const messages = await res.json();
          if (messages && messages.length > 0) {
            return messages.map(m => ({
              subject: m.subject || '',
              body: m.text_body || '',
              html: m.html_body || '',
              from_address: m.from_address || '',
              from_name: m.from_name || '',
              received_at: m.received_at,
            }));
          }
        } else {
          console.log(`  [MocasusTempMail] Poll warning: HTTP ${res.status}`);
        }
      } catch (err) {
        console.log(`  [MocasusTempMail] Fetch error: ${err.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('Timeout waiting for email');
  }

  /**
   * Extract verification code from messages.
   */
  extractVerificationCode(messages) {
    for (const msg of messages) {
      const subject = msg.subject || '';
      const body = msg.body || msg.html || '';
      const content = subject + ' ' + body;

      const patterns = [
        /verification code[:\s]+([0-9]{4,8})/i,
        /Your verification code is[:\s]+([0-9]{4,8})/i,
        /code[:\s]+([0-9]{4,8})/i,
        /OTP[:\s]+([0-9]{4,8})/i,
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

  /**
   * Check VIP status for current owner_token.
   */
  /**
   * Get OTP/verification code untuk email tertentu.
   * Combines getMessages + extractVerificationCode.
   */
  async getOtp(address, maxWait = 180000, interval = 5000) {
    const messages = await this.getMessages(address, maxWait, interval);
    return this.extractVerificationCode(messages);
  }

    async checkVipStatus() {
    const res = await fetch(`${this.supabaseUrl}/functions/v1/temp-mail-vip`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify({
        action: 'status',
        owner_token: this.ownerToken,
      }),
    });

    if (!res.ok) {
      throw new Error(`VIP status check failed: ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Bulk generate inboxes (VIP feature).
   */
  async bulkGenerate(count, withPassword = false) {
    const res = await fetch(`${this.supabaseUrl}/functions/v1/temp-mail-vip`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify({
        action: 'bulk_generate',
        owner_token: this.ownerToken,
        count,
        with_password: withPassword,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`bulk_generate failed: ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`bulk_generate error: ${data.error}`);
    }

    return data;
  }
}

// Backward-compatible alias
class TempmailClient extends MocasusTempMail {
  constructor(apiUrl) {
    super();
  }

  async initSession() {
    return this.ownerToken;
  }
}

export { MocasusTempMail, TempmailClient };
