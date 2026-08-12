const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─── Game Definitions ────────────────────────────────────────────────────────
const GAMES = [
  { id: 'room_numbers',      name: 'Room Numbers',     icon: '🚪', desc: 'Guess your neighbors\' room numbers before they guess yours.' },
  { id: 'bomb_defusal',      name: 'Bomb Defusal',     icon: '💣', desc: 'Each player holds a code fragment. Share them correctly to defuse the bomb.' },
  { id: 'prisoners_dilemma', name: 'Prisoner\'s Dilemma', icon: '⚖️', desc: 'Cooperate or betray? Choose wisely — the stakes are high.' },
  { id: 'odd_one_out',       name: 'Odd One Out',      icon: '🔍', desc: 'Find the player with a different attribute than everyone else.' },
  { id: 'secret_word',       name: 'Secret Word',      icon: '🤫', desc: 'Everyone has the same secret word except one. Find the imposter.' },
  { id: 'hot_seat',          name: 'Hot Seat',         icon: '🔥', desc: 'One player answers rapid questions. Others vote: truth or lie?' },
  { id: 'chain_lie',         name: 'Chain Lie',        icon: '📞', desc: 'Pass a message down the chain. Score points for the most distortion.' },
  { id: 'spy_hunt',          name: 'Spy Hunt',         icon: '🕵️', desc: 'One spy is among you. Civilians must unmask them through interrogation.' },
  { id: 'fake_news',         name: 'Fake News',        icon: '📰', desc: 'One player received a fake fact. Can the others detect the liar?' },
  { id: 'trust_fall',        name: 'Trust Fall',       icon: '🤝', desc: 'Give instructions to someone in another room. Succeed together or fail alone.' },
  { id: 'auction',           name: 'Blind Auction',    icon: '🏷️', desc: 'Bid on mystery items with fake info from other players.' },
  { id: 'color_grid',        name: 'Color Grid',       icon: '🎨', desc: 'Each player sees part of a grid. Reconstruct the full picture via calls.' },
  { id: 'password_game',     name: 'Password',         icon: '🔑', desc: 'Give one-word clues to help your team guess the secret password.' },
  { id: 'alibi',             name: 'Alibi',            icon: '🔎', desc: 'One player is the suspect. Others must crack their alibi to win.' },
  { id: 'consensus',         name: 'Consensus',        icon: '🧠', desc: 'Coordinate via phone calls to all give the same answer to an abstract question.' }
];

// ─── State ────────────────────────────────────────────────────────────────────
const lobbies = {}; // lobbyCode -> lobby object

function createLobby(hostSocket, hostName) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const lobbyId = uuidv4();
  lobbies[code] = {
    id: lobbyId,
    code,
    host: hostSocket.id,
    players: [{
      id: hostSocket.id,
      name: hostName,
      avatar: randomAvatar(),
      isHost: true,
      score: 0,
      ready: false
    }],
    state: 'lobby', // lobby | game | results
    currentGame: null,
    gameQueue: [],
    roundIndex: 0,
    maxRounds: 12,
    gameData: {},
    chatMessages: []
  };
  return code;
}

function randomAvatar() {
  const avatars = ['🦊','🐺','🐸','🦁','🐼','🦋','🐙','🦄','🦅','🐬','🦝','🐻','🦊','🦜','🐯','🦈'];
  return avatars[Math.floor(Math.random() * avatars.length)];
}

function getLobby(code) { return lobbies[code.toUpperCase()]; }

function getPlayerLobby(socketId) {
  for (const code in lobbies) {
    const lobby = lobbies[code];
    if (lobby.players.find(p => p.id === socketId)) return lobby;
  }
  return null;
}

