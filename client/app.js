/* ═══════════════════════════════════════════════════════════════════
   SCAMLINE — Main Application Logic
   WebSocket: Socket.io
   Voice: WebRTC (native) with Socket.io signaling
   ═══════════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://scamline.onrender.com';

const GAMES_LIST = [
  { id: 'room_numbers',      name: 'Room Numbers',      icon: '🚪', desc: 'Guess your neighbors\' room numbers.' },
  { id: 'bomb_defusal',      name: 'Bomb Defusal',      icon: '💣', desc: 'Share fragments to defuse the bomb.' },
  { id: 'prisoners_dilemma', name: 'Prisoner\'s Dilemma',icon: '⚖️', desc: 'Cooperate or betray?' },
  { id: 'odd_one_out',       name: 'Odd One Out',        icon: '🔍', desc: 'Find the player with a different attribute.' },
  { id: 'secret_word',       name: 'Secret Word',        icon: '🤫', desc: 'Find the imposter with a different word.' },
  { id: 'hot_seat',          name: 'Hot Seat',           icon: '🔥', desc: 'Truth or lie? You decide.' },
  { id: 'chain_lie',         name: 'Chain Lie',          icon: '📞', desc: 'Distort the message down the chain.' },
  { id: 'spy_hunt',          name: 'Spy Hunt',           icon: '🕵️', desc: 'Unmask the spy through interrogation.' },
  { id: 'fake_news',         name: 'Fake News',          icon: '📰', desc: 'Detect who received the fake fact.' },
  { id: 'trust_fall',        name: 'Trust Fall',         icon: '🤝', desc: 'Complete a task together remotely.' },
  { id: 'auction',           name: 'Blind Auction',      icon: '🏷️', desc: 'Bid on items with bluffed info.' },
  { id: 'color_grid',        name: 'Color Grid',         icon: '🎨', desc: 'Reconstruct the grid via calls.' },
  { id: 'password_game',     name: 'Password',           icon: '🔑', desc: 'One-word clues to guess the password.' },
  { id: 'alibi',             name: 'Alibi',              icon: '🔎', desc: 'Crack the suspect\'s alibi.' },
  { id: 'consensus',         name: 'Consensus',          icon: '🧠', desc: 'Coordinate to all give the same answer.' }
];

// ─── State ────────────────────────────────────────────────────────────────────
let socket = null;
let myId = null;
let myName = '';
let lobby = null;
let isHost = false;
let selectedGames = new Set(GAMES_LIST.map(g => g.id));
let currentGame = null;
let privateData = null;
let timerInterval = null;
let timerEnd = 0;

// WebRTC state
let localStream = null;
let peerConnections = {}; // peerId -> RTCPeerConnection
let activeCallId = null;  // currently active call peer ID
let pendingCallFrom = null;
let isMuted = false;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// ─── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function toast(msg, type = 'info', icon = 'ℹ️') {
  const t = el('div', `toast ${type}`, `<span>${icon}</span> ${msg}`);
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showModal(title, body, confirmText, onConfirm, cancelText) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body;
  const actions = $('modal-actions');
  actions.innerHTML = '';
  if (cancelText) {
    const c = el('button', 'btn-modal-cancel', cancelText);
    c.onclick = () => $('modal-overlay').classList.add('hidden');
    actions.appendChild(c);
  }
  if (confirmText) {
    const b = el('button', 'btn-modal-confirm', confirmText);
    b.onclick = () => { $('modal-overlay').classList.add('hidden'); onConfirm?.(); };
    actions.appendChild(b);
  }
  $('modal-overlay').classList.remove('hidden');
}

// ─── Landing Screen ───────────────────────────────────────────────────────────
function renderLanding() {
  const screen = $('screen-landing');
  screen.innerHTML = `
    <div class="landing-hero">
      <div class="landing-badge">🎭 Social Deception Game</div>
      <h1 class="landing-title">
        <span class="word-scam">SCAM</span>
        <span class="word-line">LINE</span>
      </h1>
      <p class="landing-subtitle">
        Isolated rooms. One phone. Lie, manipulate, survive. 
        15 mini-games across 12 brutal rounds.
      </p>
    </div>
    <div class="landing-card">
      <div class="input-group">
        <label class="input-label">Your Name</label>
        <input id="inp-name" class="input-field" placeholder="Enter your alias..." maxlength="16" autocomplete="off" />
      </div>
      <button id="btn-create" class="btn-primary mb-8">🎮 Create Lobby</button>
      <div class="divider">or join existing</div>
      <div class="input-group">
        <input id="inp-code" class="input-field" placeholder="Room code (e.g. ABC123)" maxlength="6" autocomplete="off" style="text-transform:uppercase;font-family:'JetBrains Mono',monospace;letter-spacing:0.1em" />
      </div>
      <button id="btn-join" class="btn-secondary">🚪 Join Lobby</button>
    </div>
    <div class="landing-features">
      <div class="feature-item">
        <div class="feature-icon">🎙️</div>
        <span>Voice Chat</span>
      </div>
      <div class="feature-item">
        <div class="feature-icon">🎮</div>
        <span>15 Games</span>
      </div>
      <div class="feature-item">
        <div class="feature-icon">👥</div>
        <span>Up to 8</span>
      </div>
      <div class="feature-item">
        <div class="feature-icon">🏆</div>
        <span>12 Rounds</span>
      </div>
    </div>
  `;

  const nameInp = $('inp-name');
  const codeInp = $('inp-code');

  nameInp.addEventListener('keydown', e => e.key === 'Enter' && createLobby());
  codeInp.addEventListener('keydown', e => e.key === 'Enter' && joinLobby());
  codeInp.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

  $('btn-create').onclick = createLobby;
  $('btn-join').onclick = joinLobby;

  function createLobby() {
    const name = nameInp.value.trim() || 'Anonymous';
    myName = name;
    connectSocket(() => socket.emit('lobby:create', { name }));
  }

  function joinLobby() {
    const name = nameInp.value.trim() || 'Anonymous';
    const code = codeInp.value.trim();
    if (!code || code.length !== 6) { toast('Enter a 6-character room code', 'error', '❌'); return; }
    myName = name;
    connectSocket(() => socket.emit('lobby:join', { code, name }));
  }
}

// ─── Socket Connection ────────────────────────────────────────────────────────
function connectSocket(onReady) {
  if (socket?.connected) { onReady(); return; }
  socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    myId = socket.id;
    toast('Connected to server', 'success', '✅');
    onReady();
  });

  socket.on('connect_error', () => toast('Could not connect to server', 'error', '❌'));

  socket.on('error', ({ msg }) => toast(msg, 'error', '❌'));

  socket.on('lobby:created', ({ code, lobby: l }) => {
    lobby = l;
    isHost = true;
    renderLobby();
  });

  socket.on('lobby:joined', ({ lobby: l }) => {
    lobby = l;
    isHost = lobby.players.find(p => p.id === myId)?.isHost || false;
    renderLobby();
  });

  socket.on('lobby:update', (l) => {
    lobby = l;
    isHost = lobby.players.find(p => p.id === myId)?.isHost || false;
    updateLobbyUI();
  });

  socket.on('game:start', (data) => {
    currentGame = data;
    privateData = null;
    renderGame(data);
    startTimer(data.gameData.duration);
  });

  socket.on('game:private_data', (data) => {
    privateData = data;
    injectPrivateData(data);
  });

  socket.on('game:state_update', (data) => {
    updateGameStateUI(data);
  });

  socket.on('game:results', (data) => {
    clearInterval(timerInterval);
    showRoundResults(data);
  });

  socket.on('match:end', (data) => {
    clearInterval(timerInterval);
    renderEndScreen(data);
  });

  socket.on('chat:message', (msg) => {
    appendChat(msg);
  });

  socket.on('kicked', () => {
    toast('You were kicked from the lobby', 'error', '👢');
    lobby = null;
    showScreen('screen-landing');
  });

  socket.on('chain_lie:receive', ({ message }) => {
    handleChainLieReceive(message);
  });

  // WebRTC signaling
  socket.on('webrtc:call_request', ({ fromId }) => {
    const player = lobby?.players.find(p => p.id === fromId);
    if (!player) return;
    pendingCallFrom = fromId;
    showCallNotification(player);
  });

  socket.on('webrtc:offer', async ({ fromId, offer }) => {
    await handleOffer(fromId, offer);
  });

  socket.on('webrtc:answer', async ({ fromId, answer }) => {
    const pc = peerConnections[fromId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('webrtc:ice_candidate', async ({ fromId, candidate }) => {
    const pc = peerConnections[fromId];
    if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });

  socket.on('webrtc:call_end', ({ fromId }) => {
    endCall(fromId);
    if (fromId === activeCallId) {
      toast('Call ended', 'info', '📵');
      $('call-hud').classList.add('hidden');
      activeCallId = null;
    }
  });

  socket.on('disconnect', () => {
    toast('Disconnected from server', 'error', '⚠️');
  });
}

// ─── Lobby Screen ─────────────────────────────────────────────────────────────
function renderLobby() {
  showScreen('screen-lobby');
  const screen = $('screen-lobby');
  screen.innerHTML = `
    <div class="lobby-layout">
      <div class="lobby-header">
        <div class="lobby-code-display">
          <div class="lobby-code-label">Room Code</div>
          <div class="lobby-code" id="lobby-code" title="Click to copy">${lobby.code}</div>
          <button class="btn-ghost" id="btn-copy-code">📋 Copy</button>
        </div>
        <div style="display:flex;gap:10px">
          <div style="font-size:13px;color:var(--text-dim);padding:8px">
            <span id="lobby-player-count">${lobby.players.length}</span>/8 players
          </div>
          <button class="btn-ghost" id="btn-leave">← Leave</button>
        </div>
      </div>

      <div class="lobby-main">
        <!-- Players -->
        <div class="panel">
          <div class="panel-title">👥 Players</div>
          <div class="players-grid" id="players-grid"></div>
        </div>

        <!-- Game Selection (host only) -->
        ${isHost ? `
        <div class="panel" id="panel-games">
          <div class="panel-title" style="justify-content:space-between">
            <span>🎮 Select Games (${selectedGames.size} selected)</span>
            <div style="display:flex;gap:8px">
              <button class="btn-ghost" id="btn-select-all" style="font-size:12px">Select All</button>
              <button class="btn-ghost" id="btn-clear-all" style="font-size:12px">Clear</button>
            </div>
          </div>
          <div class="games-scroll" id="games-scroll"></div>
        </div>
        ` : '<div class="panel"><div class="panel-title">🎮 Waiting for host to configure the game...</div></div>'}
      </div>

      <div class="lobby-side">
        <!-- Chat -->
        <div class="panel" style="flex:1">
          <div class="panel-title">💬 Chat</div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-row">
            <input id="chat-input" class="chat-input" placeholder="Type a message..." maxlength="100" />
            <button id="btn-chat-send" class="btn-send">➤</button>
          </div>
        </div>

        <!-- Actions -->
        <div class="panel lobby-actions">
          ${isHost
            ? `<button id="btn-start" class="btn-start" ${lobby.players.length < 2 ? 'disabled' : ''}>🚀 Start Game</button>`
            : `<button id="btn-ready" class="btn-ready ${lobby.players.find(p=>p.id===myId)?.ready ? 'active' : ''}">
                ${lobby.players.find(p=>p.id===myId)?.ready ? '✅ Ready!' : '👍 Mark Ready'}
               </button>`
          }
          <div style="font-size:12px;color:var(--text-muted);text-align:center">
            ${isHost ? 'As host, select games and start when ready' : 'Wait for host to start the game'}
          </div>
        </div>
      </div>
    </div>
  `;

  // Events
  $('lobby-code').onclick = copyCode;
  $('btn-copy-code').onclick = copyCode;
  $('btn-leave').onclick = () => showModal('Leave Lobby', 'Are you sure you want to leave?', 'Leave', () => {
    socket.disconnect();
    lobby = null;
    showScreen('screen-landing');
  }, 'Stay');

  if (isHost) {
    renderGameChips();
    $('btn-start').onclick = startGame;
    $('btn-select-all').onclick = () => { selectedGames = new Set(GAMES_LIST.map(g => g.id)); renderGameChips(); };
    $('btn-clear-all').onclick = () => { selectedGames.clear(); renderGameChips(); };
  } else {
    $('btn-ready').onclick = () => socket.emit('lobby:ready');
  }

  $('btn-chat-send').onclick = sendChat;
  $('chat-input').addEventListener('keydown', e => e.key === 'Enter' && sendChat());

  updatePlayersGrid();
}

function updateLobbyUI() {
  if ($('screen-lobby').classList.contains('active')) {
    updatePlayersGrid();
    const count = $('lobby-player-count');
    if (count) count.textContent = lobby.players.length;

    // Update start button
    const startBtn = $('btn-start');
    if (startBtn) startBtn.disabled = lobby.players.length < 2;

    // Update ready button
    const readyBtn = $('btn-ready');
    if (readyBtn) {
      const me = lobby.players.find(p => p.id === myId);
      readyBtn.className = `btn-ready ${me?.ready ? 'active' : ''}`;
      readyBtn.textContent = me?.ready ? '✅ Ready!' : '👍 Mark Ready';
    }

    // Update selected games count label if host
    if (isHost) {
      const panelTitle = document.querySelector('#panel-games .panel-title span');
      if (panelTitle) panelTitle.textContent = `🎮 Select Games (${selectedGames.size} selected)`;
    }
  }
}

function updatePlayersGrid() {
  const grid = $('players-grid');
  if (!grid) return;
  grid.innerHTML = '';

  lobby.players.forEach(player => {
    const card = el('div', `player-card ${player.ready ? 'ready' : ''} ${player.isHost ? 'host-card' : ''}`);
    card.innerHTML = `
      <div class="player-avatar">${player.avatar}</div>
      <div class="player-name">${escHtml(player.name)}</div>
      <div class="flex gap-8">
        <span class="player-badge ${player.isHost ? 'badge-host' : (player.ready ? 'badge-ready' : 'badge-waiting')}">
          ${player.isHost ? '👑 Host' : (player.ready ? '✓ Ready' : 'Waiting')}
        </span>
      </div>
      <div class="player-score">Score: ${player.score}</div>
      ${isHost && player.id !== myId ? `<button class="btn-ghost" style="font-size:11px;color:var(--danger)" data-kick="${player.id}">Kick</button>` : ''}
    `;
    grid.appendChild(card);
  });

  // Add empty slots
  const remaining = 8 - lobby.players.length;
  for (let i = 0; i < Math.min(remaining, 3); i++) {
    const slot = el('div', 'player-slot', `<span>Waiting for player...</span>`);
    grid.appendChild(slot);
  }

  // Kick buttons
  grid.querySelectorAll('[data-kick]').forEach(btn => {
    btn.onclick = () => {
      const target = lobby.players.find(p => p.id === btn.dataset.kick);
      if (target) showModal(`Kick ${target.name}?`, 'This will remove the player from the lobby.', 'Kick', () => {
        socket.emit('lobby:kick', { targetId: btn.dataset.kick });
      }, 'Cancel');
    };
  });
}

function renderGameChips() {
  const scroll = $('games-scroll');
  if (!scroll) return;
  scroll.innerHTML = '';
  GAMES_LIST.forEach(game => {
    const sel = selectedGames.has(game.id);
    const chip = el('div', `game-chip ${sel ? 'selected' : ''}`);
    chip.innerHTML = `
      <span class="game-chip-icon">${game.icon}</span>
      <div class="game-chip-info">
        <div class="game-chip-name">${game.name}</div>
      </div>
      <span class="game-chip-check">✓</span>
    `;
    chip.title = game.desc;
    chip.onclick = () => {
      if (selectedGames.has(game.id)) selectedGames.delete(game.id);
      else selectedGames.add(game.id);
      chip.classList.toggle('selected', selectedGames.has(game.id));
      const panelTitle = document.querySelector('#panel-games .panel-title span');
      if (panelTitle) panelTitle.textContent = `🎮 Select Games (${selectedGames.size} selected)`;
    };
    scroll.appendChild(chip);
  });
}

function startGame() {
  if (selectedGames.size < 1) { toast('Select at least 1 game!', 'error', '❌'); return; }
  socket.emit('lobby:start', { selectedGames: [...selectedGames] });
}

function copyCode() {
  navigator.clipboard.writeText(lobby.code).then(() => toast('Room code copied!', 'success', '📋'));
}

function sendChat() {
  const inp = $('chat-input');
  const message = inp?.value.trim();
  if (!message) return;
  socket.emit('chat:message', { message });
  inp.value = '';
}

function appendChat(msg) {
  const container = $('chat-messages');
  if (!container) return;
  const isSystem = msg.sender === 'System';
  const div = el('div', `chat-msg ${isSystem ? 'chat-msg-system' : ''}`);
  div.innerHTML = `
    <span class="chat-avatar">${msg.avatar || '💬'}</span>
    <span class="chat-text"><span class="chat-sender">${escHtml(msg.sender)}</span>${escHtml(msg.message)}</span>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ─── Game Screen ──────────────────────────────────────────────────────────────
function renderGame(data) {
  showScreen('screen-game');
  const game = data.game;
  const screen = $('screen-game');

  screen.innerHTML = `
    <div class="game-layout">
      <!-- HUD -->
      <div class="game-hud">
        <div class="hud-game-info">
          <span class="hud-game-icon">${game.icon}</span>
          <span class="hud-game-name">${game.name}</span>
          <span class="hud-round">Round ${data.roundIndex} / ${data.maxRounds}</span>
        </div>
        <div class="progress-bar" style="width:200px">
          <div class="progress-fill" id="hud-progress" style="width:100%"></div>
        </div>
        <div class="hud-timer" id="hud-timer">--</div>
        <div class="hud-players-mini" id="hud-players-mini"></div>
        <button class="hud-btn-call" id="btn-open-calls">📞 Call Player</button>
        ${isHost ? '<button class="btn-ghost" style="font-size:12px" id="btn-force-end">⏭️ Skip</button>' : ''}
      </div>

      <!-- Game Area -->
      <div class="game-area">
        <div class="game-panel" id="game-panel">
          <div class="game-title-section">
            <span class="game-icon-big">${game.icon}</span>
            <h2 class="game-title">${game.name}</h2>
            <p class="game-desc">${game.desc}</p>
          </div>
          <div id="game-content">
            <div style="text-align:center;color:var(--text-dim);padding:40px">
              <div class="loading-dots"><span></span><span></span><span></span></div>
              <div style="margin-top:12px;font-size:14px">Loading game data...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="game-side">
        <div class="panel-title" style="padding:16px 16px 8px">👥 Players</div>
        <div class="side-players" id="side-players"></div>
        <div class="side-chat">
          <div class="chat-messages" id="game-chat-messages" style="height:120px"></div>
          <div class="chat-input-row">
            <input id="game-chat-input" class="chat-input" placeholder="Chat..." maxlength="80" />
            <button id="game-chat-send" class="btn-send">➤</button>
          </div>
        </div>
      </div>
    </div>
  `;

  updateHudPlayers();
  updateSidePlayers();

  if (isHost) {
    $('btn-force-end').onclick = () => socket.emit('game:force_resolve');
  }

  $('btn-open-calls').onclick = showCallPicker;
  $('game-chat-send').onclick = sendGameChat;
  $('game-chat-input').addEventListener('keydown', e => e.key === 'Enter' && sendGameChat());
}

function sendGameChat() {
  const inp = $('game-chat-input');
  const message = inp?.value.trim();
  if (!message) return;
  socket.emit('chat:message', { message });
  inp.value = '';
}

function updateHudPlayers() {
  const container = $('hud-players-mini');
  if (!container || !lobby) return;
  container.innerHTML = '';
  lobby.players.forEach(p => {
    const div = el('div', `mini-player ${p.id === activeCallId ? 'speaking' : ''}`);
    div.innerHTML = `${p.avatar}<span class="score-pill">${p.score}</span>`;
    div.title = `${p.name} — ${p.score} pts`;
    div.onclick = () => initiateCall(p.id);
    container.appendChild(div);
  });
}

function updateSidePlayers() {
  const container = $('side-players');
  if (!container || !lobby) return;
  container.innerHTML = '';
  lobby.players.forEach(p => {
    if (p.id === myId) return;
    const div = el('div', `side-player ${p.id === activeCallId ? 'calling' : ''}`);
    div.innerHTML = `
      <div class="side-player-avatar">${p.avatar}</div>
      <div class="side-player-name">${escHtml(p.name)}</div>
      <div class="side-player-score">${p.score}</div>
      <button class="call-btn-mini" data-call="${p.id}">📞</button>
    `;
    div.querySelector('[data-call]').onclick = (e) => { e.stopPropagation(); initiateCall(p.id); };
    container.appendChild(div);
  });
}

// ─── Game Content Rendering ───────────────────────────────────────────────────
function injectPrivateData(data) {
  const content = $('game-content');
  if (!content) return;

  switch (data.type) {
    case 'room_numbers':      renderRoomNumbers(data); break;
    case 'bomb_defusal':      renderBombDefusal(data); break;
    case 'prisoners_dilemma': renderPrisonersDilemma(data); break;
    case 'odd_one_out':       renderOddOneOut(data); break;
    case 'secret_word':       renderSecretWord(data); break;
    case 'hot_seat':          renderHotSeat(data); break;
    case 'chain_lie':         renderChainLie(data); break;
    case 'spy_hunt':          renderSpyHunt(data); break;
    case 'fake_news':         renderFakeNews(data); break;
    case 'trust_fall':        renderTrustFall(data); break;
    case 'auction':           renderAuction(data); break;
    case 'color_grid':        renderColorGrid(data); break;
    case 'password_game':     renderPasswordGame(data); break;
    case 'alibi':             renderAlibi(data); break;
    case 'consensus':         renderConsensus(data); break;
    default: content.innerHTML = `<p class="text-dim text-center">Game type: ${data.type}</p>`;
  }
}

/* ── Room Numbers ── */
function renderRoomNumbers(data) {
  const content = $('game-content');
  const otherPlayers = lobby.players.filter(p => p.id !== myId);
  content.innerHTML = `
    <div class="game-private-info">
      <div class="private-label">🔒 Your Room Number</div>
      <div class="private-value">Room ${data.myRoom}</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin:16px 0">Call other players to find out their room numbers. Then submit your guesses below.</div>
    ${otherPlayers.map(p => `
      <div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">${escHtml(p.name)} ${p.avatar}</div>
        <div class="room-grid" id="room-grid-${p.id}">
          ${[...Array(lobby.players.length)].map((_,i) => `
            <button class="room-btn" data-target="${p.id}" data-room="${i+1}" onclick="guessRoom(this)">${i+1}</button>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

window.guessRoom = function(btn) {
  const targetId = btn.dataset.target;
  const room = parseInt(btn.dataset.room);
  const grid = document.getElementById(`room-grid-${targetId}`);
  if (grid) grid.querySelectorAll('.room-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  socket.emit('game:action', { action: 'guess', payload: { targetId, room } });
  toast(`Guessed Room ${room} for ${lobby.players.find(p=>p.id===targetId)?.name}`, 'info', '🚪');
};

/* ── Bomb Defusal ── */
function renderBombDefusal(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="game-private-info">
      <div class="private-label">🔒 Your Code Fragment</div>
      <div class="private-value">${data.myFragment}</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin:12px 0">
      Call other players to collect their fragments. Assemble the full 6-digit code!
    </div>
    <div class="code-input-section">
      <div style="font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:8px">Enter the full bomb code:</div>
      <input id="bomb-code-input" class="code-input" maxlength="6" placeholder="------" />
      <button class="btn-submit-code" onclick="submitBombCode()">💣 Defuse!</button>
    </div>
    <div id="bomb-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:12px"></div>
  `;
}

window.submitBombCode = function() {
  const code = $('bomb-code-input')?.value.trim().toUpperCase();
  if (!code || code.length !== 6) { toast('Enter full 6-character code!', 'error', '❌'); return; }
  socket.emit('game:action', { action: 'submit_code', payload: { code } });
  $('bomb-status').textContent = '✅ Code submitted! Waiting for others...';
  toast('Code submitted!', 'success', '💣');
};

/* ── Prisoner's Dilemma ── */
function renderPrisonersDilemma(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="question-card" style="margin-bottom:16px">
      <div class="question-text">Cooperate or Betray?</div>
      <div class="question-sub">
        Both cooperate → +5 each | You betray, they cooperate → +15 for you | Both betray → +0
      </div>
    </div>
    <div class="choice-row">
      <button class="choice-btn choice-btn-cooperate" onclick="prisonerVote('cooperate')">
        <span class="choice-icon">🤝</span>
        <span>Cooperate</span>
        <span class="choice-sub">Safe but modest</span>
      </button>
      <button class="choice-btn choice-btn-betray" onclick="prisonerVote('betray')">
        <span class="choice-icon">🗡️</span>
        <span>Betray</span>
        <span class="choice-sub">Risky but rewarding</span>
      </button>
    </div>
    <div id="prisoner-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:16px"></div>
    <div id="prisoner-votes" style="margin-top:12px"></div>
  `;
}

window.prisonerVote = function(choice) {
  socket.emit('game:action', { action: 'vote', payload: { choice } });
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected-cooperate','selected-betray'));
  document.querySelector(`.choice-btn-${choice}`)?.classList.add(`selected-${choice}`);
  $('prisoner-status').textContent = choice === 'cooperate' ? '🤝 Cooperating... wait for others.' : '🗡️ Betraying... sneaky.';
  toast(`You chose to ${choice}!`, 'info', choice === 'cooperate' ? '🤝' : '🗡️');
};

/* ── Odd One Out ── */
function renderOddOneOut(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="game-private-info">
      <div class="private-label">🔒 Your Attribute</div>
      <div class="private-value" style="font-size:36px">🎨 ${data.myAttribute}</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin:12px 0">
      Call players. One person has a DIFFERENT color. Find them!
    </div>
    <div class="vote-grid" id="vote-grid">
      ${lobby.players.filter(p=>p.id!==myId).map(p => `
        <div class="vote-card" onclick="votePlayer('${p.id}', this)">
          <div class="vote-avatar">${p.avatar}</div>
          <div>${escHtml(p.name)}</div>
        </div>
      `).join('')}
    </div>
    <div id="odd-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:12px"></div>
  `;
}

/* ── Secret Word ── */
function renderSecretWord(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="game-private-info">
      <div class="private-label">🔒 Your Secret Word</div>
      <div class="private-value" style="font-size:32px">${data.myWord}</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin:12px 0">
      Discuss your words with others via calls. One player has a different word — vote them out!
    </div>
    <div class="vote-grid" id="vote-grid">
      ${lobby.players.filter(p=>p.id!==myId).map(p => `
        <div class="vote-card" onclick="votePlayer('${p.id}', this)">
          <div class="vote-avatar">${p.avatar}</div>
          <div>${escHtml(p.name)}</div>
        </div>
      `).join('')}
    </div>
    <div id="vote-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:12px"></div>
  `;
}

/* ── Hot Seat ── */
function renderHotSeat(data) {
  const content = $('game-content');
  if (data.isHotSeat) {
    content.innerHTML = `
      <div class="spy-warning">
        <span class="spy-icon">🔥</span>
        <div class="spy-title">YOU ARE IN THE HOT SEAT!</div>
        <div class="spy-desc">Answer the questions below. Others will vote if you're lying.</div>
      </div>
      <div style="margin-top:16px" id="hot-seat-questions">
        ${data.questions.map((q, i) => `
          <div class="question-card" style="margin-bottom:12px">
            <div class="question-text">${escHtml(q)}</div>
            <div class="answer-input-row" style="margin-top:12px">
              <input id="ans-${i}" class="answer-input" placeholder="Your answer..." />
              <button class="btn-submit-code" onclick="submitHotSeatAnswer(${i})" style="font-size:13px;padding:0 16px">Submit</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    content.innerHTML = `
      <div class="question-card">
        <div class="question-text">🔥 Someone is in the Hot Seat!</div>
        <div class="question-sub">Listen to their answers via voice call, then vote: Truth or Lie?</div>
      </div>
      <div id="hot-seat-vote-area" style="margin-top:16px">
        <div style="text-align:center;color:var(--text-dim)">Waiting for answers...</div>
      </div>
    `;
  }
}

window.submitHotSeatAnswer = function(qIndex) {
  const ans = document.getElementById(`ans-${qIndex}`)?.value.trim();
  if (!ans) return;
  socket.emit('game:action', { action: 'answer', payload: { answer: ans, questionIndex: qIndex } });
  toast('Answer submitted!', 'success', '✅');
};

/* ── Chain Lie ── */
function renderChainLie(data) {
  const content = $('game-content');
  const chainPlayers = lobby.players; // chain order
  if (data.isFirst) {
    content.innerHTML = `
      <div class="game-private-info">
        <div class="private-label">🔒 Original Message (DO NOT REPEAT EXACTLY)</div>
        <div class="private-value" style="font-size:20px;word-break:break-word">"${data.original}"</div>
      </div>
      <div style="color:var(--text-dim);font-size:14px;margin:12px 0">
        Call the next player and tell them the message — but you can distort it!
      </div>
      <div class="chain-display" id="chain-display">
        ${chainPlayers.map((p,i) => `
          <div class="chain-step ${i===0?'active':''}" id="chain-step-${i}">
            <span class="chain-step-avatar">${p.avatar}</span>
            <span class="chain-step-name">${escHtml(p.name)}</span>
            <span class="chain-step-msg" id="chain-msg-${i}">${i===0?'"'+data.original+'"':''}</span>
          </div>
        `).join('')}
      </div>
      <div class="answer-input-row" style="margin-top:16px">
        <input id="chain-input" class="answer-input" placeholder="What you'll say to the next player..." />
        <button class="btn-submit-code" onclick="passChainMessage()" style="font-size:13px;padding:0 16px">📞 Pass</button>
      </div>
    `;
  } else {
    content.innerHTML = `
      <div class="question-card">
        <div class="question-text">📞 Chain Lie</div>
        <div class="question-sub">Wait for someone to call you with the message. Then pass it on!</div>
      </div>
      <div id="chain-receive-area" style="margin-top:16px;text-align:center;color:var(--text-dim)">
        Waiting to receive the message...
      </div>
      <div id="chain-pass-area" class="hidden" style="margin-top:16px">
        <div class="game-private-info" id="chain-received-msg">
          <div class="private-label">Message Received</div>
          <div class="private-value" id="chain-msg-text" style="font-size:20px"></div>
        </div>
        <div style="color:var(--text-dim);font-size:14px;margin:12px 0">Pass it to the next player (distort it if you want!):</div>
        <div class="answer-input-row">
          <input id="chain-input" class="answer-input" placeholder="What you'll say..." />
          <button class="btn-submit-code" onclick="passChainMessage()" style="font-size:13px;padding:0 16px">📞 Pass</button>
        </div>
      </div>
    `;
  }
}

window.passChainMessage = function() {
  const message = $('chain-input')?.value.trim();
  if (!message) { toast('Enter a message to pass!', 'error', '❌'); return; }
  socket.emit('game:action', { action: 'pass', payload: { message } });
  toast('Message passed!', 'success', '📞');
};

function handleChainLieReceive(message) {
  const area = $('chain-receive-area');
  const passArea = $('chain-pass-area');
  const msgText = $('chain-msg-text');
  if (area) area.textContent = '✅ Message received!';
  if (passArea) passArea.classList.remove('hidden');
  if (msgText) msgText.textContent = `"${message}"`;
}

/* ── Spy Hunt ── */
function renderSpyHunt(data) {
  const content = $('game-content');
  const isSpy = data.myRole === 'SPY';
  content.innerHTML = `
    ${isSpy ? `
      <div class="spy-warning">
        <span class="spy-icon">🕵️</span>
        <div class="spy-title">YOU ARE THE SPY!</div>
        <div class="spy-desc">Figure out the location from conversation clues. Don't get caught!</div>
      </div>
    ` : `
      <div class="location-reveal">
        <span class="loc-icon">📍</span>
        <div class="loc-name">${data.myRole}</div>
        <div class="loc-hint">This is the secret location. Discuss it without revealing it to the spy!</div>
      </div>
    `}
    <div style="margin-top:16px">
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Vote for who you think is the spy:</div>
      <div class="vote-grid">
        ${lobby.players.filter(p=>p.id!==myId).map(p => `
          <div class="vote-card" onclick="votePlayer('${p.id}', this)">
            <div class="vote-avatar">${p.avatar}</div>
            <div>${escHtml(p.name)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ── Fake News ── */
function renderFakeNews(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="game-private-info">
      <div class="private-label">🔒 Your "Fact"</div>
      <div class="private-value" style="font-size:18px;word-break:break-word">"${data.myFact}"</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin:12px 0">
      Share your fact with others via calls. One person has a FAKE version. Find them!
    </div>
    <div class="vote-grid" id="vote-grid">
      ${lobby.players.filter(p=>p.id!==myId).map(p => `
        <div class="vote-card" onclick="votePlayer('${p.id}', this)">
          <div class="vote-avatar">${p.avatar}</div>
          <div>${escHtml(p.name)}</div>
          <div style="font-size:11px;color:var(--text-dim)">has fake?</div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ── Trust Fall ── */
function renderTrustFall(data) {
  const content = $('game-content');
  const myPair = data.myPairs[0];
  if (!myPair) { content.innerHTML = '<p class="text-dim text-center">You\'re not in a pair this round.</p>'; return; }

  const partnerId = myPair.find(id => id !== myId);
  const partner = lobby.players.find(p => p.id === partnerId);
  const task = data.tasks[myPair.join(',')] || data.tasks[myPair.slice().reverse().join(',')];

  content.innerHTML = `
    <div class="question-card">
      <div class="question-text">Your partner: ${partner?.avatar} ${escHtml(partner?.name || 'Unknown')}</div>
      <div class="question-sub">Complete this task together via voice call!</div>
    </div>
    <div class="game-private-info" style="margin-top:16px">
      <div class="private-label">🎯 Your Task</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">${task || 'Coordinate something together!'}</div>
    </div>
    <button class="btn-submit-code" style="margin-top:16px" onclick="completeTrust()">✅ Mark Complete</button>
  `;
}

window.completeTrust = function() {
  socket.emit('game:action', { action: 'complete', payload: {} });
  toast('Task marked complete!', 'success', '✅');
};

/* ── Blind Auction ── */
function renderAuction(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="game-private-info" style="margin-bottom:16px">
      <div class="private-label">💰 Your Budget</div>
      <div class="private-value">${data.budget} coins</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin-bottom:16px">
      Call others to bluff or learn item values. Place your bids!
    </div>
    <div class="auction-items-grid">
      ${data.items.map((item, i) => `
        <div class="auction-item">
          <div class="auction-item-name">${item.name}</div>
          <div class="auction-item-hint">Value: ???</div>
          <div class="bid-row">
            <input id="bid-${i}" class="bid-input" type="number" placeholder="Bid..." min="0" max="${data.budget}" />
            <button class="btn-bid" onclick="placeBid(${i})">Bid</button>
          </div>
          <div id="bid-status-${i}" style="font-size:11px;color:var(--text-dim)"></div>
        </div>
      `).join('')}
    </div>
  `;
}

window.placeBid = function(itemIndex) {
  const amount = parseInt(document.getElementById(`bid-${itemIndex}`)?.value) || 0;
  socket.emit('game:action', { action: 'bid', payload: { itemIndex, amount } });
  document.getElementById(`bid-status-${itemIndex}`).textContent = `✅ Bid: ${amount} coins`;
  toast(`Bid ${amount} coins!`, 'success', '🏷️');
};

/* ── Color Grid ── */
function renderColorGrid(data) {
  const content = $('game-content');
  const colorNames = { R:'Red', G:'Green', B:'Blue', Y:'Yellow', P:'Purple', O:'Orange' };
  let userGrid = Array(16).fill(null);
  if (data.myChunk) {
    data.myChunk.indices.forEach((idx, i) => { userGrid[idx] = data.myChunk.colors[i]; });
  }

  content.innerHTML = `
    <div style="color:var(--text-dim);font-size:14px;margin-bottom:16px">
      You know your section. Call others to fill in the rest!
    </div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
      Your cells: ${data.myChunk ? data.myChunk.indices.map(i=>'#'+(i+1)).join(', ') : 'none'}
    </div>
    <div class="grid-container" id="color-grid">
      ${userGrid.map((c, i) => `
        <div class="grid-cell ${c ? 'revealed cell-'+c : 'unknown'}" id="cell-${i}" onclick="toggleCell(${i})" data-color="${c||''}">
          ${c || (i+1)}
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
      ${Object.entries(colorNames).map(([k,v]) => `
        <button class="clue-tag" style="cursor:pointer" onclick="selectColor('${k}')">${k} = ${v}</button>
      `).join('')}
    </div>
    <div id="selected-color" style="font-size:13px;color:var(--accent);margin:8px 0;text-align:center">Click a color then click a cell to fill it</div>
    <button class="btn-submit-code" style="margin-top:12px" onclick="submitGrid()">Submit Grid</button>
  `;

  // Simple color picker interaction
  window._selectedColor = null;
}

window.selectColor = function(c) {
  window._selectedColor = c;
  $('selected-color').textContent = `Selected: ${c} — now click a cell`;
};

window.toggleCell = function(idx) {
  if (!window._selectedColor) return;
  const cell = document.getElementById(`cell-${idx}`);
  if (!cell) return;
  cell.className = `grid-cell revealed cell-${window._selectedColor}`;
  cell.textContent = window._selectedColor;
  cell.dataset.color = window._selectedColor;
};

window.submitGrid = function() {
  const cells = document.querySelectorAll('.grid-cell');
  const grid = [...cells].map(c => c.dataset.color || '?');
  socket.emit('game:action', { action: 'submit', payload: { grid } });
  toast('Grid submitted!', 'success', '🎨');
};

/* ── Password Game ── */
function renderPasswordGame(data) {
  const content = $('game-content');
  const myTeamIdx = data.teams.findIndex(t => t.includes(myId));
  const isClueGiver = myTeamIdx >= 0 && data.teams[myTeamIdx][0] === myId;

  content.innerHTML = `
    <div class="game-private-info" style="margin-bottom:16px">
      <div class="private-label">🔑 Secret Password</div>
      <div class="private-value">${data.password}</div>
    </div>
    <div style="color:var(--text-dim);font-size:14px;margin-bottom:12px">
      ${isClueGiver ? 'You are a clue giver! Give one-word hints. Don\'t say the password!' : 'Guess the password based on clues!'}
    </div>
    <div class="clues-list" id="clues-list"></div>
    ${isClueGiver ? `
      <div class="answer-input-row">
        <input id="clue-input" class="answer-input" placeholder="One word clue..." maxlength="20" />
        <button class="btn-submit-code" onclick="giveClue()" style="font-size:13px;padding:0 16px">Give Clue</button>
      </div>
    ` : `
      <div class="answer-input-row">
        <input id="guess-input" class="answer-input" placeholder="Guess the password..." maxlength="20" />
        <button class="btn-submit-code" onclick="makeGuess()" style="font-size:13px;padding:0 16px">Guess!</button>
      </div>
    `}
    <div id="pw-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:12px"></div>
  `;
}

window.giveClue = function() {
  const clue = $('clue-input')?.value.trim();
  if (!clue) return;
  socket.emit('game:action', { action: 'clue', payload: { clue } });
  $('clue-input').value = '';
  toast('Clue submitted!', 'success', '🔑');
};

window.makeGuess = function() {
  const guess = $('guess-input')?.value.trim().toUpperCase();
  if (!guess) return;
  socket.emit('game:action', { action: 'guess', payload: { guess } });
  $('pw-status').textContent = `Guessed: ${guess}`;
  toast(`Guessed: ${guess}`, 'info', '🔑');
};

/* ── Alibi ── */
function renderAlibi(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="alibi-crime">
      <div class="alibi-crime-title">The Crime</div>
      <div class="alibi-crime-text">${data.crime}</div>
    </div>
    ${data.isSuspect ? `
      <div class="spy-warning" style="margin-top:12px">
        <span class="spy-icon">🔎</span>
        <div class="spy-title">YOU ARE THE SUSPECT!</div>
        <div class="spy-desc">Answer questions convincingly. Deny everything!</div>
      </div>
    ` : `
      <div style="color:var(--text-dim);font-size:14px;margin:12px 0">Ask the suspect questions via voice call, then vote!</div>
    `}
    <div style="margin-top:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:8px">Questions Asked:</div>
      <div class="questions-list" id="questions-list"></div>
    </div>
    ${!data.isSuspect ? `
      <div class="answer-input-row" style="margin-top:12px">
        <input id="question-input" class="answer-input" placeholder="Ask a question..." />
        <button class="btn-submit-code" onclick="askQuestion_alibi()" style="font-size:13px;padding:0 16px">Ask</button>
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--text-dim);margin-bottom:8px">Vote: Is this person guilty?</div>
      <div class="choice-row">
        <button class="choice-btn" onclick="voteAlibi(true)" style="flex:1">
          <span class="choice-icon">⚖️</span> Guilty
        </button>
        <button class="choice-btn" onclick="voteAlibi(false)" style="flex:1">
          <span class="choice-icon">✅</span> Innocent
        </button>
      </div>
    ` : ''}
  `;
}

window.askQuestion_alibi = function() {
  const q = $('question-input')?.value.trim();
  if (!q) return;
  socket.emit('game:action', { action: 'question', payload: { question: q } });
  $('question-input').value = '';
};

window.voteAlibi = function(isCriminal) {
  socket.emit('game:action', { action: 'vote', payload: { isCriminal } });
  toast(isCriminal ? 'Voted: Guilty!' : 'Voted: Innocent!', 'info', '⚖️');
};

/* ── Consensus ── */
function renderConsensus(data) {
  const content = $('game-content');
  content.innerHTML = `
    <div class="question-card" style="margin-bottom:16px">
      <div class="question-text">"${data.question}"</div>
      <div class="question-sub">Coordinate via calls. Everyone must give the same answer!</div>
    </div>
    <div class="answer-input-row">
      <input id="consensus-input" class="answer-input" placeholder="Your answer..." maxlength="30" />
      <button class="btn-submit-code" onclick="submitConsensus()" style="font-size:13px;padding:0 16px">Lock In</button>
    </div>
    <div id="consensus-status" style="text-align:center;font-size:13px;color:var(--text-dim);margin-top:12px"></div>
    <div id="consensus-answers" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px"></div>
  `;
}

window.submitConsensus = function() {
  const answer = $('consensus-input')?.value.trim();
  if (!answer) return;
  socket.emit('game:action', { action: 'answer', payload: { answer } });
  $('consensus-status').textContent = `✅ Locked in: "${answer}"`;
  toast(`Locked in: "${answer}"`, 'success', '🧠');
};

/* ── Shared vote handler ── */
window.votePlayer = function(targetId, btn) {
  document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('voted'));
  btn.classList.add('voted');
  socket.emit('game:action', { action: 'vote', payload: { targetId } });
  const target = lobby.players.find(p => p.id === targetId);
  toast(`Voted for ${target?.name}`, 'info', '🗳️');
  const statusEl = document.getElementById('odd-status') || document.getElementById('vote-status');
  if (statusEl) statusEl.textContent = `✅ Voted for ${target?.name}`;
};

// ─── Game State Updates ───────────────────────────────────────────────────────
function updateGameStateUI(data) {
  // Update various state displays
  if (data.type === 'consensus') {
    const area = $('consensus-answers');
    if (area && data.answers) {
      area.innerHTML = Object.entries(data.answers).map(([pid, ans]) => {
        const player = lobby?.players.find(p => p.id === pid);
        return `<span class="clue-tag">${player?.avatar || '👤'} ${escHtml(ans)}</span>`;
      }).join('');
    }
  }
  if (data.type === 'password_game' && data.clues) {
    const clueList = $('clues-list');
    if (clueList) {
      clueList.innerHTML = data.clues.map(c => {
        const giver = lobby?.players.find(p => p.id === c.giver);
        return `<span class="clue-tag">${giver?.avatar || '👤'} "${escHtml(c.clue)}"</span>`;
      }).join('');
    }
  }
  if (data.type === 'alibi' && data.questions) {
    const qList = $('questions-list');
    if (qList) {
      qList.innerHTML = data.questions.map((q, i) => {
        const asker = lobby?.players.find(p => p.id === q.asker);
        return `
          <div class="q-item">
            <div class="q-question">${asker?.avatar || '❓'} ${escHtml(q.question)}</div>
            ${data.answers?.[i] ? `<div class="q-answer">→ "${escHtml(data.answers[i])}"</div>` : ''}
          </div>
        `;
      }).join('');
    }
  }
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  clearInterval(timerInterval);
  timerEnd = Date.now() + seconds * 1000;
  updateTimer();
  timerInterval = setInterval(updateTimer, 500);
}

function updateTimer() {
  const remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  const timerEl = $('hud-timer');
  if (!timerEl) return;
  timerEl.textContent = remaining;
  timerEl.classList.toggle('urgent', remaining <= 10);

  const total = currentGame?.gameData?.duration || 60;
  const progress = $('hud-progress');
  if (progress) progress.style.width = `${(remaining / total) * 100}%`;

  if (remaining <= 0) clearInterval(timerInterval);
}

// ─── Round Results ────────────────────────────────────────────────────────────
function showRoundResults(data) {
  // overlay results on game screen
  const overlay = el('div', 'results-overlay');
  overlay.innerHTML = `
    <div class="results-card">
      <div class="results-title">Round ${data.roundIndex} Results 🎯</div>
      <div class="results-list">
        ${data.results.map(r => `
          <div class="result-row">
            <span>${lobby.players.find(p=>p.id===r.playerId)?.avatar || '👤'}</span>
            <span class="result-name">${escHtml(r.name)}</span>
            <div>
              <div class="result-points earned">+${r.points}</div>
              <div class="result-reason">${escHtml(r.reason)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:20px">
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;text-align:center">
          ${data.roundIndex < data.maxRounds ? `Next round in 10 seconds... (Round ${data.roundIndex+1}/${data.maxRounds})` : '🏆 Final Round! Match ending...'}
        </div>
        <div class="results-list" style="margin-top:12px">
          ${[...data.players].sort((a,b)=>b.score-a.score).map((p, i) => `
            <div class="result-row">
              <span>${['🥇','🥈','🥉'][i] || `${i+1}.`}</span>
              <span>${p.avatar}</span>
              <span class="result-name">${escHtml(p.name)}</span>
              <span class="result-points">${p.score}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 9500);

  // Update side panel
  if (lobby) lobby = { ...lobby, players: data.players };
  updateSidePlayers();
  updateHudPlayers();
}

// ─── End Screen ───────────────────────────────────────────────────────────────
function renderEndScreen(data) {
  showScreen('screen-end');
  const screen = $('screen-end');
  const sorted = data.players;
  const top3 = sorted.slice(0, 3);
  const winner = sorted[0];

  // Reorder podium: 2nd, 1st, 3rd
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : (top3.length === 2 ? [top3[1], top3[0]] : [top3[0]]);

  screen.innerHTML = `
    <div class="end-card" style="padding:40px 20px">
      <span class="end-trophy">🏆</span>
      <div class="end-title">${escHtml(winner?.name || 'Champion')}</div>
      <div class="end-subtitle">wins with ${winner?.score} points!</div>

      <div class="podium" style="margin-bottom:32px">
        ${podiumOrder.map((p, i) => {
          const positions = ['2nd','1st','3rd'];
          const actualIdx = podiumOrder.indexOf(p);
          return `
            <div class="podium-place">
              <div class="podium-avatar">${p?.avatar || '👤'}</div>
              <div class="podium-name">${escHtml(p?.name || '')}</div>
              <div class="podium-score">${p?.score} pts</div>
              <div class="podium-bar">${i === 1 ? '🥇' : (i === 0 ? '🥈' : '🥉')}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="full-scoreboard">
        ${sorted.map((p, i) => `
          <div class="scoreboard-row">
            <div class="scoreboard-rank">${i + 1}</div>
            <div class="scoreboard-avatar">${p.avatar}</div>
            <div class="scoreboard-name">${escHtml(p.name)}</div>
            <div class="scoreboard-score">${p.score}</div>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn-primary" style="max-width:200px" onclick="playAgain()">🔄 Play Again</button>
        <button class="btn-secondary" style="max-width:200px" onclick="goHome()">🏠 Main Menu</button>
      </div>
    </div>
  `;
}

window.playAgain = function() {
  lobby.players.forEach(p => p.score = 0);
  if (isHost) {
    socket.emit('lobby:start', { selectedGames: [...selectedGames] });
  } else {
    toast('Waiting for host to start a new game...', 'info', '⏳');
    showScreen('screen-lobby');
    renderLobby();
  }
};

window.goHome = function() {
  socket.disconnect();
  lobby = null;
  selectedGames = new Set(GAMES_LIST.map(g => g.id));
  showScreen('screen-landing');
  renderLanding();
};

// ─── WebRTC Voice Chat ────────────────────────────────────────────────────────
async function getLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return localStream;
  } catch (e) {
    toast('Microphone access denied', 'error', '🎤');
    return null;
  }
}

async function initiateCall(targetId) {
  if (targetId === myId) return;
  if (activeCallId) {
    toast('Already in a call. End it first.', 'error', '📵');
    return;
  }

  const stream = await getLocalStream();
  if (!stream) return;

  const player = lobby?.players.find(p => p.id === targetId);
  toast(`Calling ${player?.name}...`, 'info', '📞');

  socket.emit('webrtc:call_request', { targetId });
  // Create peer connection proactively
  createPeerConnection(targetId, true, stream);
}

function showCallNotification(player) {
  $('call-caller-avatar').textContent = player.avatar;
  $('call-caller-name').textContent = player.name;
  $('call-notification').classList.remove('hidden');

  $('btn-accept-call').onclick = () => acceptCall(player.id);
  $('btn-reject-call').onclick = () => {
    $('call-notification').classList.add('hidden');
    pendingCallFrom = null;
    socket.emit('webrtc:call_end', { targetId: player.id });
  };
}

async function acceptCall(fromId) {
  $('call-notification').classList.add('hidden');
  pendingCallFrom = null;

  const stream = await getLocalStream();
  if (!stream) return;

  // Wait for offer (it should come via socket shortly)
  const pc = createPeerConnection(fromId, false, stream);
  activeCallId = fromId;
  showCallHud(fromId);
  updateHudPlayers();
  updateSidePlayers();
}

async function handleOffer(fromId, offer) {
  let pc = peerConnections[fromId];
  if (!pc) {
    const stream = await getLocalStream();
    if (!stream) return;
    pc = createPeerConnection(fromId, false, stream);
  }

  if (pc.signalingState !== 'stable') return;

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc:answer', { targetId: fromId, answer });
}

function createPeerConnection(peerId, isInitiator, localStream) {
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections[peerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc:ice_candidate', { targetId: peerId, candidate });
  };

  pc.ontrack = ({ streams }) => {
    const audio = document.createElement('audio');
    audio.srcObject = streams[0];
    audio.autoplay = true;
    audio.id = `audio-${peerId}`;
    document.body.appendChild(audio);
    activeCallId = peerId;
    showCallHud(peerId);
    updateHudPlayers();
    updateSidePlayers();
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      endCall(peerId);
    }
  };

  if (isInitiator) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { targetId: peerId, offer });
    });
  }

  return pc;
}

function showCallHud(peerId) {
  const player = lobby?.players.find(p => p.id === peerId);
  $('call-hud-avatar').textContent = player?.avatar || '👤';
  $('call-hud-name').textContent = player?.name || 'Unknown';
  $('call-hud').classList.remove('hidden');

  $('btn-mute').onclick = toggleMute;
  $('btn-end-call').onclick = () => endCallActive();
}

function toggleMute() {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  }
  $('btn-mute').textContent = isMuted ? '🔇' : '🎤';
  toast(isMuted ? 'Muted' : 'Unmuted', 'info', isMuted ? '🔇' : '🎤');
}

function endCallActive() {
  if (!activeCallId) return;
  socket.emit('webrtc:call_end', { targetId: activeCallId });
  endCall(activeCallId);
  activeCallId = null;
  $('call-hud').classList.add('hidden');
  updateHudPlayers();
  updateSidePlayers();
}

function endCall(peerId) {
  const pc = peerConnections[peerId];
  if (pc) { pc.close(); delete peerConnections[peerId]; }
  const audio = document.getElementById(`audio-${peerId}`);
  if (audio) audio.remove();
}

function showCallPicker() {
  const otherPlayers = lobby?.players.filter(p => p.id !== myId) || [];
  if (otherPlayers.length === 0) { toast('No other players to call', 'info', 'ℹ️'); return; }

  showModal(
    '📞 Call a Player',
    'Select a player to start a voice call with:',
    null, null, null
  );

  const body = $('modal-body');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      ${otherPlayers.map(p => `
        <button class="btn-secondary" style="display:flex;align-items:center;gap:10px;padding:12px" data-call-id="${p.id}">
          <span style="font-size:24px">${p.avatar}</span>
          <span>${escHtml(p.name)}</span>
          ${p.id === activeCallId ? '<span style="color:var(--teal);font-size:12px;margin-left:auto">📞 Active</span>' : ''}
        </button>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('[data-call-id]').forEach(btn => {
    btn.onclick = () => {
      $('modal-overlay').classList.add('hidden');
      initiateCall(btn.dataset.callId);
    };
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderLanding();
