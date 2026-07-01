#!/usr/bin/env node
/**
 * Mocasus Temp Mail API Server
 *
 * HTTP API untuk generate email, get messages, dan extract OTP.
 * Menggunakan Supabase REST API + owner_token dari session.
 *
 * Endpoints:
 *   GET  /api/email              → Generate email (random domain)
 *   GET  /api/email?vip=true     → Generate email+password (VIP, browser)
 *   GET  /api/otp/{addr}         → Get OTP/verification code
 *   GET  /api/messages/{addr}    → Get raw messages
 *   GET  /api/status             → Health check
 *
 * Query params:
 *   ?domain=moymoy.me  → Pakai domain tertentu
 *   ?wait=180          → Max wait detik (default 180)
 *   ?interval=5        → Poll interval detik (default 5)
 */

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MocasusTempMail } from '../clients/mocasus-tempmail.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config
let config = {};
try {
  config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config', 'default.json'), 'utf8'));
} catch {}

const PORT = process.env.MOCASUS_PORT || 3030;
const mail = new MocasusTempMail({
  supabaseUrl: config.tempmail?.supabaseUrl,
  anonKey: config.tempmail?.anonKey,
  ownerToken: config.tempmail?.ownerToken,
});

function parseUrl(url) {
  const [path, qs] = url.split('?');
  const params = {};
  if (qs) for (const p of qs.split('&')) { const [k, v] = p.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return { path, params };
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const { path, params } = parseUrl(req.url);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }

  try {
    // ── GET /api/email ──
    if (path === '/api/email') {
      const domain = params.domain || null;
      const result = domain
        ? { email: await mail.createInbox(null, domain), password: null }
        : await mail.generateEmailWithPassword();
      return send(res, 200, { ok: true, email: result.email, password: result.password });
    }

    // ── GET /api/otp/{addr} ──
    if (path.startsWith('/api/otp/')) {
      const addr = decodeURIComponent(path.replace('/api/otp/', ''));
      if (!addr) return send(res, 400, { ok: false, error: 'address required' });
      const maxWait = (parseInt(params.wait) || 180) * 1000;
      const interval = (parseInt(params.interval) || 5) * 1000;
      const otp = await mail.getOtp(addr, maxWait, interval);
      return send(res, 200, { ok: true, email: addr, otp });
    }

    // ── GET /api/messages/{addr} ──
    if (path.startsWith('/api/messages/')) {
      const addr = decodeURIComponent(path.replace('/api/messages/', ''));
      if (!addr) return send(res, 400, { ok: false, error: 'address required' });
      const maxWait = (parseInt(params.wait) || 180) * 1000;
      const interval = (parseInt(params.interval) || 5) * 1000;
      const messages = await mail.getMessages(addr, maxWait, interval);
      return send(res, 200, { ok: true, count: messages.length, messages });
    }

    // ── GET /api/status ──
    if (path === '/api/status') {
      return send(res, 200, { ok: true, ownerToken: mail.ownerToken?.substring(0, 20) + '...' });
    }

    send(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error(`[API] Error: ${err.message}`);
    send(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log('═'.repeat(50));
  console.log('  Mocasus Temp Mail API Server');
  console.log('═'.repeat(50));
  console.log(`\n✅ API running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/email              → Generate email`);
  console.log(`  GET  /api/email?vip=true     → Generate email+password (VIP)`);
  console.log(`  GET  /api/otp/{email}        → Get OTP code`);
  console.log(`  GET  /api/messages/{email}   → Get raw messages`);
  console.log(`  GET  /api/status             → Health check`);
  console.log(`\nPress Ctrl+C to stop.`);
});

process.on('SIGINT', () => process.exit(0));