function removePlayer(lobby, socketId) {
  lobby.players = lobby.players.filter(p => p.id !== socketId);
  // Reassign host if needed
  if (lobby.host === socketId && lobby.players.length > 0) {
    lobby.host = lobby.players[0].id;
    lobby.players[0].isHost = true;
  }
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

const GAME_HOW_TO_PLAY = {
  room_numbers:      'You have been assigned a secret room number. Call other players and ask for their room numbers — but beware, they can lie! Guess everyone\'s room number before the timer ends.',
  bomb_defusal:      'Your code fragment is shown privately. Call every player to collect all fragments. Type the full assembled code to defuse the bomb before time runs out!',
  prisoners_dilemma: 'You can\'t talk to anyone — choose to Cooperate or Betray. If both cooperate you both get points. If you betray while they cooperate, you get more. If both betray, nobody wins.',
  odd_one_out:       'Everyone has the same attribute colour — except one person. Call players, share your colour, and figure out who has a different one. Vote before the timer ends!',
  secret_word:       'Everyone has the same secret word — except one imposter. Discuss your words via calls without giving it away. Vote for who you think has a different word.',
  hot_seat:          'One unlucky player is in the Hot Seat and must answer personal questions. Everyone else listens via calls and votes: Truth or Lie? Hot seat player earns points for convincing lies!',
  chain_lie:         'The first player receives a message and passes it to the next via a call — but they can distort it! The message travels down the chain. Most creative distortion wins.',
  spy_hunt:          'One player is the spy and doesn\'t know the location. Civilians must ask clever questions to expose the spy without revealing the location. Spy wins by guessing the location!',
  fake_news:         'Everyone received the same fact — except one player who got a fake version. Share your facts via calls and vote for who you think has the fake one.',
  trust_fall:        'You\'ve been paired with another player. Call them and complete the shared task together. Both must agree the task is done to earn points.',
  auction:           'Four mystery items are up for bid. Call others to bluff about item values. Spend your budget wisely — highest bidder wins each item, but only real value counts!',
  color_grid:        'You can see some cells of a shared 4×4 grid. Call other players to learn their cell colours, then fill in the full grid. Most accurate grid wins!',
  password_game:     'One player per team gives one-word clues. Their teammates guess the secret password. No saying the word itself — be clever with your clues!',
  alibi:             'One player is accused of a ridiculous crime. Others interrogate them via calls and vote guilty or innocent. Suspect earns points if they convince enough people.',
  consensus:         'Everyone must give the same answer to a question — but you can only coordinate via calls! Most players matching on the same answer wins points for each of them.'
};

function startNextGame(lobby) {
  if (lobby.roundIndex >= lobby.maxRounds || !lobby.gameQueue || lobby.gameQueue.length === 0) {
    endMatch(lobby);
    return;
  }

  if (!lobby.remainingGames || lobby.remainingGames.length === 0) {
    lobby.remainingGames = shuffleArray([...lobby.gameQueue]);
  }

  const gameId = lobby.remainingGames.pop();
  const gameDef = GAMES.find(g => g.id === gameId);
  lobby.currentGame = gameId;
  lobby.state = 'preview';

  // ── 15-second preview before game starts ──
  const howToPlay = GAME_HOW_TO_PLAY[gameId] || gameDef.desc;
  io.to(lobby.code).emit('game:preview', {
    roundIndex: lobby.roundIndex + 1,
    maxRounds: lobby.maxRounds,
    game: gameDef,
    howToPlay,
    countdown: 15
  });

  lobby.previewTimer = setTimeout(() => {
    if (!lobbies[lobby.code]) return;
    lobby.state = 'game';
    lobby.gameData = initGameData(gameId, lobby.players);

    io.to(lobby.code).emit('game:start', {
      roundIndex: lobby.roundIndex + 1,
      maxRounds: lobby.maxRounds,
      game: gameDef,
      gameData: filterGameData(gameId, lobby.gameData, null)
    });

    lobby.players.forEach(player => {
      const privateData = filterGameData(gameId, lobby.gameData, player.id);
      io.to(player.id).emit('game:private_data', privateData);
    });

    const duration = getGameDuration(gameId);
    lobby.gameTimer = setTimeout(() => {
      resolveGame(lobby);
    }, duration * 1000);
  }, 15000);
}

function initGameData(gameId, players) {
  const pIds = players.map(p => p.id);
  const pCount = players.length;

  switch (gameId) {
    case 'room_numbers': {
      const rooms = shuffleArray([...Array(pCount).keys()].map(i => i + 1));
      const assignments = {};
      players.forEach((p, i) => { assignments[p.id] = rooms[i]; });
      return { type: 'room_numbers', roomAssignments: assignments, guesses: {}, startTime: Date.now(), duration: 60 };
    }
    case 'bomb_defusal': {
      const fullCode = Array.from({length: 6}, () => Math.floor(Math.random()*10)).join('');
      const fragments = splitIntoFragments(fullCode, pCount);
      const assignments = {};
      players.forEach((p, i) => { assignments[p.id] = fragments[i]; });
      return { type: 'bomb_defusal', fullCode, fragmentAssignments: assignments, submissions: {}, startTime: Date.now(), duration: 90 };
    }
    case 'prisoners_dilemma': {
      return { type: 'prisoners_dilemma', votes: {}, startTime: Date.now(), duration: 30 };
    }
    case 'odd_one_out': {
      const attributes = ['Red','Blue','Green','Yellow','Purple','Orange','Pink','Cyan'];
      const mainAttr = attributes[Math.floor(Math.random()*attributes.length)];
      const oddPlayer = pIds[Math.floor(Math.random()*pCount)];
      const oddAttr = attributes.filter(a => a !== mainAttr)[Math.floor(Math.random()*7)];
      const assignments = {};
      players.forEach(p => { assignments[p.id] = p.id === oddPlayer ? oddAttr : mainAttr; });
      return { type: 'odd_one_out', assignments, oddPlayer, votes: {}, startTime: Date.now(), duration: 60 };
    }
    case 'secret_word': {
      const words = ['SHADOW','THUNDER','ECLIPSE','VORTEX','PHANTOM','CIPHER','NEXUS','OBSIDIAN'];
      const mainWord = words[Math.floor(Math.random()*words.length)];
      const imposterWord = words.filter(w => w !== mainWord)[Math.floor(Math.random()*7)];
      const imposter = pIds[Math.floor(Math.random()*pCount)];
      const assignments = {};
      players.forEach(p => { assignments[p.id] = p.id === imposter ? imposterWord : mainWord; });
      return { type: 'secret_word', assignments, imposter, votes: {}, startTime: Date.now(), duration: 90 };
    }
    case 'hot_seat': {
      const hotPlayer = pIds[Math.floor(Math.random()*pCount)];
      const questions = shuffleArray(HOT_SEAT_QUESTIONS).slice(0, 5);
      return { type: 'hot_seat', hotPlayer, questions, answers: {}, votes: {}, currentQ: 0, startTime: Date.now(), duration: 120 };
    }
    case 'chain_lie': {
      const messages = ['The cake is NOT a lie','Never gonna give you up','All your base are belong to us','The game is afoot'];
      const original = messages[Math.floor(Math.random()*messages.length)];
      const chain = [...pIds]; // order of chain
      return { type: 'chain_lie', original, chain, passed: {}, currentIdx: 0, startTime: Date.now(), duration: 120 };
    }
    case 'spy_hunt': {
      const spy = pIds[Math.floor(Math.random()*pCount)];
      const locations = ['Beach','Space Station','Hospital','Casino','Arctic Base','Submarine','Art Museum'];
      const location = locations[Math.floor(Math.random()*locations.length)];
      return { type: 'spy_hunt', spy, location, assignments: Object.fromEntries(players.map(p => [p.id, p.id === spy ? 'SPY' : location])), votes: {}, startTime: Date.now(), duration: 120 };
    }
    case 'fake_news': {
      const facts = FAKE_NEWS_FACTS;
      const factObj = facts[Math.floor(Math.random()*facts.length)];
      const fakePlayer = pIds[Math.floor(Math.random()*pCount)];
      const assignments = {};
      players.forEach(p => { assignments[p.id] = p.id === fakePlayer ? factObj.fake : factObj.real; });
      return { type: 'fake_news', assignments, fakePlayer, votes: {}, startTime: Date.now(), duration: 60 };
    }
    case 'trust_fall': {
      const pairs = createPairs(pIds);
      const tasks = TRUST_FALL_TASKS.slice(0, pairs.length);
      return { type: 'trust_fall', pairs, tasks: Object.fromEntries(pairs.map((pair, i) => [pair.join(','), tasks[i % tasks.length]])), results: {}, startTime: Date.now(), duration: 90 };
    }
    case 'auction': {
      const items = shuffleArray(AUCTION_ITEMS).slice(0, 4);
      const bids = {};
      const bluffValues = {};
      players.forEach(p => { bids[p.id] = {}; bluffValues[p.id] = {}; });
      return { type: 'auction', items, bids, bluffValues, budget: 1000, startTime: Date.now(), duration: 120 };
    }
    case 'color_grid': {
      const grid = Array.from({length: 16}, () => (['R','G','B','Y','P','O'][Math.floor(Math.random()*6)]));
      const chunkSize = Math.ceil(16 / pCount);
      const assignments = {};
      players.forEach((p, i) => {
        assignments[p.id] = { indices: [...Array(chunkSize).keys()].map(j => i*chunkSize+j).filter(x => x < 16), colors: [] };
        assignments[p.id].colors = assignments[p.id].indices.map(idx => grid[idx]);
      });
      return { type: 'color_grid', grid, assignments, submissions: {}, startTime: Date.now(), duration: 90 };
    }
    case 'password_game': {
      const passwords = ['CASTLE','DRAGON','WIZARD','JUNGLE','OCEAN','METEOR','VIOLIN','SAFARI'];
      const password = passwords[Math.floor(Math.random()*passwords.length)];
      const teams = splitIntoTeams(pIds);
      const clueGiver = { [teams[0][0]]: teams[0][0], [teams[1][0]]: teams[1][0] };
      return { type: 'password_game', password, teams, clues: [], guesses: {}, startTime: Date.now(), duration: 90 };
    }
    case 'alibi': {
      const suspect = pIds[Math.floor(Math.random()*pCount)];
      const crime = ALIBI_CRIMES[Math.floor(Math.random()*ALIBI_CRIMES.length)];
      return { type: 'alibi', suspect, crime, questions: [], answers: {}, votes: {}, startTime: Date.now(), duration: 120 };
    }
    case 'consensus': {
      const question = CONSENSUS_QUESTIONS[Math.floor(Math.random()*CONSENSUS_QUESTIONS.length)];
      return { type: 'consensus', question, answers: {}, finalAnswer: null, startTime: Date.now(), duration: 90 };
    }
    default:
      return { type: gameId, startTime: Date.now(), duration: 60 };
  }
}

function filterGameData(gameId, data, playerId) {
  // Return public version (playerId=null) or player-specific private data
  const pub = { type: data.type, duration: data.duration, startTime: data.startTime };
  if (!playerId) return pub;

  switch (gameId) {
    case 'room_numbers': return { ...pub, myRoom: data.roomAssignments[playerId] };
    case 'bomb_defusal': return { ...pub, myFragment: data.fragmentAssignments[playerId], fragmentIndex: Object.keys(data.fragmentAssignments).indexOf(playerId) };
    case 'odd_one_out':  return { ...pub, myAttribute: data.assignments[playerId] };
    case 'secret_word':  return { ...pub, myWord: data.assignments[playerId] };
    case 'spy_hunt':     return { ...pub, myRole: data.assignments[playerId] };
    case 'fake_news':    return { ...pub, myFact: data.assignments[playerId] };
    case 'hot_seat':     return { ...pub, isHotSeat: data.hotPlayer === playerId, questions: data.hotPlayer === playerId ? data.questions : [] };
    case 'chain_lie':    return { ...pub, isFirst: data.chain[0] === playerId, original: data.chain[0] === playerId ? data.original : undefined };
    case 'color_grid':   return { ...pub, myChunk: data.assignments[playerId] };
    case 'trust_fall':   return { ...pub, myPairs: data.pairs.filter(p => p.includes(playerId)), tasks: data.tasks };
    case 'auction':      return { ...pub, items: data.items, budget: data.budget };
    case 'password_game':return { ...pub, password: data.password, teams: data.teams };
    case 'alibi':        return { ...pub, isSuspect: data.suspect === playerId, crime: data.crime };
    case 'consensus':    return { ...pub, question: data.question };
    default: return pub;
  }
}

function getGameDuration(gameId) {
  const durations = {
    room_numbers: 60, bomb_defusal: 90, prisoners_dilemma: 30,
    odd_one_out: 60, secret_word: 90, hot_seat: 120, chain_lie: 120,
    spy_hunt: 120, fake_news: 60, trust_fall: 90, auction: 120,
    color_grid: 90, password_game: 90, alibi: 120, consensus: 90
  };
  return durations[gameId] || 60;
}

function resolveGame(lobby) {
  if (!lobbies[lobby.code]) return;
  clearTimeout(lobby.gameTimer);
  const results = computeResults(lobby);

  // Apply scores
  results.forEach(({ playerId, points }) => {
    const player = lobby.players.find(p => p.id === playerId);
    if (player) player.score += points;
  });

  io.to(lobby.code).emit('game:results', {
    results,
    players: lobby.players,
    roundIndex: lobby.roundIndex + 1,
    maxRounds: lobby.maxRounds
  });

  lobby.roundIndex++;
  lobby.state = 'results';

  // Auto-advance after 10s
  setTimeout(() => {
    if (lobbies[lobby.code]) startNextGame(lobby);
  }, 10000);
}

function computeResults(lobby) {
  const data = lobby.gameData;
  const players = lobby.players;
  const results = players.map(p => ({ playerId: p.id, name: p.name, points: 0, reason: '' }));

  function award(playerId, points, reason) {
    const r = results.find(r => r.playerId === playerId);
    if (r) { r.points += points; r.reason = reason; }
  }

  switch (data.type) {
    case 'room_numbers': {
      Object.entries(data.guesses).forEach(([guesser, guess]) => {
        Object.entries(guess).forEach(([target, guessedRoom]) => {
          if (data.roomAssignments[target] == guessedRoom) award(guesser, 10, 'Correct room!');
        });
      });
      break;
    }
    case 'bomb_defusal': {
      const submitted = Object.values(data.submissions);
      const correct = submitted.filter(s => s === data.fullCode).length;
      if (correct > 0) players.forEach(p => award(p.id, 20, 'Bomb defused!'));
      break;
    }
    case 'prisoners_dilemma': {
      const votes = data.votes;
      Object.entries(votes).forEach(([pid, vote]) => {
        if (vote === 'cooperate') award(pid, 5, 'Cooperation');
        else award(pid, 15, 'Betrayal bonus');
      });
      // If everyone cooperated, bonus
      if (Object.values(votes).every(v => v === 'cooperate'))
        players.forEach(p => award(p.id, 10, 'Everyone cooperated!'));
      break;
    }
    case 'odd_one_out': case 'secret_word': case 'spy_hunt': case 'fake_news': {
      const oddKey = data.oddPlayer || data.imposter || data.spy || data.fakePlayer;
      Object.entries(data.votes).forEach(([voter, votedFor]) => {
        if (voter !== oddKey && votedFor === oddKey) award(voter, 15, 'Found the imposter!');
      });
      if (!Object.values(data.votes).includes(oddKey)) award(oddKey, 20, 'Imposter undetected!');
      break;
    }
    case 'hot_seat': {
      Object.entries(data.votes).forEach(([q, voterMap]) => {
        Object.entries(voterMap).forEach(([voter, vote]) => {
          // Simple: random scoring for demo
          if (Math.random() > 0.5) award(voter, 5, 'Good read!');
        });
      });
      break;
    }
    case 'consensus': {
      const answers = Object.values(data.answers);
      const freq = {};
      answers.forEach(a => { freq[a] = (freq[a]||0)+1; });
      const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
      if (top) {
        Object.entries(data.answers).forEach(([pid, ans]) => {
          if (ans === top[0]) award(pid, 10 * top[1], 'Consensus reached!');
        });
      }
      break;
    }
    default: players.forEach(p => award(p.id, 5, 'Participated'));
  }
  return results;
}

function endMatch(lobby) {
  const sorted = [...lobby.players].sort((a,b) => b.score - a.score);
  io.to(lobby.code).emit('match:end', { players: sorted });
  lobby.state = 'ended';
}

// ─── Static Data ──────────────────────────────────────────────────────────────
const HOT_SEAT_QUESTIONS = [
  "Have you ever lied to get out of trouble?", "Do you sing in the shower?",
  "Have you ever cheated in a game?", "Are you afraid of spiders?",
  "Have you ever pretended to be sick to skip work?", "Do you talk to yourself?",
  "Have you ever stolen food from a colleague?", "Are you currently hiding something?"
];

const FAKE_NEWS_FACTS = [
  { real: "Honey never expires", fake: "Honey expires in 10 years" },
  { real: "Cleopatra lived closer in time to the Moon landing than to the pyramids", fake: "Cleopatra lived closer in time to the pyramids than the Moon landing" },
  { real: "Bananas are berries but strawberries are not", fake: "Strawberries are berries but bananas are not" },
  { real: "A group of flamingos is called a flamboyance", fake: "A group of flamingos is called a flock" }
];

const TRUST_FALL_TASKS = [
  "Count to 20 together without one person saying the same number",
  "Both describe a color using only food words",
  "Complete this sentence together: 'The best scam is...'",
  "Name 5 animals that start with the same letter, alternating"
];

const AUCTION_ITEMS = [
  { name: 'Mystery Box', trueValue: 500 }, { name: 'Golden Ticket', trueValue: 300 },
  { name: 'Cursed Artifact', trueValue: 50 }, { name: 'Lucky Charm', trueValue: 200 },
  { name: 'Time Machine', trueValue: 999 }, { name: 'Magic 8-Ball', trueValue: 100 }
];

const ALIBI_CRIMES = [
  "Stealing the last slice of pizza from the break room",
  "Releasing a virus that turns all fonts to Comic Sans",
  "Swapping all the sugar with salt in the office kitchen",
  "Deleting the production database on a Friday afternoon"
];

const CONSENSUS_QUESTIONS = [
  "What number am I thinking of between 1 and 10?",
  "Name one color that everyone should agree on",
  "Name a fruit that everyone can agree on",
  "Choose a direction: North, South, East, or West"
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function splitIntoFragments(code, n) {
  const len = code.length;
  const frags = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * len / n);
    const end = Math.floor((i + 1) * len / n);
    frags.push(code.slice(start, end));
  }
  return frags;
}

