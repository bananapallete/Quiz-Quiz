'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const store = require('./store');
const githubSync = require('./githubSync');
const screenSpec = require('../public/js/screenSpec');
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
// 문제/보기 이미지와 음성 파일을 base64 로 담아 보낼 수 있도록 기본 1MB 제한을 늘려둔다.
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 32 * 1024 * 1024 });

// GitHub 자동 저장 결과를 진행자 화면에 알린다.
githubSync.onResult((ok, detail) => {
  io.to('admins').emit('admin:notice', {
    kind: ok ? 'ok' : 'err',
    msg: ok ? '깃허브에도 저장했어요 ✓' : '깃허브 저장 실패: ' + detail,
  });
});

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
      // HTML 은 항상 서버에 물어보게 해서, 수정 후 새로고침하면 바로 반영되게 한다.
      // (css/js 는 주소 뒤 ?v= 값이 바뀌면 새로 받아간다)
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
// 큰 화면(TV·프로젝터)용 관전 화면. 현재 출제된 문제의 이미지를 크게 보여준다.
app.get('/screen', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'screen.html'));
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
  phase: 'lobby', // lobby | reveal | question | result | practice
  round: null,
  rankingVisible: false,
};

const timers = { hint: null, end: null };

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
  const snapshot = {
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
  };
  store.save(snapshot);
  // 설정돼 있으면 GitHub 배포 브랜치에도 자동 커밋 (없으면 아무 일도 안 함)
  githubSync.schedule(JSON.stringify(snapshot, null, 2));
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
      type: QUESTION_TYPES.includes(q.type) ? q.type : 'choice',
      text: q.text || '',
      cardText: String(q.cardText || '').slice(0, 200),
      image: clampImage(q.image),
      cardImage: clampImage(q.cardImage),
      timeLimit: clampInt(q.timeLimit, 5, 600, 30),
      hint: q.hint || '',
      explanation: String(q.explanation || '').slice(0, 500),
      doublePoints: !!q.doublePoints,
      options: normalizeOptions(q.options),
      answerIndex: clampInt(q.answerIndex, 0, MAX_OPTIONS - 1, 0),
      answers: Array.isArray(q.answers) ? q.answers : [],
      pairs: normalizePairs(q.pairs),
      approxMode: q.approxMode === 'date' ? 'date' : 'number',
      approxTarget: Number.isFinite(Number(q.approxTarget)) ? Number(q.approxTarget) : 0,
      approxUnit: String(q.approxUnit || '').slice(0, 10),
      approxDate: normalizeDate(q.approxDate),
      approxDateStart: normalizeDate(q.approxDateStart),
      approxDateEnd: normalizeDate(q.approxDateEnd),
    });
  }
  return out;
}

const QUESTION_TYPES = ['choice', 'audio', 'short', 'puzzle', 'approx'];
/** 라이브 반응 스티커 개수 (public/js/common.js 의 EMOTES 와 맞춰야 함) */
const EMOTE_COUNT = 5;
const MAX_OPTIONS = 8;
/** 객관식처럼 보기 중 하나를 고르는 유형 (채점 방식이 같다) */
const CHOICE_LIKE = ['choice', 'audio'];

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 'YYYY-MM-DD' 형태만 통과시킨다. */
function normalizeDate(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return s;
}

/** 날짜 문자열을 '1970-01-01 로부터 며칠' 로 바꾼다. 날짜 근사치 계산용. */
function dateToDays(s) {
  const iso = normalizeDate(s);
  if (!iso) return null;
  return Math.round(new Date(iso + 'T00:00:00Z').getTime() / 86400000);
}

// 업로드 이미지/음성은 base64 데이터 URL 로 저장한다. 압축한 사진과 짧은 음성 정도를
// 넉넉히 허용하되, 이상하게 큰 값이 상태 파일에 쌓이는 것은 막아둔다.
const MAX_IMAGE_CHARS = 3_000_000;
const MAX_AUDIO_CHARS = 4_000_000;

