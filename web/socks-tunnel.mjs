/**
 * Minimal SOCKS5 local tunnel — bridges unauthenticated local SOCKS5
 * to an authenticated remote SOCKS5 proxy. No external dependencies.
 *
 * Usage: startTunnel({ server: "socks5://host:port", username: "u", password: "p" })
 *   → returns { port, close() }
 */
import net from 'net';

const SOCKS5 = 0x05;
const AUTH_NONE = 0x00;
const AUTH_USERPASS = 0x02;

function parseSocksAddr(buf, offset) {
  const atyp = buf[offset];
  if (atyp === 0x01) return { host: `${buf[offset+1]}.${buf[offset+2]}.${buf[offset+3]}.${buf[offset+4]}`, port: buf.readUInt16BE(offset+5), len: 7 };
  if (atyp === 0x03) { const dlen = buf[offset+1]; return { host: buf.toString('utf8', offset+2, offset+2+dlen), port: buf.readUInt16BE(offset+2+dlen), len: 2 + dlen + 2 }; }
  if (atyp === 0x04) { const h = []; for (let i = 0; i < 8; i++) h.push(buf.readUInt16BE(offset+1+i*2).toString(16)); return { host: h.join(':'), port: buf.readUInt16BE(offset+17), len: 19 }; }
  return null;
}

function connectRemote(remoteHost, remotePort, targetHost, targetPort, username, password) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(remotePort, remoteHost, () => {
      // Send SOCKS5 greeting: support AUTH_USERPASS
      sock.write(Buffer.from([SOCKS5, 0x02, AUTH_NONE, AUTH_USERPASS]));
    });
    sock.on('error', reject);
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    sock.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === AUTH_USERPASS) {
          stage = 'auth';
          const userBuf = Buffer.from(username, 'utf8');
          const passBuf = Buffer.from(password, 'utf8');
          const authReq = Buffer.alloc(3 + userBuf.length + passBuf.length);
          authReq[0] = 0x01; // version
          authReq[1] = userBuf.length;
          userBuf.copy(authReq, 2);
          authReq[2 + userBuf.length] = passBuf.length;
          passBuf.copy(authReq, 3 + userBuf.length);
          sock.write(authReq);
        } else if (method === AUTH_NONE) {
          stage = 'connect';
          sendConnect();
        } else {
          sock.destroy(); reject(new Error(`Remote SOCKS5 unsupported auth method: ${method}`));
        }
      } else if (stage === 'auth') {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) { sock.destroy(); reject(new Error('SOCKS5 auth failed')); return; }
        buf = buf.subarray(2);
        stage = 'connect';
        sendConnect();
      } else if (stage === 'connect') {
        if (buf.length < 4) return;
        const atyp = buf[3];
        let headerLen = 4;
        if (atyp === 0x01) headerLen += 4 + 2;
        else if (atyp === 0x03) headerLen += 1 + buf[4] + 2;
        else if (atyp === 0x04) headerLen += 16 + 2;
        if (buf.length < headerLen) return;
        if (buf[1] !== 0x00) { sock.destroy(); reject(new Error(`SOCKS5 connect failed: ${buf[1]}`)); return; }
        buf = buf.subarray(headerLen);
        stage = 'pipe';
        resolve({ sock, leftover: buf });
      }
    });
    function sendConnect() {
      const hostBuf = Buffer.from(targetHost, 'utf8');
      const req = Buffer.alloc(7 + hostBuf.length);
      req[0] = SOCKS5; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
      req[4] = hostBuf.length;
      hostBuf.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + hostBuf.length);
      sock.write(req);
    }
  });
}

export function startTunnel(proxyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(proxyObj.server);
    const remoteHost = url.hostname;
    const remotePort = parseInt(url.port, 10);
    const { username, password } = proxyObj;

    const server = net.createServer((clientSock) => {
      let buf = Buffer.alloc(0);
      let stage = 'greeting';

      clientSock.on('data', async (data) => {
        if (stage === 'pipe') return; // already piping, ignore
        buf = Buffer.concat([buf, data]);

        if (stage === 'greeting') {
          if (buf.length < 3) return;
          // Reply: no auth required locally
          clientSock.write(Buffer.from([SOCKS5, AUTH_NONE]));
          buf = buf.subarray(2);
          stage = 'request';
        } else if (stage === 'request') {
          if (buf.length < 7) return;
          const target = parseSocksAddr(buf, 3);
          if (!target) { clientSock.destroy(); return; }
          const headerLen = 4 + target.len;
          if (buf.length < headerLen) return;
          const leftover = buf.subarray(headerLen);
          stage = 'pipe';

          try {
            const { sock: remoteSock, leftover: remoteLeftover } = await connectRemote(
              remoteHost, remotePort, target.host, target.port, username, password
            );
            // Send success reply to local client
            const reply = Buffer.from([SOCKS5, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
            clientSock.write(reply);

            // Pipe data both ways
            if (leftover.length > 0) remoteSock.write(leftover);
            if (remoteLeftover.length > 0) clientSock.write(remoteLeftover);
            clientSock.pipe(remoteSock);
            remoteSock.pipe(clientSock);
            remoteSock.on('close', () => clientSock.destroy());
            clientSock.on('close', () => remoteSock.destroy());
            remoteSock.on('error', () => clientSock.destroy());
          } catch (e) {
            // Send failure reply
            const reply = Buffer.from([SOCKS5, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
            clientSock.write(reply);
            clientSock.destroy();
          }
        }
      });
      clientSock.on('error', () => {});
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ port, close: () => { try { server.close(); } catch {} } });
    });
    server.on('error', reject);
  });
}
