/* 큰 화면(TV·프로젝터)용 관전 화면.
 * 참가자로 접속하지 않고 브로드캐스트만 받아, 현재 출제된 문제의 이미지를 크게 보여준다.
 * 서버는 접속하는 모든 소켓에 state:sync 를 보내고, 라운드 이벤트는 io.emit 으로 전체에 뿌리므로
 * 여기서는 그것들을 듣기만 하면 된다. */
(function () {
  'use strict';

  const { $, el, clock, TYPE_LABEL, typeBadgeClass } = window.QQ;
  const socket = io();
  const root = $('#sc-root');

  const S = {
    view: 'idle', // idle | reveal | question | result
    board: [],
    question: null,
    startedAt: 0,
    timeLimit: 0,
    submitted: 0,
    hint: '',
    doublePoints: false,
    result: null,
    tick: null,
  };

  /* ---------- 퍼즐 카드는 문자열/객체 둘 다 받아준다 ---------- */
  function asCard(c) {
    return typeof c === 'string'
      ? { text: c, image: '' }
      : { text: (c && c.text) || '', image: (c && c.image) || '' };
  }

  /* ---------------- 화면 전환 ---------------- */

  function showIdle(board) {
    S.view = 'idle';
    stopTick();
    S.board = board || S.board;
    render();
  }

  function showReveal(data) {
    S.view = 'reveal';
    stopTick();
    S.reveal = data;
    render();
  }

  function showQuestion(question, startedAt) {
    S.view = 'question';
    S.question = question;
    S.startedAt = startedAt;
    S.timeLimit = question.timeLimit;
    S.hint = '';
    S.doublePoints = !!question.doublePoints;
    render();
    startTick();
  }

  function showResult(data) {
    S.view = 'result';
    stopTick();
    S.result = data;
    render();
  }

  /* ---------------- 렌더 ---------------- */

  function render() {
    root.innerHTML = '';
    if (S.view === 'question') return renderQuestion();
    if (S.view === 'reveal') return renderReveal();
    if (S.view === 'result') return renderResult();
    return renderIdle();
  }

  function bigBadges(q, extraLabel) {
    const top = el('div', 'sc-top');
    const n = q.index != null ? q.index + 1 + '. ' : '';
    top.appendChild(el('span', 'badge sc-badge', n + (q.title || '') + (q.subtitle ? ' · ' + q.subtitle : '')));
    top.appendChild(el('span', typeBadgeClass(q.type) + ' sc-badge', TYPE_LABEL[q.type] || ''));
    if (q.doublePoints || S.doublePoints) top.appendChild(el('span', 'badge x2 sc-badge', '⭐ 2배 점수'));
    if (extraLabel) top.appendChild(el('span', 'badge sc-badge', extraLabel));
    return top;
  }

  function bigImage(src) {
    const wrap = el('div', 'sc-image');
    const img = el('img');
    img.src = src;
    img.alt = '';
    wrap.appendChild(img);
    return wrap;
  }

  function renderIdle() {
    const c = el('div', 'sc-center');
    c.appendChild(el('div', 'logo', '퀴즈퀴즈'));
    c.appendChild(el('p', 'sc-hint', '진행자가 문제를 고르면 여기에 크게 보여드려요 🎉'));
    // 지금 어떤 칸에 하트가 몰리는지 큰 화면에서도 보이게 보드를 함께 띄운다.
    if (S.board && S.board.length) {
      const grid = el('div', 'sc-board');
      S.board.forEach(function (b) {
        const tile = el('div', 'sc-board-tile' + (b.played ? ' played' : ''));
        tile.appendChild(el('div', 'sc-board-title', (b.index + 1) + '. ' + b.title));
        tile.appendChild(el('div', 'sc-board-heart', '💗 ' + (b.hearts || 0)));
        grid.appendChild(tile);
      });
      c.appendChild(grid);
    }
    root.appendChild(c);
  }

  function renderReveal() {
    const d = S.reveal || {};
    const c = el('div', 'sc-center');
    c.appendChild(el('div', 'sc-reveal-eyebrow', '곧 시작합니다'));
    if (d.image) {
      c.appendChild(bigImage(d.image));
    } else {
      c.appendChild(el('div', 'sc-reveal-emoji', typeEmoji(d.type)));
    }
    if (d.subtitle) c.appendChild(el('div', 'sc-reveal-sub', d.subtitle));
    c.appendChild(el('h1', 'sc-reveal-title', d.title || '문제'));
    if (d.text) c.appendChild(el('div', 'sc-reveal-text', d.text));
    root.appendChild(c);
  }

  function renderQuestion() {
    const q = S.question;
    const wrap = el('div', 'sc-q');
    const head = bigBadges(q);
    head.appendChild(el('div', 'sc-timer', Math.ceil(remainMs() / 1000) + '초'));
    wrap.appendChild(head);

    const bar = el('div', 'sc-timer-bar');
    const fill = el('div', 'sc-timer-fill');
    fill.id = 'sc-fill';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    if (q.image) wrap.appendChild(bigImage(q.image));
    if (q.text) wrap.appendChild(el('div', 'sc-q-text', q.text));

    const bodyC = el('div', 'sc-q-body');
    if (q.type === 'choice' || q.type === 'audio') scChoice(bodyC, q, null);
    else if (q.type === 'puzzle') scPuzzle(bodyC, q.lefts || [], q.rights || []);
    else if (q.type === 'approx' || q.type === 'short') {
      bodyC.appendChild(el('div', 'sc-answer-hint', '📱 각자 휴대폰에서 답을 입력하세요'));
    }
    wrap.appendChild(bodyC);

    if (S.hint) wrap.appendChild(el('div', 'hint-box sc-hint-box', '💡 힌트 : ' + S.hint));
    wrap.appendChild(el('div', 'sc-foot', '제출 ' + (S.submitted || 0) + '명'));
    root.appendChild(wrap);
    paintTimer();
  }

  function renderResult() {
    const d = S.result || {};
    const wrap = el('div', 'sc-q');
    wrap.appendChild(bigBadges(d, '결과'));
    if (d.image) wrap.appendChild(bigImage(d.image));
    if (d.text) wrap.appendChild(el('div', 'sc-q-text', d.text));

    const ans = el('div', 'sc-answer-box');
    ans.appendChild(el('div', 'sc-answer-label', '정답'));
    ans.appendChild(el('div', 'sc-answer-value', d.correctAnswer || '-'));
    wrap.appendChild(ans);

    if (d.explanation) {
      const ex = el('div', 'sc-explain');
      ex.appendChild(el('div', 'sc-explain-label', '해설'));
      ex.appendChild(el('div', 'sc-explain-text', d.explanation));
      wrap.appendChild(ex);
    }

    const bodyC = el('div', 'sc-q-body');
    if ((d.type === 'choice' || d.type === 'audio') && Array.isArray(d.options)) {
      scChoice(bodyC, { type: d.type, options: d.options }, d.options.findIndex(function (o) { return o.correct; }));
    } else if (d.type === 'puzzle' && Array.isArray(d.pairs)) {
      const lefts = d.pairs.map(function (p, i) { return Object.assign({ i: i }, asCard(p.left)); });
      const rights = d.pairs.map(function (p, i) { return Object.assign({ i: i }, asCard(p.right)); });
      scPuzzle(bodyC, lefts, rights, true);
    }
    wrap.appendChild(bodyC);

    // 상위 순위 몇 명
    if (Array.isArray(d.results) && d.results.length) {
      const top = el('div', 'sc-rank');
      d.results.slice(0, 5).forEach(function (r, i) {
        const row = el('div', 'sc-rank-row');
        row.appendChild(el('span', 'sc-rank-no', String(i + 1)));
        row.appendChild(el('span', 'sc-rank-nick', r.nick));
        if (r.gained != null) row.appendChild(el('span', 'sc-rank-gain', '+' + r.gained));
        top.appendChild(row);
      });
      wrap.appendChild(top);
    }
    root.appendChild(wrap);
  }

  /* ---------- 유형별 본문 (큰 화면용) ---------- */

  function scChoice(body, q, correctIdx) {
    const list = el('div', 'sc-options');
    (q.options || []).forEach(function (opt, order) {
      const isCorrect = correctIdx != null && (opt.correct || order === correctIdx);
      const card = el('div', 'sc-opt' + (isCorrect ? ' correct' : ''));
      card.appendChild(el('span', 'sc-opt-k', String(order + 1)));
      if (opt.image) {
        const img = el('img', 'sc-opt-img');
        img.src = opt.image;
        img.alt = '';
        card.appendChild(img);
      }
      if (opt.text) card.appendChild(el('span', 'sc-opt-tx', opt.text));
      if (q.type === 'audio' && opt.audio) card.appendChild(el('span', 'sc-opt-audio', '🔊 음성'));
      if (isCorrect) card.appendChild(el('span', 'sc-opt-mark', '정답 ✓'));
      list.appendChild(card);
    });
    body.appendChild(list);
  }

  function scPuzzle(body, lefts, rights, showArrow) {
    const wrap = el('div', 'sc-puzzle');
    const colL = el('div', 'sc-pz-col');
    const colR = el('div', 'sc-pz-col');
    lefts.forEach(function (item) { colL.appendChild(scCard(item)); });
    rights.forEach(function (item) { colR.appendChild(scCard(item)); });
    wrap.appendChild(colL);
    wrap.appendChild(colR);
    body.appendChild(wrap);
    if (showArrow) body.appendChild(el('p', 'sc-answer-hint', '왼쪽 사진과 오른쪽 답이 정답 짝이에요'));
  }

  function scCard(item) {
    const c = asCard(item);
    const card = el('div', 'sc-pcard');
    if (c.image) {
      const img = el('img', 'sc-pcard-img');
      img.src = c.image;
      img.alt = '';
      card.appendChild(img);
    }
    if (c.text) card.appendChild(el('span', null, c.text));
    return card;
  }

  /* ---------------- 타이머 ---------------- */

  function remainMs() {
    if (!S.startedAt || !S.timeLimit) return 0;
    return Math.max(0, S.timeLimit * 1000 - (clock.now() - S.startedAt));
  }
  function paintTimer() {
    const fill = document.getElementById('sc-fill');
    if (!fill) return;
    const total = S.timeLimit * 1000;
    const pct = total > 0 ? (remainMs() / total) * 100 : 0;
    fill.style.width = pct + '%';
    fill.classList.toggle('warn', pct <= 40 && pct > 15);
    fill.classList.toggle('crit', pct <= 15);
  }
  function startTick() {
    stopTick();
    S.tick = setInterval(function () {
      const t = document.querySelector('.sc-timer');
      if (t) t.textContent = Math.ceil(remainMs() / 1000) + '초';
      paintTimer();
      if (remainMs() <= 0) stopTick();
    }, 100);
  }
  function stopTick() {
    if (S.tick) clearInterval(S.tick);
    S.tick = null;
  }

  function typeEmoji(t) {
    return { choice: '⚡', audio: '🔊', short: '✏️', puzzle: '🧩', approx: '🎯' }[t] || '🎯';
  }

  /* ---------------- 소켓 ---------------- */

  socket.on('hello', function (d) {
    clock.sync(d && d.serverNow);
  });

  socket.on('state:sync', function (d) {
    clock.sync(d.serverNow);
    S.board = d.board || [];
    const r = d.round;
    if (d.phase === 'question' && r && r.stage === 'question') {
      S.submitted = r.submittedCount || 0;
      if (r.hint) S.hint = r.hint;
      showQuestion(r.question, r.startedAt);
    } else if (d.phase === 'reveal' && r && r.stage === 'reveal') {
      showReveal(r);
    } else if (d.phase === 'result' && r && r.stage === 'result') {
      showResult(r);
    } else {
      showIdle(d.board);
    }
  });

  socket.on('round:reveal', function (d) {
    clock.sync(d.serverNow);
    showReveal(d);
  });
  socket.on('round:start', function (d) {
    clock.sync(d.serverNow);
    S.submitted = 0;
    showQuestion(d.question, d.startedAt);
  });
  socket.on('round:submitted', function (d) {
    S.submitted = d && d.count != null ? d.count : S.submitted;
    const f = document.querySelector('.sc-foot');
    if (f) f.textContent = '제출 ' + S.submitted + '명';
  });
  socket.on('round:hint', function (d) {
    if (S.view !== 'question') return;
    S.hint = (d && d.hint) || '';
    render();
    startTick();
  });
  socket.on('round:double', function (d) {
    S.doublePoints = !!(d && d.doublePoints);
    if (S.question) S.question.doublePoints = S.doublePoints;
    if (S.view === 'question') { render(); startTick(); }
  });
  socket.on('round:end', function (d) {
    showResult(d);
  });
  socket.on('round:cancel', function () {
    showIdle(S.board);
  });
  socket.on('board:show', function (d) {
    showIdle(d && d.board);
  });
  socket.on('board:update', function (d) {
    S.board = (d && d.board) || S.board;
    if (S.view === 'idle') render();
  });
  socket.on('hearts:update', function (d) {
    if (!S.board || S.view !== 'idle') return;
    (d.items || []).forEach(function (item) {
      const rec = S.board.find(function (b) { return b.id === item.id; });
      if (rec) rec.hearts = item.total;
    });
    render();
  });
})();
