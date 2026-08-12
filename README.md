# 🎮 ScamLine — Social Deception Web Game

> A web-based clone of **Scam Line** (Steam) with voice chat, lobby system, and 15 rotating mini-games.

## 🏗️ Project Structure

```
Scamline/
├── server/          ← Node.js + Socket.io backend (deploy to Render)
│   ├── index.js     ← Game server, all game logic, WebRTC signaling
│   ├── package.json
│   └── render.yaml  ← Render deployment config
└── client/          ← Vanilla HTML/CSS/JS frontend (deploy to Render Static / Vercel / GitHub Pages)
    ├── index.html
    ├── style.css
    └── app.js
```

## 🎯 Features

- **Lobby System** — Create/join rooms with 6-char codes, host controls, kick players, ready system
- **15 Mini-Games** (12 rounds per match, randomly rotated from your selection):
  1. 🚪 Room Numbers
  2. 💣 Bomb Defusal
  3. ⚖️ Prisoner's Dilemma
  4. 🔍 Odd One Out
  5. 🤫 Secret Word
  6. 🔥 Hot Seat
  7. 📞 Chain Lie
  8. 🕵️ Spy Hunt
  9. 📰 Fake News
  10. 🤝 Trust Fall
  11. 🏷️ Blind Auction
  12. 🎨 Color Grid
  13. 🔑 Password
  14. 🔎 Alibi
  15. 🧠 Consensus
- **Voice Chat** — WebRTC P2P audio calls via Socket.io signaling
- **Text Chat** — Global lobby chat
- **Scoring + Podium** — Points per round, final leaderboard

## 🚀 Deployment

### Step 1: Deploy the Server to Render

1. Push the `server/` folder to a GitHub repository
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Root directory:** `server`
   - **Build command:** `npm install`
   - **Start command:** `node index.js`
   - **Environment:** Node
5. Deploy — note your URL (e.g. `https://scamline-server.onrender.com`)

### Step 2: Update the Client URL

In `client/app.js`, find this line and update with your Render URL:

```js
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://scamline-server.onrender.com'; // ← UPDATE THIS
```

### Step 3: Deploy the Client

**Option A — Render Static Site:**
1. New → Static Site → connect repo
2. Root: `client`, Build: (none), Publish: `client`

**Option B — GitHub Pages:**
1. Push `client/` to `gh-pages` branch or configure Pages to serve `/client`

**Option C — Local dev:**
```bash
# Terminal 1: Start server
cd server && npm install && npm run dev

# Terminal 2: Serve client
cd client && npx serve .
# Open http://localhost:3000
```

## 🎮 How to Play

1. Open the game URL in your browser
2. Enter your name → **Create Lobby** or **Join** with a code
3. Host selects which games to include (all 15 by default)
4. Players mark ready → Host clicks **Start**
5. Each round: a random game loads with ~60-120s timer
6. **Click 📞 to voice-call any player** — talk strategy, lie, deceive!
7. Complete game objectives, earn points
8. After 12 rounds, the leaderboard reveals the winner

## 🔧 Local Development

```bash
cd server
npm install
npm run dev   # nodemon auto-restarts
```

Then open `client/index.html` directly, or serve with:
```bash
cd client && npx serve .
```

## ⚠️ Notes

- **Render free tier** spins down after 15min idle — first connection may take ~30s to wake
- **WebRTC** requires HTTPS in production (Render provides this automatically)
- Voice chat is **peer-to-peer** (direct between browsers) — server only handles signaling
- Max **8 players** per lobby
