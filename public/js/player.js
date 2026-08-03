/* 참가자(모바일) 화면 */
(function () {
  'use strict';

  const { $, el, clock, toast, TYPE_LABEL, typeBadgeClass, vibrate, PAIR_COLORS } = window.QQ;
  const socket = io();

  const S = {
    me: null,
    board: [],
    question: null,
    startedAt: 0,
    timeLimit: 0,
    submitted: false,
    answer: null,
    puzzle: null,
    practicePuzzle: null,
    countdownEndsAt: 0,
    tickTimer: null,
    countTimer: null,
    lastResult: null,
  };

  /* ---------------- 화면 전환 ---------------- */

  const SCREENS = ['join', 'board', 'question', 'result', 'practice'];
  function showScreen(name) {
    SCREENS.forEach(function (s) {
      const node = document.getElementById('screen-' + s);
      if (node) node.classList.toggle('active', s === name);
    });
    window.scrollTo(0, 0);
  }

  function showOverlay(id, on) {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('active', !!on);
  }

  /* ---------------- 입장 ---------------- */

  const nickInput = $('#nick');
  const joinBtn = $('#join-btn');

  const savedNick = localStorage.getItem('qq_nick');
  if (savedNick) nickInput.value = savedNick;

  function join() {
    const nick = nickInput.value.trim();
    if (!nick) {
      toast('닉네임을 입력해 주세요.', 'err');
      return;
    }
    joinBtn.disabled = true;
    socket.emit('player:join', { nick: nick }, function (res) {
      joinBtn.disabled = false;
      if (!res || !res.ok) {
        toast((res && res.error) || '입장에 실패했습니다.', 'err');
        return;
      }
      localStorage.setItem('qq_nick', res.me.nick);
      S.me = res.me;
      updateMe();
      toast(
        res.returning ? '다시 오셨네요! ' + res.me.score + '점부터 이어갑니다 🎉' : '입장 완료! 🎉',
        'ok'
      );
    });
  }

  joinBtn.addEventListener('click', join);
  nickInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') join();
  });

  function updateMe() {
    if (!S.me) return;
    $('#me-nick').textContent = S.me.nick;
    $('#me-score').textContent = S.me.score + '점';
  }

  /* ---------------- 보드 & 하트 ---------------- */

  const boardNode = $('#board');

  function renderBoard(board) {
    S.board = board || [];
    boardNode.innerHTML = '';
    S.board.forEach(function (q) {
      const tile = el('div', 'tile' + (q.played ? ' played' : '') + (q.doublePoints ? ' has-x2' : ''));
      tile.dataset.id = q.id;

      if (q.doublePoints) {
        const x2 = el('span', 'badge x2 t-x2', '2배');
        tile.appendChild(x2);
      }

      const mid = el('div', 't-mid');
      mid.appendChild(el('div', 't-title', q.title));
      if (q.subtitle) mid.appendChild(el('div', 't-sub', q.subtitle));
      tile.appendChild(mid);

      const heart = el('div', 't-heart');
      heart.appendChild(el('span', null, '💗'));
      const cnt = el('span', 'cnt', String(q.hearts || 0));
      heart.appendChild(cnt);
      tile.appendChild(heart);

      tile.addEventListener('click', function () {
        socket.emit('heart:tap', { questionId: q.id });
        popHeart(tile, 1);
        const c = tile.querySelector('.cnt');
        c.textContent = String((parseInt(c.textContent, 10) || 0) + 1);
        vibrate(8);
      });

      boardNode.appendChild(tile);
    });
  }

  function popHeart(tile, n) {
    const emojis = ['💗', '💖', '💕', '❤️', '💘'];
    for (let i = 0; i < Math.min(n, 4); i++) {
      const p = el('div', 'pop', emojis[Math.floor(Math.random() * emojis.length)]);
      p.style.setProperty('--dx', (Math.random() * 30 - 15).toFixed(0) + 'px');
      p.style.setProperty('--dx2', (Math.random() * 60 - 30).toFixed(0) + 'px');
      p.style.animationDelay = i * 60 + 'ms';
      tile.appendChild(p);
      setTimeout(function () {
        if (p.parentNode) p.parentNode.removeChild(p);
      }, 1200 + i * 60);
    }
  }

  function updateHearts(items) {
    items.forEach(function (item) {
      const tile = boardNode.querySelector('.tile[data-id="' + item.id + '"]');
      const rec = S.board.find(function (b) {
        return b.id === item.id;
      });
      if (rec) rec.hearts = item.total;
      if (!tile) return;
      const c = tile.querySelector('.cnt');
      if (c) c.textContent = String(item.total);
      popHeart(tile, item.delta);
    });
  }

  /* ---------------- 퍼즐 위젯 ---------------- */

  /**
   * lefts : [{i, text}]  (i = 짝 번호)
   * rights: [{i, text}]  (섞인 순서)
   * 반환   : { getAnswer(), reset(), matchedCount() }
   */
  function buildPuzzle(container, lefts, rights, onChange) {
    const map = {}; // leftPairIndex -> rightPairIndex
    let activeLeft = null;

    container.innerHTML = '';
    const wrap = el('div', 'puzzle');
    const colL = el('div', 'puzzle-col');
    const colR = el('div', 'puzzle-col');
    wrap.appendChild(colL);
    wrap.appendChild(colR);
    container.appendChild(wrap);

    const leftNodes = {};
    const rightNodes = {};

    lefts.forEach(function (item) {
      const card = el('button', 'pcard');
      card.type = 'button';
      const dot = el('span', 'dot');
      dot.style.display = 'none';
      card.appendChild(dot);
      card.appendChild(el('span', null, item.text));
      card.addEventListener('click', function () {
        if (map[item.i] != null) {
          delete map[item.i];
          activeLeft = item.i;
        } else {
          activeLeft = activeLeft === item.i ? null : item.i;
        }
        vibrate(8);
        paint();
      });
      leftNodes[item.i] = card;
      colL.appendChild(card);
    });

    rights.forEach(function (item) {
      const card = el('button', 'pcard');
      card.type = 'button';
      const dot = el('span', 'dot');
      dot.style.display = 'none';
      card.appendChild(dot);
      card.appendChild(el('span', null, item.text));
      card.addEventListener('click', function () {
        const owner = ownerOfRight(item.i);
        if (owner != null) {
          delete map[owner];
          if (activeLeft == null) activeLeft = owner;
        }
        if (activeLeft != null) {
          map[activeLeft] = item.i;
          activeLeft = null;
        }
        vibrate(8);
        paint();
      });
      rightNodes[item.i] = card;
      colR.appendChild(card);
    });

    function ownerOfRight(rightIdx) {
      const keys = Object.keys(map);
      for (let k = 0; k < keys.length; k++) {
        if (map[keys[k]] === rightIdx) return Number(keys[k]);
      }
      return null;
    }

    function paint() {
      lefts.forEach(function (item, order) {
        const node = leftNodes[item.i];
        const matched = map[item.i] != null;
        node.classList.toggle('active', activeLeft === item.i);
        node.classList.toggle('matched', matched);
        const dot = node.querySelector('.dot');
        dot.style.display = matched ? 'block' : 'none';
        dot.style.background = PAIR_COLORS[order % PAIR_COLORS.length];
      });
      rights.forEach(function (item) {
        const node = rightNodes[item.i];
        const owner = ownerOfRight(item.i);
        const matched = owner != null;
        node.classList.toggle('matched', matched);
        node.classList.remove('active');
        const dot = node.querySelector('.dot');
        dot.style.display = matched ? 'block' : 'none';
        if (matched) {
          const order = lefts.findIndex(function (l) {
            return l.i === owner;
          });
          dot.style.background = PAIR_COLORS[order % PAIR_COLORS.length];
        }
      });
      if (onChange) onChange(Object.keys(map).length, lefts.length);
    }

    paint();

    return {
      getAnswer: function () {
        return lefts.map(function (l) {
          return map[l.i] != null ? map[l.i] : null;
        });
      },
      matchedCount: function () {
        return Object.keys(map).length;
      },
      reset: function () {
        Object.keys(map).forEach(function (k) {
          delete map[k];
        });
        activeLeft = null;
        paint();
      },
    };
  }

  /* ---------------- 카운트다운 ---------------- */

  function startCountdown(data) {
    $('#oc-title').textContent = data.title || '문제';
    $('#oc-sub').textContent = data.subtitle || '';
    $('#oc-type').textContent = TYPE_LABEL[data.type] || '';
    S.countdownEndsAt = data.startsAt;
    showOverlay('overlay-rank', false);
    showOverlay('overlay-count', true);
    vibrate([20, 60, 20]);

    if (S.countTimer) clearInterval(S.countTimer);
    function tick() {
      const left = Math.max(0, S.countdownEndsAt - clock.now());
      $('#oc-num').textContent = String(Math.max(1, Math.ceil(left / 1000)));
      if (left <= 0) {
        clearInterval(S.countTimer);
        S.countTimer = null;
      }
    }
    tick();
    S.countTimer = setInterval(tick, 100);
  }

  /* ---------------- 문제 ---------------- */

  function renderQuestion(question, startedAt, opts) {
    opts = opts || {};
    S.question = question;
    S.startedAt = startedAt;
    S.timeLimit = question.timeLimit;
    S.submitted = !!opts.submitted;
    S.answer = null;
    S.puzzle = null;

    showOverlay('overlay-count', false);
    showOverlay('overlay-rank', false);
    showScreen('question');

    $('#q-title').textContent = question.title + (question.subtitle ? ' · ' + question.subtitle : '');
    const typeBadge = $('#q-type');
    typeBadge.textContent = TYPE_LABEL[question.type] || '';
    typeBadge.className = typeBadgeClass(question.type);
    $('#q-x2').classList.toggle('hidden', !question.doublePoints);
    $('#q-text').textContent = question.text || '';
    $('#hint-box').classList.add('hidden');
    $('#hint-box').textContent = '';

    const body = $('#q-body');
    body.innerHTML = '';

    if (question.type === 'choice') {
      const list = el('div', 'options');
      (question.options || []).forEach(function (opt, i) {
        const b = el('button', 'opt');
        b.type = 'button';
        b.appendChild(el('span', 'k', String(i + 1)));
        b.appendChild(el('span', null, opt));
        b.addEventListener('click', function () {
          if (S.submitted) return;
          S.answer = i;
          Array.prototype.forEach.call(list.children, function (c, ci) {
            c.classList.toggle('selected', ci === i);
          });
          vibrate(10);
        });
        list.appendChild(b);
      });
      body.appendChild(list);
    } else if (question.type === 'short') {
      const input = el('input', 'input');
      input.type = 'text';
      input.id = 'short-answer';
      input.placeholder = '정답을 입력하세요';
      input.maxLength = 60;
      input.autocomplete = 'off';
      input.setAttribute('enterkeyhint', 'send');
      input.addEventListener('input', function () {
        S.answer = input.value;
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submit(false);
      });
      body.appendChild(input);
      setTimeout(function () {
        if (!S.submitted) input.focus();
      }, 250);
    } else if (question.type === 'puzzle') {
      const legend = el(
        'p',
        'puzzle-legend',
        '왼쪽 카드를 누른 뒤 오른쪽 카드를 누르면 연결돼요. 연결된 카드를 다시 누르면 해제됩니다.'
      );
      body.appendChild(legend);
      const holder = el('div');
      body.appendChild(holder);
      const status = el('p', 'puzzle-legend', '');
      body.appendChild(status);
      S.puzzle = buildPuzzle(holder, question.lefts, question.rights, function (n, total) {
        status.textContent = n + ' / ' + total + ' 연결됨';
      });
    }

    $('#submitted-count').textContent = '제출 ' + (opts.submittedCount || 0) + '명';
    setSubmittedUI(S.submitted);
    startTicker();

    if (opts.hint) showHint(opts.hint);
  }

  function setSubmittedUI(done) {
    $('#submit-btn').disabled = done;
    $('#submit-btn').textContent = done ? '제출 완료 ✓' : '제출하기';
    $('#q-body').classList.toggle('hidden', done);
    $('#q-waiting').classList.toggle('hidden', !done);
  }

  function showHint(text) {
    const box = $('#hint-box');
    box.textContent = '💡 힌트 : ' + text;
    box.classList.remove('hidden');
    vibrate([15, 40, 15]);
  }

  function startTicker() {
    if (S.tickTimer) clearInterval(S.tickTimer);
    S.tickTimer = setInterval(tick, 100);
    tick();
  }
  function stopTicker() {
    if (S.tickTimer) clearInterval(S.tickTimer);
    S.tickTimer = null;
  }

  function tick() {
    if (!S.question) return;
    const total = S.timeLimit * 1000;
    const remain = Math.max(0, total - (clock.now() - S.startedAt));
    const pct = total > 0 ? (remain / total) * 100 : 0;
    const fill = $('#timer-fill');
    fill.style.width = pct + '%';
    fill.classList.toggle('warn', pct <= 40 && pct > 15);
    fill.classList.toggle('crit', pct <= 15);
    $('#timer-num').textContent = Math.ceil(remain / 1000) + '초';

    if (remain <= 0) {
      stopTicker();
      if (!S.submitted) {
        toast('시간 종료! 자동 제출되었습니다.', 'err');
        submit(true);
      }
    }
  }

  function currentAnswer() {
    if (!S.question) return null;
    if (S.question.type === 'choice') return S.answer;
    if (S.question.type === 'short') {
      const input = document.getElementById('short-answer');
      return input ? input.value : S.answer;
    }
    if (S.question.type === 'puzzle') return S.puzzle ? S.puzzle.getAnswer() : null;
    return null;
  }

  function submit(auto) {
    if (!S.question || S.submitted) return;
    const answer = currentAnswer();
    if (!auto) {
      if (S.question.type === 'choice' && answer == null) {
        toast('보기를 선택해 주세요.', 'err');
        return;
      }
      if (S.question.type === 'short' && !String(answer || '').trim()) {
        toast('정답을 입력해 주세요.', 'err');
        return;
      }
      if (S.question.type === 'puzzle' && S.puzzle && S.puzzle.matchedCount() < S.question.lefts.length) {
        toast('모든 카드를 연결해 주세요.', 'err');
        return;
      }
    }
    S.submitted = true;
    setSubmittedUI(true);
    socket.emit('answer:submit', { answer: answer }, function (res) {
      if (!res || !res.ok) {
        if (res && res.error) toast(res.error, 'err');
        return;
      }
      const sec = (res.elapsed / 1000).toFixed(2);
      $('#q-waiting-sub').textContent = sec + '초에 제출했어요. 결과를 기다리는 중…';
      vibrate(20);
    });
  }

  $('#submit-btn').addEventListener('click', function () {
    submit(false);
  });

  /* ---------------- 결과 ---------------- */

  function renderResult(data) {
    stopTicker();
    S.question = null;
    S.lastResult = data;
    showOverlay('overlay-count', false);
    showScreen('result');

    const mine = S.me
      ? (data.results || []).find(function (r) {
          return r.nick === S.me.nick;
        })
      : null;

    let emoji = '🙈';
    let title = '아쉬워요!';
    if (mine && mine.correct) {
      if (mine.rank === 1) {
        emoji = '🥇';
        title = '1등! 가장 빨랐어요!';
      } else if (mine.rank <= 4) {
        emoji = '🎉';
        title = mine.rank + '등으로 정답!';
      } else {
        emoji = '👏';
        title = '정답이에요!';
      }
    } else if (mine) {
      emoji = '😢';
      title = '오답이에요…';
    } else {
      emoji = '⏰';
      title = '제출하지 못했어요';
    }

    $('#r-emoji').textContent = emoji;
    $('#r-title').textContent = title;
    $('#r-gain').textContent = mine && mine.gained ? '+' + mine.gained + '점' : '';
    if (mine) {
      S.me.score = mine.total;
      updateMe();
      $('#r-total').textContent = '현재 ' + mine.total + '점';
    } else {
      $('#r-total').textContent = S.me ? '현재 ' + S.me.score + '점' : '';
    }
    if (data.doublePoints) {
      $('#r-total').textContent += ' · ⭐ 2배 점수 적용';
    }

    $('#r-answer').textContent = data.correctAnswer || '-';

    const list = $('#r-list');
    list.innerHTML = '';
    if (!data.results || !data.results.length) {
      list.appendChild(el('div', 'muted center tiny', '제출한 사람이 없어요.'));
    }
    (data.results || []).forEach(function (r) {
      const row = el('div', 'rank-row' + (r.correct && r.rank === 1 ? ' top1' : '') + (r.correct ? '' : ' wrong'));
      if (S.me && r.nick === S.me.nick) row.classList.add('me');
      row.appendChild(el('span', 'no', r.correct ? String(r.rank) : '✗'));
      row.appendChild(el('span', 'nm', r.nick));
      row.appendChild(el('span', 'tm', (r.elapsed / 1000).toFixed(2) + '초'));
      row.appendChild(el('span', 'pt', r.gained ? '+' + r.gained : '0'));
      list.appendChild(row);
    });

    if (mine && mine.correct) vibrate([20, 50, 20, 50, 40]);
  }

  /* ---------------- 순위 공개 ---------------- */

  function renderRanking(list) {
    const node = $('#rank-list');
    node.innerHTML = '';
    (list || []).forEach(function (r) {
      const row = el('div', 'rank-row' + (r.rank === 1 ? ' top1' : ''));
      if (S.me && r.nick === S.me.nick) row.classList.add('me');
      const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : String(r.rank);
      row.appendChild(el('span', 'no', medal));
      row.appendChild(el('span', 'nm', r.nick));
      row.appendChild(el('span', 'pt', r.score + '점'));
      node.appendChild(row);
    });
    showOverlay('overlay-rank', true);
  }

  /* ---------------- 퍼즐 연습 ---------------- */

  function startPractice(puzzle) {
    S.practicePuzzle = puzzle;
    showOverlay('overlay-count', false);
    showOverlay('overlay-rank', false);
    showScreen('practice');
    $('#pr-text').textContent = puzzle.text || '카드를 눌러 짝을 맞춰보세요!';

    const lefts = puzzle.pairs.map(function (p, i) {
      return { i: i, text: p.left };
    });
    const rights = puzzle.pairs
      .map(function (p, i) {
        return { i: i, text: p.right };
      })
      .sort(function () {
        return Math.random() - 0.5;
      });

    const ctl = buildPuzzle($('#pr-body'), lefts, rights, function (n, total) {
      const status = $('#pr-status');
      if (n < total) {
        status.textContent = n + ' / ' + total + ' 연결됨';
        status.className = 'muted';
      } else {
        const ans = ctl ? ctl.getAnswer() : [];
        const allRight = ans.every(function (v, i) {
          return v === i;
        });
        status.textContent = allRight ? '정확해요! 이렇게 풀면 됩니다 🎉' : '전부 연결했어요! (정답 여부는 실제 문제에서 확인돼요)';
        status.className = allRight ? '' : 'muted';
        if (allRight) status.style.color = 'var(--good)';
        else status.style.color = '';
      }
    });
    $('#pr-reset').onclick = function () {
      ctl.reset();
    };
  }

  /* ---------------- 소켓 이벤트 ---------------- */

  socket.on('hello', function (d) {
    clock.sync(d.serverNow);
  });

  socket.on('connect', function () {
    $('#conn-dot').classList.remove('off');
    // 첫 접속이든 재연결이든, 저장된 닉네임으로 자동 재입장해 점수를 이어받는다.
    const nick = localStorage.getItem('qq_nick');
    if (nick) {
      socket.emit('player:join', { nick: nick }, function (res) {
        if (res && res.ok) {
          S.me = res.me;
          updateMe();
        }
      });
    }
  });

  socket.on('disconnect', function () {
    $('#conn-dot').classList.add('off');
    toast('연결이 끊겼어요. 다시 연결하는 중…', 'err');
  });

  socket.on('state:sync', function (d) {
    clock.sync(d.serverNow);
    renderBoard(d.board);
    $('#player-count').textContent = '👥 ' + d.playerCount;
    if (d.me) {
      S.me = d.me;
      updateMe();
    }

    if (!S.me) {
      showScreen('join');
      return;
    }

    if (d.phase === 'practice' && d.practice) {
      startPractice(d.practice);
    } else if (d.round && d.round.stage === 'countdown') {
      showScreen('board');
      startCountdown(d.round);
    } else if (d.round && d.round.stage === 'question') {
      renderQuestion(d.round.question, d.round.startedAt, {
        submitted: d.round.mySubmitted,
        submittedCount: d.round.submittedCount,
        hint: d.round.hint,
      });
    } else if (d.round && d.round.stage === 'result') {
      renderResult(d.round);
    } else {
      showScreen('board');
    }

    if (d.rankingVisible && d.ranking) renderRanking(d.ranking);
    else showOverlay('overlay-rank', false);
  });

  socket.on('me:update', function (d) {
    S.me = d;
    updateMe();
  });

  socket.on('players:count', function (d) {
    $('#player-count').textContent = '👥 ' + d.count;
  });

  socket.on('board:update', function (d) {
    if (document.getElementById('screen-board').classList.contains('active')) {
      renderBoard(d.board);
    } else {
      S.board = d.board;
    }
  });

  socket.on('board:show', function (d) {
    stopTicker();
    S.question = null;
    showOverlay('overlay-count', false);
    renderBoard(d.board);
    showScreen('board');
  });

  socket.on('hearts:update', function (d) {
    updateHearts(d.items || []);
  });

  socket.on('round:countdown', function (d) {
    clock.sync(d.serverNow);
    if (!S.me) return;
    showScreen('board');
    startCountdown(d);
  });

  socket.on('round:cancel', function () {
    showOverlay('overlay-count', false);
    if (S.countTimer) clearInterval(S.countTimer);
    toast('진행자가 출제를 취소했어요.', 'err');
  });

  socket.on('round:start', function (d) {
    clock.sync(d.serverNow);
    if (!S.me) return;
    if (S.countTimer) clearInterval(S.countTimer);
    renderQuestion(d.question, d.startedAt, {});
  });

  socket.on('round:hint', function (d) {
    if (S.question) showHint(d.hint);
  });

  socket.on('round:double', function (d) {
    if (!S.question) return;
    S.question.doublePoints = d.doublePoints;
    $('#q-x2').classList.toggle('hidden', !d.doublePoints);
    if (d.doublePoints) toast('⭐ 이번 문제는 2배 점수!', 'ok');
  });

  socket.on('round:submitted', function (d) {
    $('#submitted-count').textContent = '제출 ' + d.count + '명';
  });

  socket.on('round:end', function (d) {
    if (!S.me) return;
    renderResult(d);
  });

  socket.on('ranking:show', function (d) {
    renderRanking(d.ranking);
  });

  socket.on('ranking:hide', function () {
    showOverlay('overlay-rank', false);
  });

  socket.on('practice:start', function (d) {
    if (!S.me) return;
    startPractice(d.puzzle);
  });

  socket.on('practice:end', function () {
    showScreen('board');
  });

  socket.on('player:kicked', function (d) {
    S.me = null;
    stopTicker();
    showOverlay('overlay-count', false);
    showOverlay('overlay-rank', false);
    showScreen('join');
    toast((d && d.reason) || '연결이 종료되었습니다.', 'err', 4000);
  });
})();
