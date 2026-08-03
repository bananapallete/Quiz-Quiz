'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const store = require('./store');
const { defaultQuestions, defaultSettings, practicePuzzle } = require('./defaultQuiz');

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = 'admin1234';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

// 인터넷에 공개 배포할 때 기본 비밀번호를 그대로 쓰면 누구나 /admin 에 들어와
// 진행을 가로챌 수 있으므로 아예 실행을 막는다. (집 안 와이파이용 로컬 실행은 그대로 허용)
if (IS_PRODUCTION && ADMIN_PASSWORD === DEFAULT_PASSWORD) {
  console.error(
    [
      '',
      '❌ 관리자 비밀번호를 설정해야 배포할 수 있습니다.',
      '',
      '   기본 비밀번호(admin1234)는 공개된 값이라, 그대로 두면',
      '   누구나 /admin 에 접속해 퀴즈 진행을 가로챌 수 있습니다.',
      '',
      '   호스팅 서비스의 환경변수(Environment Variables)에',
      '   ADMIN_PASSWORD = <직접 정한 비밀번호>',
      '   를 추가한 뒤 다시 배포해 주세요.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
// 문제/보기 이미지를 base64 로 담아 보낼 수 있도록 기본 1MB 제한을 늘려둔다.
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 10 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
app.get('/health', (req, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ *
 * 상태
 * ------------------------------------------------------------------ */

const state = {
  settings: { ...defaultSettings },
  questions: JSON.parse(JSON.stringify(defaultQuestions)),
  players: {}, // nickKey -> { key, nick, score, connected, socketId, joinedAt }
  hearts: {}, // questionId -> number
  played: {}, // questionId -> true
  phase: 'lobby', // lobby | countdown | question | result | practice
  round: null,
  rankingVisible: false,
};

const timers = { countdown: null, hint: null, end: null };

function clearRoundTimers() {
  for (const k of Object.keys(timers)) {
    if (timers[k]) clearTimeout(timers[k]);
    timers[k] = null;
  }
}

/* ------------------------------------------------------------------ *
 * 저장 / 복원
 * ------------------------------------------------------------------ */

function persist() {
  store.save({
    settings: state.settings,
    questions: state.questions,
    hearts: state.hearts,
    played: state.played,
    players: Object.values(state.players).map((p) => ({
      key: p.key,
      nick: p.nick,
      score: p.score,
      joinedAt: p.joinedAt,
    })),
  });
}

function restore() {
  const saved = store.load();
  if (!saved) return;
  if (saved.settings) state.settings = { ...defaultSettings, ...saved.settings };
  if (Array.isArray(saved.questions) && saved.questions.length) {
    state.questions = normalizeQuestions(saved.questions);
  }
  if (saved.hearts) state.hearts = saved.hearts;
  if (saved.played) state.played = saved.played;
  if (Array.isArray(saved.players)) {
    for (const p of saved.players) {
      if (!p || !p.key) continue;
      state.players[p.key] = {
        key: p.key,
        nick: p.nick,
        score: Number(p.score) || 0,
        connected: false,
        socketId: null,
        joinedAt: p.joinedAt || Date.now(),
      };
    }
  }
  console.log('[state] 이전 세션을 복원했습니다. 참가자 %d명', Object.keys(state.players).length);
}

/** 저장된 문제 배열을 16칸 형태로 보정한다. */
function normalizeQuestions(list) {
  const out = [];
  for (let i = 0; i < 16; i++) {
    const base = defaultQuestions[i];
    const q = list.find((x) => x && x.index === i) || list[i] || base;
    out.push({
      id: q.id || 'q' + (i + 1),
      index: i,
      title: q.title || base.title,
      subtitle: q.subtitle != null ? q.subtitle : base.subtitle,
      type: ['choice', 'short', 'puzzle'].includes(q.type) ? q.type : 'choice',
      text: q.text || '',
      image: clampImage(q.image),
      timeLimit: clampInt(q.timeLimit, 5, 600, 30),
      hint: q.hint || '',
      explanation: String(q.explanation || '').slice(0, 500),
      doublePoints: !!q.doublePoints,
      options: normalizeOptions(q.options),
      answerIndex: clampInt(q.answerIndex, 0, 5, 0),
      answers: Array.isArray(q.answers) ? q.answers : [],
      pairs: normalizePairs(q.pairs),
    });
  }
  return out;
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 업로드 이미지는 base64 데이터 URL 로 저장한다. 압축한 사진 몇 장 정도를 넉넉히
// 허용하되, 이상하게 큰 값이 상태 파일에 쌓이는 것은 막아둔다.
const MAX_IMAGE_CHARS = 3_000_000;

function clampImage(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_IMAGE_CHARS) return '';
  return s;
}

/** 보기(options)를 {text, image} 형태로 통일한다. 예전 버전(문자열 배열)도 그대로 읽을 수 있게 둔다. */
function normalizeOptions(options) {
  if (!Array.isArray(options)) return ['', '', '', ''].map((t) => ({ text: t, image: '' }));
  return options.slice(0, 6).map((o) => normalizeCard(o, 120));
}

/** 퍼즐 카드(왼쪽/오른쪽 한 장)를 {text, image} 형태로 통일한다. */
function normalizeCard(c, maxLen) {
  if (typeof c === 'string') return { text: c.slice(0, maxLen), image: '' };
  return { text: String((c && c.text) || '').slice(0, maxLen), image: clampImage(c && c.image) };
}

/** 퍼즐 짝(pairs)을 {left:{text,image}, right:{text,image}} 형태로 통일한다. */
function normalizePairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .map((p) => ({ left: normalizeCard(p && p.left, 60), right: normalizeCard(p && p.right, 60) }))
    .filter((p) => p.left.text.trim() !== '' && p.right.text.trim() !== '')
    .slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * 유틸
 * ------------------------------------------------------------------ */

function nickKey(nick) {
  return String(nick || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeAnswerText(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,!?~'"’“”·・\-_/\\]/g, '');
}

function findQuestion(id) {
  return state.questions.find((q) => q.id === id) || null;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function connectedPlayers() {
  return Object.values(state.players).filter((p) => p.connected);
}

function rankingList() {
  return Object.values(state.players)
    .slice()
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((p, i) => ({ rank: i + 1, nick: p.nick, score: p.score, connected: p.connected }));
}

/* ------------------------------------------------------------------ *
 * 클라이언트로 보낼 페이로드
 * ------------------------------------------------------------------ */

/** 참가자용 보드 (정답 정보 없음) */
function boardPayload() {
  return state.questions.map((q) => ({
    id: q.id,
    index: q.index,
    title: q.title,
    subtitle: q.subtitle,
    type: q.type,
    hearts: state.hearts[q.id] || 0,
    played: !!state.played[q.id],
    doublePoints: !!q.doublePoints,
  }));
}

/** 진행 중인 문제를 참가자에게 보낼 형태로 변환 (정답 제거) */
function publicQuestion(q, round) {
  const base = {
    id: q.id,
    index: q.index,
    title: q.title,
    subtitle: q.subtitle,
    type: q.type,
    text: q.text,
    image: q.image || '',
    timeLimit: round.timeLimit,
    doublePoints: round.doublePoints,
  };
  if (q.type === 'choice') {
    // 렌더링 순서가 아니라 원래 보기 번호(i)를 같이 보내야, 빈 보기를 건너뛰어도
    // 제출값이 서버가 저장한 answerIndex 와 정확히 맞는다.
    base.options = q.options
      .map((o, i) => ({ i, text: o.text, image: o.image || '' }))
      .filter((o) => String(o.text).trim() !== '');
  } else if (q.type === 'puzzle') {
    base.lefts = q.pairs.map((p, i) => ({ i, text: p.left.text, image: p.left.image || '' }));
    base.rights = round.rightOrder.map((i) => ({
      i,
      text: q.pairs[i].right.text,
      image: q.pairs[i].right.image || '',
    }));
  }
  return base;
}

function correctAnswerText(q) {
  if (q.type === 'choice') return (q.options[q.answerIndex] && q.options[q.answerIndex].text) || '';
  if (q.type === 'short') return (q.answers || []).join(' / ');
  if (q.type === 'puzzle') return q.pairs.map((p) => `${p.left.text} → ${p.right.text}`).join(', ');
  return '';
}

/**
 * 결과 화면에서 보여줄 전체 보기/카드 해설을 만든다.
 * - choice : 1~n번 보기를 전부 보여주고 정답 표시
 * - puzzle : 짝지어진 카드를 전부 보여줌
 */
function resultBreakdown(q) {
  if (q.type === 'choice') {
    return {
      options: q.options
        .map((o, i) => ({ i, text: o.text, image: o.image || '', correct: i === q.answerIndex }))
        .filter((o) => o.text.trim() !== ''),
    };
  }
  if (q.type === 'puzzle') {
    return {
      pairs: q.pairs.map((p) => ({
        left: { text: p.left.text, image: p.left.image || '' },
        right: { text: p.right.text, image: p.right.image || '' },
      })),
    };
  }
  return {};
}

/** 참가자에게 그대로 보여줄 참가자 명단 (점수는 뺀 닉네임 + 접속 상태만) */
function playerRoster() {
  return Object.values(state.players)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ nick: p.nick, connected: p.connected }));
}

/** 소켓 하나에 현재 상태 전체를 보낸다. */
function syncSocket(socket) {
  const player = socket.data.playerKey ? state.players[socket.data.playerKey] : null;
  socket.emit('state:sync', {
    serverNow: Date.now(),
    phase: state.phase,
    board: boardPayload(),
    playerCount: connectedPlayers().length,
    playerRoster: playerRoster(),
    rankingVisible: state.rankingVisible,
    ranking: state.rankingVisible ? rankingList() : null,
    me: player ? { nick: player.nick, score: player.score } : null,
    round: activeRoundPayload(player),
    practice: state.phase === 'practice' ? practicePuzzle : null,
    settings: publicSettings(),
  });
}

function publicSettings() {
  const s = state.settings;
  return {
    scoreFirst: s.scoreFirst,
    scoreTop: s.scoreTop,
    scoreTopUntilRank: s.scoreTopUntilRank,
    scoreRest: s.scoreRest,
    countdownSeconds: s.countdownSeconds,
    hintBeforeSeconds: s.hintBeforeSeconds,
  };
}

/** 재접속한 참가자가 진행 중인 문제에 바로 합류할 수 있도록 */
function activeRoundPayload(player) {
  const round = state.round;
  if (!round) return null;
  const q = findQuestion(round.questionId);
  if (!q) return null;

  if (state.phase === 'countdown') {
    return {
      stage: 'countdown',
      questionId: q.id,
      title: q.title,
      subtitle: q.subtitle,
      type: q.type,
      startsAt: round.startsAt,
      serverNow: Date.now(),
    };
  }
  if (state.phase === 'question') {
    const mySub = player ? round.submissions[player.key] : null;
    return {
      stage: 'question',
      question: publicQuestion(q, round),
      startedAt: round.startedAt,
      serverNow: Date.now(),
      hint: round.hintSent ? q.hint : null,
      submittedCount: Object.keys(round.submissions).length,
      mySubmitted: !!mySub,
      myAnswer: mySub ? mySub.answer : null,
    };
  }
  if (state.phase === 'result' && round.results) {
    return Object.assign(
      {
        stage: 'result',
        questionId: q.id,
        title: q.title,
        subtitle: q.subtitle,
        type: q.type,
        text: q.text,
        image: q.image || '',
        correctAnswer: correctAnswerText(q),
        explanation: q.explanation || '',
        doublePoints: round.doublePoints,
        results: round.results,
        me: player ? round.results.find((r) => r.key === player.key) || null : null,
      },
      resultBreakdown(q)
    );
  }
  return null;
}

function broadcastBoard() {
  io.emit('board:update', { board: boardPayload() });
}

function broadcastPlayers() {
  const count = connectedPlayers().length;
  io.to('players').emit('players:count', { count });
  io.to('players').emit('players:roster', { players: playerRoster() });
  io.to('admins').emit('admin:players', {
    count,
    players: Object.values(state.players)
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p) => ({ key: p.key, nick: p.nick, score: p.score, connected: p.connected })),
  });
}

function adminState() {
  return {
    phase: state.phase,
    settings: state.settings,
    questions: state.questions,
    board: boardPayload(),
    rankingVisible: state.rankingVisible,
    round: state.round
      ? {
          questionId: state.round.questionId,
          startedAt: state.round.startedAt,
          timeLimit: state.round.timeLimit,
          doublePoints: state.round.doublePoints,
          submitted: Object.keys(state.round.submissions).length,
          results: state.round.results,
          serverNow: Date.now(),
        }
      : null,
  };
}

function broadcastAdmin() {
  io.to('admins').emit('admin:state', adminState());
}

/* ------------------------------------------------------------------ *
 * 라운드 진행
 * ------------------------------------------------------------------ */

function startCountdown(questionId) {
  const q = findQuestion(questionId);
  if (!q) return { ok: false, error: '문제를 찾을 수 없습니다.' };
  if (state.phase === 'countdown' || state.phase === 'question') {
    return { ok: false, error: '이미 진행 중인 문제가 있습니다.' };
  }
  if (q.type === 'choice' && q.options.filter((o) => o && String(o.text).trim()).length < 2) {
    return { ok: false, error: '객관식 보기를 2개 이상 입력해 주세요.' };
  }
  if (q.type === 'short' && (!q.answers || !q.answers.length)) {
    return { ok: false, error: '주관식 정답을 1개 이상 입력해 주세요.' };
  }
  if (q.type === 'puzzle' && q.pairs.length < 2) {
    return { ok: false, error: '퍼즐 짝을 2개 이상 입력해 주세요.' };
  }

  clearRoundTimers();
  const seconds = clampInt(state.settings.countdownSeconds, 1, 10, 3);
  state.phase = 'countdown';
  state.rankingVisible = false;
  state.round = {
    questionId: q.id,
    startsAt: Date.now() + seconds * 1000,
    startedAt: null,
    timeLimit: q.timeLimit,
    doublePoints: !!q.doublePoints,
    rightOrder: q.type === 'puzzle' ? shuffle(q.pairs.map((_, i) => i)) : [],
    submissions: {},
    hintSent: false,
    ended: false,
    results: null,
  };

  io.emit('ranking:hide');
  io.emit('round:countdown', {
    questionId: q.id,
    title: q.title,
    subtitle: q.subtitle,
    type: q.type,
    seconds,
    startsAt: state.round.startsAt,
    serverNow: Date.now(),
  });
  broadcastAdmin();

  timers.countdown = setTimeout(() => beginQuestion(), seconds * 1000);
  return { ok: true };
}

function beginQuestion() {
  const round = state.round;
  if (!round) return;
  const q = findQuestion(round.questionId);
  if (!q) return;

  round.startedAt = Date.now();
  state.phase = 'question';

  io.emit('round:start', {
    question: publicQuestion(q, round),
    startedAt: round.startedAt,
    serverNow: Date.now(),
  });
  broadcastAdmin();

  const hintDelay = Math.max(
    0,
    (round.timeLimit - clampInt(state.settings.hintBeforeSeconds, 1, 60, 5)) * 1000
  );
  if (q.hint && String(q.hint).trim()) {
    timers.hint = setTimeout(() => {
      if (!state.round || state.round !== round || round.ended) return;
      round.hintSent = true;
      io.emit('round:hint', { hint: q.hint });
    }, hintDelay);
  }

  // 클라이언트 자동 제출을 위한 여유시간 1.2초
  timers.end = setTimeout(() => endRound('시간 종료'), round.timeLimit * 1000 + 1200);
}

function submitAnswer(player, answer) {
  const round = state.round;
  if (!round || state.phase !== 'question' || round.ended) {
    return { ok: false, error: '지금은 제출할 수 없습니다.' };
  }
  if (round.submissions[player.key]) {
    return { ok: false, error: '이미 제출했습니다.' };
  }
  const q = findQuestion(round.questionId);
  if (!q) return { ok: false, error: '문제를 찾을 수 없습니다.' };

  const elapsed = Math.min(Math.max(0, Date.now() - round.startedAt), round.timeLimit * 1000);
  round.submissions[player.key] = {
    key: player.key,
    nick: player.nick,
    answer,
    elapsed,
    correct: gradeAnswer(q, answer),
  };

  io.emit('round:submitted', { count: Object.keys(round.submissions).length });
  broadcastAdmin();

  // 접속 중인 참가자가 모두 제출했으면 즉시 채점
  const waiting = connectedPlayers().filter((p) => !round.submissions[p.key]);
  if (waiting.length === 0 && connectedPlayers().length > 0) {
    setTimeout(() => {
      if (state.round === round && !round.ended) endRound('전원 제출 완료');
    }, 400);
  }
  return { ok: true, elapsed };
}

function gradeAnswer(q, answer) {
  if (answer == null) return false;
  if (q.type === 'choice') {
    return Number(answer) === Number(q.answerIndex);
  }
  if (q.type === 'short') {
    const given = normalizeAnswerText(answer);
    if (!given) return false;
    return (q.answers || []).some((a) => normalizeAnswerText(a) === given);
  }
  if (q.type === 'puzzle') {
    if (!Array.isArray(answer) || answer.length !== q.pairs.length) return false;
    return q.pairs.every((_, i) => Number(answer[i]) === i);
  }
  return false;
}

function endRound(reason) {
  const round = state.round;
  if (!round || round.ended) return;
  clearRoundTimers();
  round.ended = true;

  const q = findQuestion(round.questionId);
  const s = state.settings;
  const multiplier = round.doublePoints ? 2 : 1;

  const subs = Object.values(round.submissions);
  const correct = subs.filter((x) => x.correct).sort((a, b) => a.elapsed - b.elapsed);

  const results = [];
  correct.forEach((sub, i) => {
    let base;
    if (i === 0) base = s.scoreFirst;
    else if (i < s.scoreTopUntilRank) base = s.scoreTop;
    else base = s.scoreRest;
    const gained = base * multiplier;
    const player = state.players[sub.key];
    if (player) player.score += gained;
    results.push({
      key: sub.key,
      nick: sub.nick,
      rank: i + 1,
      correct: true,
      elapsed: sub.elapsed,
      gained,
      total: player ? player.score : gained,
    });
  });
  subs
    .filter((x) => !x.correct)
    .sort((a, b) => a.elapsed - b.elapsed)
    .forEach((sub) => {
      const player = state.players[sub.key];
      results.push({
        key: sub.key,
        nick: sub.nick,
        rank: null,
        correct: false,
        elapsed: sub.elapsed,
        gained: 0,
        total: player ? player.score : 0,
      });
    });

  round.results = results;
  state.played[round.questionId] = true;
  state.phase = 'result';
  persist();

  io.emit(
    'round:end',
    Object.assign(
      {
        questionId: round.questionId,
        title: q ? q.title : '',
        subtitle: q ? q.subtitle : '',
        type: q ? q.type : '',
        text: q ? q.text : '',
        image: q ? q.image || '' : '',
        correctAnswer: q ? correctAnswerText(q) : '',
        explanation: q ? q.explanation || '' : '',
        doublePoints: round.doublePoints,
        reason: reason || '',
        results,
      },
      q ? resultBreakdown(q) : {}
    )
  );
  broadcastBoard();
  broadcastPlayers();
  broadcastAdmin();
}

function backToBoard() {
  clearRoundTimers();
  state.round = null;
  state.phase = 'lobby';
  io.emit('board:show', { board: boardPayload() });
  broadcastAdmin();
}

/* ------------------------------------------------------------------ *
 * 하트 (실시간 반응)
 * ------------------------------------------------------------------ */

const heartBuffer = {}; // questionId -> 이번 배치에서 늘어난 수
let heartFlushTimer = null;

function flushHearts() {
  heartFlushTimer = null;
  const deltas = heartBuffer;
  if (!Object.keys(deltas).length) return;
  const payload = Object.keys(deltas).map((id) => ({
    id,
    delta: deltas[id],
    total: state.hearts[id] || 0,
  }));
  for (const id of Object.keys(deltas)) delete heartBuffer[id];
  io.emit('hearts:update', { items: payload });
}

function tapHeart(questionId) {
  if (!findQuestion(questionId)) return;
  state.hearts[questionId] = (state.hearts[questionId] || 0) + 1;
  heartBuffer[questionId] = (heartBuffer[questionId] || 0) + 1;
  if (!heartFlushTimer) heartFlushTimer = setTimeout(flushHearts, 120);
  schedulePersist();
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 2000);
}

/* ------------------------------------------------------------------ *
 * 소켓
 * ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  socket.data.isAdmin = false;
  socket.data.playerKey = null;
  socket.data.tapTimes = [];

  socket.emit('hello', { serverNow: Date.now() });
  syncSocket(socket);

  /* ---------- 참가자 ---------- */

  socket.on('player:join', (payload, cb) => {
    const raw = String((payload && payload.nick) || '').trim().replace(/\s+/g, ' ');
    if (raw.length < 1 || raw.length > 12) {
      return respond(cb, { ok: false, error: '닉네임은 1~12자로 입력해 주세요.' });
    }
    const key = nickKey(raw);
    let player = state.players[key];
    let returning = false;

    if (player) {
      returning = true;
      // 다른 기기에서 같은 닉네임으로 들어오면 이전 연결은 밀어낸다.
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.data.playerKey = null;
          old.emit('player:kicked', { reason: '같은 닉네임으로 다른 기기에서 접속했습니다.' });
        }
      }
      player.nick = raw; // 대소문자 등 표기 갱신
      player.connected = true;
      player.socketId = socket.id;
    } else {
      player = {
        key,
        nick: raw,
        score: 0,
        connected: true,
        socketId: socket.id,
        joinedAt: Date.now(),
      };
      state.players[key] = player;
    }

    socket.data.playerKey = key;
    socket.join('players');
    persist();
    broadcastPlayers();
    respond(cb, {
      ok: true,
      returning,
      me: { nick: player.nick, score: player.score },
    });
    syncSocket(socket);
  });

  socket.on('heart:tap', (payload) => {
    if (!socket.data.playerKey && !socket.data.isAdmin) return;
    const now = Date.now();
    socket.data.tapTimes = socket.data.tapTimes.filter((t) => now - t < 1000);
    if (socket.data.tapTimes.length >= 10) return; // 초당 10회 제한
    socket.data.tapTimes.push(now);
    tapHeart(payload && payload.questionId);
  });

  socket.on('answer:submit', (payload, cb) => {
    const player = socket.data.playerKey ? state.players[socket.data.playerKey] : null;
    if (!player) return respond(cb, { ok: false, error: '먼저 닉네임을 입력해 주세요.' });
    respond(cb, submitAnswer(player, payload ? payload.answer : null));
  });

  /* ---------- 관리자 ---------- */

  socket.on('admin:auth', (payload, cb) => {
    const pw = String((payload && payload.password) || '');
    if (pw !== ADMIN_PASSWORD) {
      return respond(cb, { ok: false, error: '비밀번호가 올바르지 않습니다.' });
    }
    socket.data.isAdmin = true;
    socket.join('admins');
    respond(cb, { ok: true });
    socket.emit('admin:state', adminState());
    broadcastPlayers();
    return undefined;
  });

  function requireAdmin(cb) {
    if (!socket.data.isAdmin) {
      respond(cb, { ok: false, error: '관리자 인증이 필요합니다.' });
      return false;
    }
    return true;
  }

  socket.on('admin:startQuestion', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    respond(cb, startCountdown(payload && payload.questionId));
  });

  socket.on('admin:endRound', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    if (!state.round || state.round.ended) {
      return respond(cb, { ok: false, error: '진행 중인 문제가 없습니다.' });
    }
    if (state.phase === 'countdown') {
      // 카운트다운 중 취소
      clearRoundTimers();
      state.round = null;
      state.phase = 'lobby';
      io.emit('round:cancel');
      io.emit('board:show', { board: boardPayload() });
      broadcastAdmin();
      return respond(cb, { ok: true, cancelled: true });
    }
    endRound('진행자 종료');
    return respond(cb, { ok: true });
  });

  socket.on('admin:backToBoard', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    backToBoard();
    respond(cb, { ok: true });
  });

  socket.on('admin:ranking', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const visible = !!(payload && payload.visible);
    state.rankingVisible = visible;
    if (visible) {
      io.emit('ranking:show', { ranking: rankingList() });
    } else {
      io.emit('ranking:hide');
    }
    broadcastAdmin();
    respond(cb, { ok: true });
  });

  socket.on('admin:saveQuestion', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const incoming = payload && payload.question;
    if (!incoming || !incoming.id) return respond(cb, { ok: false, error: '잘못된 요청입니다.' });
    const idx = state.questions.findIndex((q) => q.id === incoming.id);
    if (idx === -1) return respond(cb, { ok: false, error: '문제를 찾을 수 없습니다.' });

    const q = state.questions[idx];
    q.title = String(incoming.title || '').slice(0, 40) || q.title;
    q.subtitle = String(incoming.subtitle || '').slice(0, 60);
    q.type = ['choice', 'short', 'puzzle'].includes(incoming.type) ? incoming.type : q.type;
    q.text = String(incoming.text || '').slice(0, 500);
    q.image = clampImage(incoming.image);
    q.timeLimit = clampInt(incoming.timeLimit, 5, 600, q.timeLimit);
    q.hint = String(incoming.hint || '').slice(0, 300);
    q.explanation = String(incoming.explanation || '').slice(0, 500);
    q.doublePoints = !!incoming.doublePoints;
    q.options = Array.isArray(incoming.options) ? normalizeOptions(incoming.options) : q.options;
    q.answerIndex = clampInt(incoming.answerIndex, 0, Math.max(0, q.options.length - 1), 0);
    q.answers = Array.isArray(incoming.answers)
      ? incoming.answers.map((a) => String(a).slice(0, 120)).filter((a) => a.trim() !== '')
      : q.answers;
    q.pairs = Array.isArray(incoming.pairs) ? normalizePairs(incoming.pairs) : q.pairs;

    persist();
    broadcastBoard();
    broadcastAdmin();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:setDouble', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const q = findQuestion(payload && payload.questionId);
    if (!q) return respond(cb, { ok: false, error: '문제를 찾을 수 없습니다.' });
    q.doublePoints = !!payload.value;
    if (state.round && state.round.questionId === q.id && !state.round.ended) {
      state.round.doublePoints = q.doublePoints;
      io.emit('round:double', { doublePoints: q.doublePoints });
    }
    persist();
    broadcastBoard();
    broadcastAdmin();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:saveSettings', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const s = payload && payload.settings;
    if (!s) return respond(cb, { ok: false, error: '잘못된 요청입니다.' });
    state.settings.scoreFirst = clampInt(s.scoreFirst, 0, 100, state.settings.scoreFirst);
    state.settings.scoreTop = clampInt(s.scoreTop, 0, 100, state.settings.scoreTop);
    state.settings.scoreTopUntilRank = clampInt(s.scoreTopUntilRank, 1, 50, state.settings.scoreTopUntilRank);
    state.settings.scoreRest = clampInt(s.scoreRest, 0, 100, state.settings.scoreRest);
    state.settings.countdownSeconds = clampInt(s.countdownSeconds, 1, 10, state.settings.countdownSeconds);
    state.settings.hintBeforeSeconds = clampInt(s.hintBeforeSeconds, 1, 60, state.settings.hintBeforeSeconds);
    persist();
    broadcastAdmin();
    io.emit('settings:update', publicSettings());
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:practice', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const on = !!(payload && payload.on);
    if (on) {
      if (state.phase === 'countdown' || state.phase === 'question') {
        return respond(cb, { ok: false, error: '문제 진행 중에는 연습 화면을 열 수 없습니다.' });
      }
      state.phase = 'practice';
      io.emit('practice:start', { puzzle: practicePuzzle });
    } else {
      state.phase = 'lobby';
      state.round = null;
      io.emit('practice:end');
      io.emit('board:show', { board: boardPayload() });
    }
    broadcastAdmin();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:adjustScore', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const p = state.players[(payload && payload.key) || ''];
    if (!p) return respond(cb, { ok: false, error: '참가자를 찾을 수 없습니다.' });
    const delta = clampInt(payload.delta, -1000, 1000, 0);
    p.score = Math.max(0, p.score + delta);
    persist();
    broadcastPlayers();
    if (state.rankingVisible) io.emit('ranking:show', { ranking: rankingList() });
    notifyPlayerScore(p);
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:removePlayer', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const key = (payload && payload.key) || '';
    const p = state.players[key];
    if (!p) return respond(cb, { ok: false, error: '참가자를 찾을 수 없습니다.' });
    if (p.socketId) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.data.playerKey = null;
        s.emit('player:kicked', { reason: '진행자가 참가를 종료했습니다.' });
      }
    }
    delete state.players[key];
    persist();
    broadcastPlayers();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:reset', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const what = (payload && payload.what) || '';
    if (what === 'hearts') {
      state.hearts = {};
    } else if (what === 'scores') {
      Object.values(state.players).forEach((p) => {
        p.score = 0;
      });
      Object.values(state.players).forEach(notifyPlayerScore);
    } else if (what === 'played') {
      state.played = {};
    } else if (what === 'players') {
      io.to('players').emit('player:kicked', { reason: '진행자가 게임을 초기화했습니다.' });
      for (const s of io.sockets.sockets.values()) s.data.playerKey = null;
      state.players = {};
    } else if (what === 'all') {
      state.hearts = {};
      state.played = {};
      io.to('players').emit('player:kicked', { reason: '진행자가 게임을 초기화했습니다.' });
      for (const s of io.sockets.sockets.values()) s.data.playerKey = null;
      state.players = {};
      clearRoundTimers();
      state.round = null;
      state.phase = 'lobby';
      state.rankingVisible = false;
      io.emit('ranking:hide');
      io.emit('board:show', { board: boardPayload() });
    } else {
      return respond(cb, { ok: false, error: '알 수 없는 초기화 대상입니다.' });
    }
    persist();
    broadcastBoard();
    broadcastPlayers();
    broadcastAdmin();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:togglePlayed', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const q = findQuestion(payload && payload.questionId);
    if (!q) return respond(cb, { ok: false, error: '문제를 찾을 수 없습니다.' });
    if (state.played[q.id]) delete state.played[q.id];
    else state.played[q.id] = true;
    persist();
    broadcastBoard();
    broadcastAdmin();
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('disconnect', () => {
    const key = socket.data.playerKey;
    if (key && state.players[key] && state.players[key].socketId === socket.id) {
      state.players[key].connected = false;
      state.players[key].socketId = null;
      broadcastPlayers();
    }
  });
});