function createPairs(ids) {
  const shuffled = shuffleArray([...ids]);
  const pairs = [];
  for (let i = 0; i < shuffled.length - 1; i += 2) pairs.push([shuffled[i], shuffled[i+1]]);
  if (shuffled.length % 2 !== 0) pairs.push([shuffled[shuffled.length-1], shuffled[0]]);
  return pairs;
}

function splitIntoTeams(ids) {
  const shuffled = shuffleArray([...ids]);
  const half = Math.floor(shuffled.length / 2);
  return [shuffled.slice(0, half), shuffled.slice(half)];
}

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── Lobby Management ──
  socket.on('lobby:create', ({ name }) => {
    const code = createLobby(socket, name || 'Anonymous');
    socket.join(code);
    socket.emit('lobby:created', { code, lobby: lobbies[code] });
    console.log(`[Lobby] Created ${code} by ${name}`);
  });

  socket.on('lobby:join', ({ code, name }) => {
    const lobby = getLobby(code);
    if (!lobby) { socket.emit('error', { msg: 'Lobby not found' }); return; }
    if (lobby.players.length >= 8) { socket.emit('error', { msg: 'Lobby full (max 8)' }); return; }
    if (lobby.state !== 'lobby') { socket.emit('error', { msg: 'Game already started' }); return; }

    const player = { id: socket.id, name: name || 'Anonymous', avatar: randomAvatar(), isHost: false, score: 0, ready: false };
    lobby.players.push(player);
    socket.join(code);
    socket.emit('lobby:joined', { code, lobby });
    io.to(code).emit('lobby:update', lobby);
    console.log(`[Lobby] ${name} joined ${code}`);
  });

  socket.on('lobby:ready', () => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === socket.id);
    if (player) { player.ready = !player.ready; io.to(lobby.code).emit('lobby:update', lobby); }
  });

  socket.on('lobby:start', ({ selectedGames }) => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby || lobby.host !== socket.id) return;
    if (lobby.players.length < 2) { socket.emit('error', { msg: 'Need at least 2 players' }); return; }

    const pool = selectedGames && selectedGames.length >= 1 ? selectedGames : GAMES.map(g => g.id);
    lobby.gameQueue = shuffleArray([...pool]);
    lobby.remainingGames = shuffleArray([...pool]);
    lobby.roundIndex = 0;
    lobby.players.forEach(p => { p.score = 0; p.ready = false; });
    startNextGame(lobby);
  });

  socket.on('lobby:kick', ({ targetId }) => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby || lobby.host !== socket.id) return;
    removePlayer(lobby, targetId);
    io.to(targetId).emit('kicked');
    io.to(lobby.code).emit('lobby:update', lobby);
  });

  socket.on('lobby:close', () => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby || lobby.host !== socket.id) return;
    clearTimeout(lobby.gameTimer);
    clearTimeout(lobby.previewTimer);
    io.to(lobby.code).emit('lobby:closed', { reason: 'Host closed the game.' });
    // Disconnect all from room
    io.in(lobby.code).socketsLeave(lobby.code);
    delete lobbies[lobby.code];
    console.log(`[Lobby] ${lobby.code} closed by host`);
  });

  socket.on('lobby:leave', () => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === socket.id);
    removePlayer(lobby, socket.id);
    socket.leave(lobby.code);
    if (player) io.to(lobby.code).emit('chat:message', { sender: 'System', avatar: '⚙️', message: `${player.name} left the game`, timestamp: Date.now() });
    io.to(lobby.code).emit('lobby:update', lobby);
    socket.emit('lobby:left');
    if (lobby.players.length === 0) {
      clearTimeout(lobby.gameTimer);
      clearTimeout(lobby.previewTimer);
      delete lobbies[lobby.code];
    }
  });

  // ── Game Actions ──
  socket.on('game:action', ({ action, payload }) => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby || lobby.state !== 'game') return;
    const data = lobby.gameData;

    switch (data.type) {
      case 'room_numbers':
        if (action === 'guess') {
          if (!data.guesses[socket.id]) data.guesses[socket.id] = {};
          data.guesses[socket.id][payload.targetId] = payload.room;
        }
        break;
      case 'bomb_defusal':
        if (action === 'submit_code') data.submissions[socket.id] = payload.code;
        break;
      case 'prisoners_dilemma':
        if (action === 'vote') data.votes[socket.id] = payload.choice; // 'cooperate' | 'betray'
        break;
      case 'odd_one_out': case 'secret_word': case 'spy_hunt': case 'fake_news':
        if (action === 'vote') data.votes[socket.id] = payload.targetId;
        break;
      case 'hot_seat':
        if (action === 'answer') data.answers[data.questions[data.currentQ]] = { player: socket.id, answer: payload.answer };
        if (action === 'vote') {
          if (!data.votes[data.currentQ]) data.votes[data.currentQ] = {};
          data.votes[data.currentQ][socket.id] = payload.vote;
        }
        break;
      case 'chain_lie':
        if (action === 'pass') {
          data.passed[socket.id] = payload.message;
          data.currentIdx++;
          if (data.currentIdx < data.chain.length) {
            io.to(data.chain[data.currentIdx]).emit('chain_lie:receive', { message: payload.message });
          } else {
            resolveGame(lobby);
          }
        }
        break;
      case 'consensus':
        if (action === 'answer') data.answers[socket.id] = payload.answer;
        break;
      case 'color_grid':
        if (action === 'submit') data.submissions[socket.id] = payload.grid;
        break;
      case 'auction':
        if (action === 'bid') {
          if (!data.bids[socket.id]) data.bids[socket.id] = {};
          data.bids[socket.id][payload.itemIndex] = payload.amount;
        }
        break;
      case 'alibi':
        if (action === 'vote') data.votes[socket.id] = payload.isCriminal;
        if (action === 'question') data.questions.push({ asker: socket.id, question: payload.question });
        if (action === 'answer') data.answers[payload.questionIndex] = payload.answer;
        break;
      case 'password_game':
        if (action === 'clue') data.clues.push({ giver: socket.id, clue: payload.clue });
        if (action === 'guess') data.guesses[socket.id] = payload.guess;
        break;
      default: break;
    }

    // Broadcast non-private action to room
    if (!['bomb_defusal', 'room_numbers'].includes(data.type)) {
      io.to(lobby.code).emit('game:state_update', {
        type: data.type,
        votes: data.votes,
        answers: data.answers,
        clues: data.clues,
        questions: data.questions,
        currentIdx: data.currentIdx
      });
    }

    // Check if all players have acted
    const actionCount = Object.keys(data.votes || data.answers || data.submissions || {}).length;
    if (actionCount >= lobby.players.length && ['prisoners_dilemma','consensus','color_grid'].includes(data.type)) {
      resolveGame(lobby);
    }
  });

  socket.on('game:force_resolve', () => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby || lobby.host !== socket.id) return;
    resolveGame(lobby);
  });

  // ── Chat ──
  socket.on('chat:message', ({ message }) => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === socket.id);
    const msg = { sender: player?.name || 'Unknown', avatar: player?.avatar, message, timestamp: Date.now() };
    lobby.chatMessages.push(msg);
    if (lobby.chatMessages.length > 100) lobby.chatMessages.shift();
    io.to(lobby.code).emit('chat:message', msg);
  });

  // ── WebRTC Signaling ──
  socket.on('webrtc:offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc:offer', { fromId: socket.id, offer });
  });
  socket.on('webrtc:answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc:answer', { fromId: socket.id, answer });
  });
  socket.on('webrtc:ice_candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc:ice_candidate', { fromId: socket.id, candidate });
  });
  socket.on('webrtc:call_request', ({ targetId }) => {
    io.to(targetId).emit('webrtc:call_request', { fromId: socket.id });
  });
  socket.on('webrtc:call_end', ({ targetId }) => {
    io.to(targetId).emit('webrtc:call_end', { fromId: socket.id });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const lobby = getPlayerLobby(socket.id);
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === socket.id);
    removePlayer(lobby, socket.id);
    io.to(lobby.code).emit('lobby:update', lobby);
    if (player) io.to(lobby.code).emit('chat:message', { sender: 'System', avatar: '⚙️', message: `${player.name} left the game`, timestamp: Date.now() });
    if (lobby.players.length === 0) {
      clearTimeout(lobby.gameTimer);
      clearTimeout(lobby.previewTimer);
      delete lobbies[lobby.code];
      console.log(`[Lobby] ${lobby.code} deleted (empty)`);
    }
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Scamline server running', lobbies: Object.keys(lobbies).length }));
app.get('/games', (req, res) => res.json(GAMES));
app.get('/lobby/:code', (req, res) => {
  const lobby = getLobby(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'Not found' });
  res.json({ code: lobby.code, playerCount: lobby.players.length, state: lobby.state });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🎮 Scamline server on port ${PORT}`));