function clampImage(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_IMAGE_CHARS) return '';
  return s;
}

function clampAudio(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (!s || s.length > MAX_AUDIO_CHARS) return '';
  // 아이폰 녹음 등 비표준 오디오 MIME(audio/x-m4a)은 브라우저가 재생을 거부한다.
  // 실제 코덱은 AAC(mp4)이므로 표준 MIME 으로 바꿔 저장한다.
  s = s
    .replace(/^data:audio\/x-m4a/i, 'data:audio/mp4')
    .replace(/^data:audio\/m4a/i, 'data:audio/mp4')
    .replace(/^data:audio\/x-mp3/i, 'data:audio/mpeg')
    .replace(/^data:audio\/x-wav/i, 'data:audio/wav');
  return s;
}

/**
 * 보기(options)를 {text, image, audio} 형태로 통일한다.
 * 예전 버전(문자열 배열 / image 만 있던 형태)도 그대로 읽을 수 있게 둔다.
 */
function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    return ['', '', '', ''].map((t) => ({ text: t, image: '', audio: '' }));
  }
  return options.slice(0, MAX_OPTIONS).map((o) => {
    if (typeof o === 'string') return { text: o.slice(0, 120), image: '', audio: '' };
    return {
      text: String((o && o.text) || '').slice(0, 120),
      image: clampImage(o && o.image),
      audio: clampAudio(o && o.audio),
    };
  });
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
    // 글자가 없어도 이미지가 있으면 유효한 카드로 본다 (사진 짝 맞추기 퍼즐)
    .filter((p) => (p.left.text.trim() !== '' || p.left.image) && (p.right.text.trim() !== '' || p.right.image))
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
    // 타일에 보여줄 친구 얼굴 (카드 이미지와 동일)
    faceImage: q.cardImage || '',
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
    faceImage: q.cardImage || '', // 친구 얼굴 (큰 화면 배지 옆 아바타용)
    timeLimit: round.timeLimit,
    doublePoints: round.doublePoints,
  };
  if (CHOICE_LIKE.includes(q.type)) {
    // 렌더링 순서가 아니라 원래 보기 번호(i)를 같이 보내야, 빈 보기를 건너뛰어도
    // 제출값이 서버가 저장한 answerIndex 와 정확히 맞는다.
    base.options = q.options
      .map((o, i) => ({ i, text: o.text, image: o.image || '', audio: o.audio || '' }))
      .filter((o) => String(o.text).trim() !== '' || o.audio || o.image);
  } else if (q.type === 'approx') {
    base.approxMode = q.approxMode;
    base.approxUnit = q.approxUnit || '';
    if (q.approxMode === 'date') {
      base.approxDateStart = q.approxDateStart || '1900-01-01';
      base.approxDateEnd = q.approxDateEnd || '2100-12-31';
    }
    // 정답(approxTarget / approxDate)은 채점 전까지 절대 내려보내지 않는다.
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
  if (CHOICE_LIKE.includes(q.type)) {
    const o = q.options[q.answerIndex];
    const label = (o && o.text) || '';
    return label || (q.answerIndex + 1) + '번';
  }
  if (q.type === 'short') return (q.answers || []).join(' / ');
  if (q.type === 'puzzle') return q.pairs.map((p) => `${p.left.text} → ${p.right.text}`).join(', ');
  if (q.type === 'approx') {
    if (q.approxMode === 'date') return q.approxDate || '';
    return formatNumber(q.approxTarget) + (q.approxUnit || '');
  }
  return '';
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

/** 결과 화면에서 "이 사람이 무엇을 냈는지" 짧게 보여주기 위한 문자열 */
function answerLabel(q, answer) {
  if (!q || answer == null) return '';
  if (CHOICE_LIKE.includes(q.type)) {
    const o = q.options[Number(answer)];
    if (!o) return '';
    return o.text || Number(answer) + 1 + '번';
  }
  if (q.type === 'short') return String(answer).slice(0, 60);
  if (q.type === 'approx') {
    if (q.approxMode === 'date') return normalizeDate(answer) || '';
    const n = Number(answer);
    return Number.isFinite(n) ? formatNumber(n) + (q.approxUnit || '') : '';
  }
  return '';
}

/**
 * 결과 화면에서 보여줄 전체 보기/카드 해설을 만든다.
 * - choice/audio : 1~n번 보기를 전부 보여주고 정답 표시
 * - puzzle       : 짝지어진 카드를 전부 보여줌
 * - approx       : 정답 값
 */
function resultBreakdown(q) {
  if (CHOICE_LIKE.includes(q.type)) {
    return {
      options: q.options
        .map((o, i) => ({
          i,
          text: o.text,
          image: o.image || '',
          audio: o.audio || '',
          correct: i === q.answerIndex,
        }))
        .filter((o) => o.text.trim() !== '' || o.audio || o.image),
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
  if (q.type === 'approx') {
    return {
      approxMode: q.approxMode,
      approxUnit: q.approxUnit || '',
      approxAnswer: q.approxMode === 'date' ? q.approxDate : q.approxTarget,
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
    hintBeforeSeconds: s.hintBeforeSeconds,
    screenStyle: normalizeScreenStyle(s.screenStyle),
  };
}

/** 큰 화면 요소별 표시/크기/여백/두께 설정을 규격에 맞게 정리한다. */
function normalizeScreenStyle(v) {
  return screenSpec.normalize(v);
}

/** 재접속한 참가자가 진행 중인 문제에 바로 합류할 수 있도록 */
function activeRoundPayload(player) {
  const round = state.round;
  if (!round) return null;
  const q = findQuestion(round.questionId);
  if (!q) return null;

  if (state.phase === 'reveal') {
    return Object.assign({ stage: 'reveal' }, revealPayload(q));
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
        faceImage: q.cardImage || '', // 친구 얼굴 (큰 화면 배지 옆 아바타용)
        correctAnswer: correctAnswerText(q),
        explanation: q.explanation || '',
        doublePoints: round.doublePoints,
        results: round.results,
        me: player ? round.results.find((r) => r.key === player.key) || null : null,
        myAnswer: player && round.submissions[player.key] ? round.submissions[player.key].answer : null,
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

/**
 * 진행자가 칸을 고르면 참가자 화면에서 카드가 뒤집히며 문제가 소개된다.
 * 여기서 바로 시작하지 않고, 진행자가 "퀴즈 시작하기"를 누를 때 beginQuestion() 으로 넘어간다.
 */
function revealQuestion(questionId) {
  const q = findQuestion(questionId);
  if (!q) return { ok: false, error: '문제를 찾을 수 없습니다.' };
  if (state.phase === 'reveal' || state.phase === 'question') {
    return { ok: false, error: '이미 진행 중인 문제가 있습니다.' };
  }
  if (CHOICE_LIKE.includes(q.type)) {
    const filled = q.options.filter((o) => o && (String(o.text).trim() || o.audio || o.image));
    if (filled.length < 2) {
      return { ok: false, error: '보기를 2개 이상 입력해 주세요.' };
    }
    const answer = q.options[q.answerIndex];
    if (!answer || !(String(answer.text).trim() || answer.audio || answer.image)) {
      return { ok: false, error: '정답으로 지정한 보기가 비어 있습니다.' };
    }
  }
  if (q.type === 'short' && (!q.answers || !q.answers.length)) {
    return { ok: false, error: '주관식 정답을 1개 이상 입력해 주세요.' };
  }
  if (q.type === 'puzzle' && q.pairs.length < 2) {
    return { ok: false, error: '퍼즐 짝을 2개 이상 입력해 주세요.' };
  }
  if (q.type === 'approx' && q.approxMode === 'date' && !q.approxDate) {
    return { ok: false, error: '날짜 맞추기의 정답 날짜를 입력해 주세요.' };
  }

  clearRoundTimers();
  state.phase = 'reveal';
  state.rankingVisible = false;
  state.round = {
    questionId: q.id,
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
  io.emit('round:reveal', revealPayload(q));
  broadcastAdmin();
  return { ok: true };
}

/** 뒤집힌 카드에 보여줄 내용 (사진 · 부제목 · 제목 · 문제 한 줄) */
function revealPayload(q) {
  return {
    questionId: q.id,
    index: q.index,
    title: q.title,
    subtitle: q.subtitle || '',
    type: q.type,
    image: q.cardImage || q.image || '',
    text: q.cardText || q.text || '',
    hearts: state.hearts[q.id] || 0,
    serverNow: Date.now(),
  };
}

function beginQuestion() {
  const round = state.round;
  if (!round) return { ok: false, error: '진행 중인 문제가 없습니다.' };
  if (state.phase !== 'reveal') {
    return { ok: false, error: '지금은 시작할 수 없습니다.' };
  }
  const q = findQuestion(round.questionId);
  if (!q) return { ok: false, error: '문제를 찾을 수 없습니다.' };

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
  return { ok: true };
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
  const graded = gradeAnswer(q, answer);
  round.submissions[player.key] = {
    key: player.key,
    nick: player.nick,
    answer,
    elapsed,
    correct: graded.correct,
    correctCount: graded.correctCount,
    totalCount: graded.totalCount,
    distance: graded.distance,
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

/**
 * 채점 결과를 공통 형태로 돌려준다.
 *  correct      : 완전 정답 여부
 *  correctCount : 퍼즐에서 맞힌 짝 수 (그 외 유형은 정답이면 1)
 *  totalCount   : 퍼즐 짝 수
 *  distance     : 근사치 유형에서 정답과의 차이 (숫자 / 날짜는 일수). 없으면 null
 */
function gradeAnswer(q, answer) {
  const base = { correct: false, correctCount: 0, totalCount: 1, distance: null };

  if (CHOICE_LIKE.includes(q.type)) {
    if (answer == null) return base;
    const ok = Number(answer) === Number(q.answerIndex);
    return { correct: ok, correctCount: ok ? 1 : 0, totalCount: 1, distance: null };
  }

  if (q.type === 'short') {
    const given = normalizeAnswerText(answer);
    if (!given) return base;
    const ok = (q.answers || []).some((a) => normalizeAnswerText(a) === given);
    return { correct: ok, correctCount: ok ? 1 : 0, totalCount: 1, distance: null };
  }

  if (q.type === 'puzzle') {
    const total = q.pairs.length;
    if (!Array.isArray(answer)) return { ...base, totalCount: total };
    // 맞힌 짝의 개수를 센다. (전부 맞히지 못해도 개수만큼 순위에 반영)
    let count = 0;
    for (let i = 0; i < total; i++) {
      if (Number(answer[i]) === i) count++;
    }
    return { correct: count === total && total > 0, correctCount: count, totalCount: total, distance: null };
  }

  if (q.type === 'approx') {
    if (q.approxMode === 'date') {
      const guess = dateToDays(answer);
      const target = dateToDays(q.approxDate);
      if (guess == null || target == null) return base;
      const dist = Math.abs(guess - target);
      return { correct: dist === 0, correctCount: dist === 0 ? 1 : 0, totalCount: 1, distance: dist };
    }
    const guess = Number(answer);
    if (!Number.isFinite(guess)) return base;
    const dist = Math.abs(guess - Number(q.approxTarget));
    return { correct: dist === 0, correctCount: dist === 0 ? 1 : 0, totalCount: 1, distance: dist };
  }

  return base;
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
  const type = q ? q.type : 'choice';

  // 유형별로 "순위에 드는 제출"과 "0점 처리할 제출"을 나눈다.
  //  - 근사치 : 제출한 사람은 모두 순위에 든다. 정답과 가까운 순 → 같으면 빨리 낸 순
  //  - 퍼즐   : 1개라도 맞힌 사람만 순위에 든다. 맞힌 개수 많은 순 → 같으면 빨리 낸 순
  //  - 그 외  : 정답자만 순위에 든다. 빨리 낸 순 (선착순)
  let ranked;
  let unranked;
  if (type === 'approx') {
    ranked = subs
      .filter((x) => x.distance != null)
      .sort((a, b) => a.distance - b.distance || a.elapsed - b.elapsed);
    unranked = subs.filter((x) => x.distance == null);
  } else if (type === 'puzzle') {
    ranked = subs
      .filter((x) => x.correctCount > 0)
      .sort((a, b) => b.correctCount - a.correctCount || a.elapsed - b.elapsed);
    unranked = subs.filter((x) => x.correctCount <= 0);
  } else {
    ranked = subs.filter((x) => x.correct).sort((a, b) => a.elapsed - b.elapsed);
    unranked = subs.filter((x) => !x.correct);
  }

  const results = [];
  ranked.forEach((sub, i) => {
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
      correct: sub.correct,
      correctCount: sub.correctCount,
      totalCount: sub.totalCount,
      distance: sub.distance,
      answerLabel: answerLabel(q, sub.answer),
      elapsed: sub.elapsed,
      gained,
      total: player ? player.score : gained,
    });
  });
  unranked
    .sort((a, b) => a.elapsed - b.elapsed)
    .forEach((sub) => {
      const player = state.players[sub.key];
      results.push({
        key: sub.key,
        nick: sub.nick,
        rank: null,
        correct: false,
        correctCount: sub.correctCount,
        totalCount: sub.totalCount,
        distance: sub.distance,
        answerLabel: answerLabel(q, sub.answer),
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
        faceImage: q ? q.cardImage || '' : '', // 친구 얼굴 (큰 화면 배지 옆 아바타용)
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

  // 라이브 반응 스티커 (5종). 참가자가 누르면 모두에게 그대로 전달한다.
  socket.on('emote:send', (payload) => {
    if (!socket.data.playerKey) return;
    // clampInt 는 값을 잘라 맞추므로 여기서는 쓰지 않는다.
    // 범위를 벗어난 id 는 다른 스티커로 바뀌지 않도록 그냥 버린다.
    const id = Number(payload && payload.id);
    if (!Number.isInteger(id) || id < 0 || id >= EMOTE_COUNT) return;
    const now = Date.now();
    socket.data.emoteTimes = (socket.data.emoteTimes || []).filter((t) => now - t < 1000);
    if (socket.data.emoteTimes.length >= 4) return; // 초당 4회 제한
    socket.data.emoteTimes.push(now);
    io.emit('emote:show', { id });
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
    respond(cb, revealQuestion(payload && payload.questionId));
  });

  // 카드가 뒤집힌 뒤, 진행자가 "퀴즈 시작하기"를 눌렀을 때
  socket.on('admin:beginQuestion', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    respond(cb, beginQuestion());
  });

  socket.on('admin:endRound', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    if (!state.round || state.round.ended) {
      return respond(cb, { ok: false, error: '진행 중인 문제가 없습니다.' });
    }
    if (state.phase === 'reveal') {
      // 아직 시작 전이면 출제 취소
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
    q.type = QUESTION_TYPES.includes(incoming.type) ? incoming.type : q.type;
    q.text = String(incoming.text || '').slice(0, 500);
    q.cardText = String(incoming.cardText || '').slice(0, 200);
    q.image = clampImage(incoming.image);
    q.cardImage = clampImage(incoming.cardImage);
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
    q.approxMode = incoming.approxMode === 'date' ? 'date' : 'number';
    q.approxTarget = Number.isFinite(Number(incoming.approxTarget)) ? Number(incoming.approxTarget) : 0;
    q.approxUnit = String(incoming.approxUnit || '').slice(0, 10);
    q.approxDate = normalizeDate(incoming.approxDate);
    q.approxDateStart = normalizeDate(incoming.approxDateStart);
    q.approxDateEnd = normalizeDate(incoming.approxDateEnd);

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
    state.settings.hintBeforeSeconds = clampInt(s.hintBeforeSeconds, 1, 60, state.settings.hintBeforeSeconds);
    persist();
    broadcastAdmin();
    io.emit('settings:update', publicSettings());
    respond(cb, { ok: true });
    return undefined;
  });

  socket.on('admin:saveScreenStyle', (payload, cb) => {
    if (!requireAdmin(cb)) return;
    const s = payload && payload.screenStyle;
    if (!s) return respond(cb, { ok: false, error: '잘못된 요청입니다.' });
    state.settings.screenStyle = normalizeScreenStyle(s);
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
      if (state.phase === 'reveal' || state.phase === 'question') {
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
    } else if (what === 'questions') {
      // 저장된 문제가 코드의 기본 문제(사진 포함)를 덮어쓰고 있을 때 되돌리는 용도.
      // 진행 중인 라운드가 있으면 먼저 정리한다.
      clearRoundTimers();
      state.round = null;
      state.phase = 'lobby';
      state.rankingVisible = false;
      state.questions = JSON.parse(JSON.stringify(defaultQuestions));
      io.emit('ranking:hide');
      io.emit('board:show', { board: boardPayload() });
    } else if (what === 'faces') {
      // 코드 기본값의 이미지(친구 얼굴 + 문제 이미지 + 퍼즐 카드 이미지)를 "비어 있는 곳에만"
      // 채운다. 글자·보기·정답 등 다른 수정 내용은 그대로 둔다. (비파괴 복구)
      let filled = 0;
      state.questions.forEach((q) => {
        const base = defaultQuestions.find((d) => d.id === q.id) || defaultQuestions[q.index];
        if (!base) return;
        // 친구 얼굴(카드 이미지)
        if (base.cardImage && !q.cardImage) {
          q.cardImage = base.cardImage;
          filled += 1;
        }
        // 문제 이미지
        if (base.image && !q.image) {
          q.image = base.image;
          filled += 1;
        }
        // 퍼즐 카드 이미지 (예: 태중 맥주 이미지) — 순서가 맞을 때만 짝별로 채운다
        if (Array.isArray(base.pairs) && Array.isArray(q.pairs) && base.pairs.length === q.pairs.length) {
          base.pairs.forEach((bp, i) => {
            const lp = q.pairs[i];
            if (!lp) return;
            if (bp.left && bp.left.image && lp.left && !lp.left.image) {
              lp.left.image = bp.left.image;
              filled += 1;
            }
            if (bp.right && bp.right.image && lp.right && !lp.right.image) {
              lp.right.image = bp.right.image;
              filled += 1;
            }
          });
        }
      });
      io.emit('board:show', { board: boardPayload() });
      persist();
      broadcastBoard();
      broadcastAdmin();
      return respond(cb, { ok: true, filled });
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

// 시작 시: GitHub 상태 브랜치에 저장된 내용이 있으면 먼저 로컬로 내려받아 복원한다.
// (임시 디스크가 초기화되는 배포 환경에서도 상태가 유지되도록)
async function boot() {
  if (githubSync.isEnabled()) {
    try {
      const remote = await githubSync.load();
      if (remote) {
        const parsed = JSON.parse(remote);
        store.saveNow(parsed);
        console.log('[github-sync] 원격 상태 브랜치에서 저장된 내용을 불러왔습니다.');
      } else {
        console.log('[github-sync] 원격에 저장된 상태가 아직 없습니다. (첫 저장 시 생성됩니다)');
      }
    } catch (e) {
      // 원격을 못 읽었는데 자동 저장을 그대로 켜두면, 기본값이 원격의 진짜 데이터를
      // 덮어써 버릴 수 있다. 안전을 위해 이번 실행에서는 자동 저장을 멈춘다.
      githubSync.pauseWrites();
      console.error(
        '[github-sync] 원격 상태 불러오기 실패 — 데이터 보호를 위해 이번 실행은 자동 저장을 끕니다:',
        e.message
      );
    }
  }
  restore();
  startListening();
}

function startListening() {
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
}

boot();

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