function notifyPlayerScore(player) {
  if (!player.socketId) return;
  const s = io.sockets.sockets.get(player.socketId);
  if (s) s.emit('me:update', { nick: player.nick, score: player.score });
}

function respond(cb, data) {
  if (typeof cb === 'function') cb(data);
  return data;
}

/* ------------------------------------------------------------------ *
 * 시작
 * ------------------------------------------------------------------ */

restore();

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log('\n🎉  Quiz-Quiz 서버가 켜졌습니다!  (포트 %d)\n', PORT);
  if (IS_PRODUCTION) {
    // 배포 환경에서는 로그에 비밀번호를 남기지 않는다.
    console.log('  배포 모드로 실행 중입니다. 참가자는 /, 진행자는 /admin 으로 접속하세요.');
    console.log('  관리자 비밀번호 : 환경변수 ADMIN_PASSWORD 에 설정한 값\n');
    return;
  }
  console.log('  참가자(휴대폰) : http://localhost:%d', PORT);
  addrs.forEach((a) => console.log('                   http://%s:%d', a, PORT));
  console.log('  진행자(노트북) : http://localhost:%d/admin', PORT);
  addrs.forEach((a) => console.log('                   http://%s:%d/admin', a, PORT));
  console.log('  관리자 비밀번호 : %s', ADMIN_PASSWORD);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) {
    console.log('  ⚠️  기본 비밀번호입니다. 인터넷에 배포할 때는 ADMIN_PASSWORD 를 꼭 바꿔주세요.');
  }
  console.log('');
});

process.on('SIGINT', () => {
  persist();
  store.saveNow({
    settings: state.settings,
    questions: state.questions,
    hearts: state.hearts,
    played: state.played,
    players: Object.values(state.players).map((p) => ({
      key: p.key,
      nick: p.nick,
      score: p.score,
      joinedAt: p.joinedAt,
    })),
  });
  process.exit(0);
});
