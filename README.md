# MiMo & QwenCloud Auto-Registration

> 🔷 Automated account registration + API key harvester with web dashboard
>
> ✨ Supports Xiaomi MiMo Open Platform & QwenCloud (Alibaba)
>
> 🖥️ Real-time web dashboard — batch management, thread monitoring, live terminal

---

## ✨ Features

| Feature | Detail |
|---|---|
| 🌐 **Web Dashboard** | Real-time batch management with dark theme UI, login auth, public status page |
| ⚡ **Multi-threading** | Parallel browser execution (1-20 threads), live per-thread status board |
| 🔗 **Chain loop** | MiMo: auto-register in chain — each account uses previous ref code |
| ☁️ **QwenCloud** | QwenCloud account registration + API key extraction (sk-...) |
| 🎭 **Random fingerprint** | Unique browser profile per account (UA, WebGL, canvas, locale, timezone) |
| 🧩 **Smart captcha** | reCAPTCHA v2 + image captcha solving via CapMonster / 2Captcha |
| 🌐 **Multi-proxy** | Proxy pool with auto-rotation, health check, country-aware fingerprint |
| 📧 **Tempmail** | Disposable email inbox per account — auto-create, auto-poll verification codes |
| 📊 **Live Terminal** | macOS-style terminal with thread-grouped view, board view, raw log view |
| 🔐 **Auth System** | Admin login (full access) + public status page (view-only) |
| 💾 **Persistent DB** | All batch data saved to local JSON — survives server restarts |
| 📥 **Per-batch download** | Download `apiKey.txt` and `results.json` per batch anytime |

---

## 📸 Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web Browser  │────▶│  Next.js Frontend │────▶│  API Server (:3001) │
│  (Dashboard)  │     │  (Port 3000)      │     │  (server.mjs)        │
└──────────────┘     └──────────────────┘     └─────────┬───────────┘
                                                        │
                           ┌────────────────────────────┼────────────────────┐
                           │                            │                    │
                    ┌──────▼──────┐            ┌────────▼────────┐   ┌──────▼──────┐
                    │  MiMo Reg   │            │  QwenCloud Reg  │   │  Tempmail   │
                    │  (Node.js)  │            │  (Node.js)      │   │  API        │
                    └─────────────┘            └─────────────────┘   └─────────────┘
                           │                            │
                    ┌──────▼──────┐            ┌────────▼────────┐
                    │  Playwright │            │  Playwright     │
                    │  Browser    │            │  Browser        │
                    └─────────────┘            └─────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Install |
|---|---|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| Google Chrome | [google.com/chrome](https://google.com/chrome) |
| Playwright | `npx playwright install chromium` |

### 1. Clone & Install

```bash
git clone https://github.com/hirotomasato/mekithil.git
cd mekithil
npm install
cd web && npm install && cd ..
```

### 2. Configure

Edit `config/default.json`:

```json
{
  "tempmail": { "apiUrl": "https://your-tempmail-api.com/api" },
  "captcha": { "provider": "capmonster", "apiKey": "YOUR_CAPTCHA_API_KEY" },
  "xiaomi": { "inviteCode": "YOUR_SEED_CODE", "password": "YourPassword123!" },
  "browser": { "headless": true, "timeout": 60000 }
}
```

### 3. Start

**Terminal 1 — API Server:**
```bash
cd web
node server.mjs
```

**Terminal 2 — Web Dashboard:**
```bash
cd web
npm run dev
```

Open `http://localhost:3000` — login with `admin` / `mimo2024`

Public status page: `http://localhost:3000/status` (no login needed)

### 4. Environment Variables (optional)

```bash
ADMIN_USER=admin          # Admin username
ADMIN_PASS=mimo2024       # Admin password
```

---

## 🖥️ Web Dashboard

### Admin Page (`/`)
- Configure batches: generator (MiMo/QwenCloud), account count, threads, headless mode
- Start/stop/delete batches
- Live terminal with thread-grouped board view
- Download `apiKey.txt` and `results.json` per batch
- Copy individual API keys

### Public Status Page (`/status`)
- View running workers, progress, and status
- Live terminal (read-only, emails visible)
- No login required — share with anyone

### Terminal Views
- **Board View** — per-thread status cards with live task updates, progress bars, bounce animations
- **Log View** — raw log output with syntax highlighting
- Auto-grouped by thread `[T1]`, `[T2]`, etc. when running parallel

---

## 📁 Project Structure

```
mekithil/
├── config/
│   └── default.json           # Main configuration
├── src/
│   ├── core/
│   │   ├── registration.js    # MiMo registration logic
│   │   └── qwen-registration.js # QwenCloud registration logic
│   ├── browser/
│   │   ├── fingerprint.js     # Browser fingerprint generation
│   │   ├── human.js           # Human-like behavior simulation
│   │   └── proxy.js           # Proxy manager
│   ├── clients/
│   │   ├── tempmail.js        # Tempmail API client
│   │   ├── captcha.js         # Captcha solver (auto-detect)
│   │   ├── capmonster.js      # CapMonster API client
│   │   └── twocaptcha.js      # 2Captcha API client
│   └── runner/
│       └── chain-runner.js    # MiMo chain loop runner
├── web/
│   ├── server.mjs             # API server (batch management, auth, file storage)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Admin dashboard
│   │   │   ├── login/page.tsx # Login page
│   │   │   └── status/page.tsx # Public status page
│   │   ├── components/
│   │   │   └── dashboard/     # Batch table, config panel, terminals
│   │   └── lib/
│   │       └── auth.ts        # Auth helpers
│   └── next.config.ts         # Next.js config with API proxy
├── scripts/
│   └── chain-loop.js          # CLI chain runner
├── db/
│   └── batches.json           # Persistent batch database
└── output/
    └── batch-*/               # Per-batch output (apiKey.txt, results.json, batch.log)
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/login` | — | Login, returns session cookie |
| `POST` | `/api/logout` | — | Logout |
| `GET` | `/api/me` | — | Check current session |
| `GET` | `/api/batch` | Public | List all batches (admin: full, public: sanitized) |
| `POST` | `/api/batch` | Admin | Start new batch |
| `PATCH` | `/api/batch` | Admin | Stop batch |
| `DELETE` | `/api/batch` | Admin | Delete batch |
| `GET` | `/api/logs?id=` | Public | SSE stream for live logs |
| `GET` | `/api/download?id=&type=` | Admin | Download apiKey.txt or results.json |
| `GET` | `/api/stats` | Public | Global stats summary |

---

## ⚙️ Generators

### MiMo (Xiaomi)
- Registers accounts on Xiaomi MiMo Open Platform
- Chain mode: each account uses previous account's ref code
- Outputs: API keys, cookies (passToken, cUserId, userId)
- Requires: Captcha API key (CapMonster or 2Captcha)

### QwenCloud (Alibaba)
- Registers accounts on QwenCloud
- Creates API keys (sk-...) with OpenAI-compatible base URL
- Base URL: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- No captcha required

---

## 📜 License

MIT License — Copyright (c) 2026 **Arkan Savior**

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

<p align="center">
  <b>Made with ☕ by Arkanuy</b>
</p>
