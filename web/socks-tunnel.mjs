/**
 * SOCKS5 local tunnel using gost binary.
 * Bridges unauthenticated local SOCKS5 to an authenticated remote SOCKS5 proxy.
 *
 * Usage: startTunnel({ server: "socks5://host:port", username: "u", password: "p" })
 *   → returns Promise<{ port, close() }>
 */
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOST_BIN = process.platform === 'win32'
  ? join(__dirname, '..', 'gost.exe')
  : join(__dirname, '..', 'gost');

if (!existsSync(GOST_BIN)) {
  console.error(`[gost] Binary not found at ${GOST_BIN} — tunnel will not work`);
}

/**
 * Find a free TCP port on 127.0.0.1.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Spawn gost as a local SOCKS5 proxy forwarding to an authenticated remote SOCKS5.
 * @param {object} proxyObj - { server: "socks5://host:port", username, password }
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startTunnel(proxyObj) {
  const url = new URL(proxyObj.server);
  const remoteHost = url.hostname;
  const remotePort = url.port;
  const { username, password } = proxyObj;

  const localPort = await getFreePort();

  // Build remote forward URL: socks5://user:pass@host:port
  let remoteUrl;
  if (username && password) {
    remoteUrl = `socks5://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${remoteHost}:${remotePort}`;
  } else {
    remoteUrl = `socks5://${remoteHost}:${remotePort}`;
  }

  const args = [
    `-L`, `socks5://127.0.0.1:${localPort}`,
    `-F`, remoteUrl,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(GOST_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });

    let resolved = false;
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('error') || text.includes('fatal')) {
        stderr += text;
      }
    });

    // Wait for gost to start listening, then resolve
    const readyTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({
          port: localPort,
          close: () => {
            try { proc.kill('SIGTERM'); } catch {}
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 500);
          },
        });
      }
    }, 600);

    proc.on('error', (err) => {
      clearTimeout(readyTimer);
      if (!resolved) {
        resolved = true;
        reject(new Error(`gost spawn error: ${err.message}`));
      }
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(readyTimer);
      if (!resolved) {
        resolved = true;
        reject(new Error(`gost exited early (code=${code}, signal=${signal}): ${stderr.substring(0, 300)}`));
      }
    });
  });
}
