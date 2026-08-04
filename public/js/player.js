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
    tickTimer: null,
    flipTimer: null,
    lastResult: null,
    roster: [],
    audios: [], // 현재 문제에서 만든 오디오 (문제가 바뀌면 전부 멈춘다)
    myPuzzleAnswer: null, // 결과 화면에서 내 연결과 정답을 비교하려고 보관
  };

  /* ---------------- 라이브 반응 스티커 ---------------- */

  const emoteLayer = QQ.createEmoteLayer($('#emote-layer'));

  (function buildEmoteBar() {
    const bar = $('#emote-bar');
    QQ.EMOTES.forEach(function (e, i) {
      const btn = el('button', 'emote-btn');
      btn.type = 'button';
      btn.title = e.label;
      btn.setAttribute('aria-label', e.label + ' 반응 보내기');
      btn.appendChild(QQ.makeSticker(i));
      btn.addEventListener('click', function () {
        socket.emit('emote:send', { id: i });
        vibrate(8);
      });
      bar.appendChild(btn);
    });
  })();

  /** 재생 중인 보기 음성을 모두 멈춘다. */
  function stopAllAudio() {
    S.audios.forEach(function (a) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch (e) {
        /* 무시 */
      }
    });
  }

  /* ---------------- 화면 전환 ---------------- */

  const SCREENS = ['join', 'board', 'question', 'result', 'practice'];
  function showScreen(name) {
    SCREENS.forEach(function (s) {
      const node = document.getElementById('screen-' + s);
      if (node) node.classList.toggle('active', s === name);
    });
    // 반응 스티커 바는 입장한 뒤에만 보여준다. (닉네임 입력 화면에서는 숨김)
    const showBar = name !== 'join';
    $('#emote-bar').classList.toggle('hidden', !showBar);
    document.body.classList.toggle('has-emote-bar', showBar);
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

  /** 대기 화면에 지금 들어와 있는 사람들의 닉네임을 보여준다. */
  function renderRoster(players) {
    S.roster = players || [];
    const list = $('#roster-list');
    const online = S.roster.filter(function (p) {
      return p.connected;
    }).length;
    $('#roster-count').textContent = online + '명';
    list.innerHTML = '';
    if (!S.roster.length) {
      list.appendChild(el('div', 'roster-empty', '아직 아무도 없어요. 친구들을 기다리는 중…'));
      return;
    }
    S.roster.forEach(function (p) {
      const chip = el('span', 'roster-chip' + (p.connected ? '' : ' off'));
      if (S.me && p.nick === S.me.nick) chip.classList.add('me');
      chip.appendChild(el('span', 'dot'));
      chip.appendChild(el('span', null, p.nick));
      list.appendChild(chip);
    });
  }

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
    // 연결선을 그릴 SVG 를 카드 위에 겹쳐 둔다. (pointer-events:none 이라 터치는 카드로 간다)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'puzzle-lines');
    wrap.appendChild(colL);
    wrap.appendChild(colR);
    wrap.appendChild(svg);
    container.appendChild(wrap);

    const leftNodes = {};
    const rightNodes = {};

    /** 카드 한 장의 내용(이미지 + 점 + 글자)을 채운다. 점(.dot)은 연결 표시에 쓰인다. */
    function fillCard(card, item) {
      if (item.image) {
        const img = el('img', 'pcard-img');
        img.src = item.image;
        img.alt = '';
        card.appendChild(img);
      }
      const row = el('div', 'pcard-row');
      const dot = el('span', 'dot');
      dot.style.display = 'none';
      row.appendChild(dot);
      row.appendChild(el('span', null, item.text));
      card.appendChild(row);
    }

    lefts.forEach(function (item) {
      const card = el('button', 'pcard');
      card.type = 'button';
      fillCard(card, item);
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
      fillCard(card, item);
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
      drawLines();
      if (onChange) onChange(Object.keys(map).length, lefts.length);
    }

    /** 연결된 카드 사이를 실제 선으로 이어 그린다. */
    function drawLines() {
      const box = wrap.getBoundingClientRect();
      if (!box.width) return;
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      Object.keys(map).forEach(function (leftKey) {
        const leftIdx = Number(leftKey);
        const rightIdx = map[leftKey];
        const ln = leftNodes[leftIdx];
        const rn = rightNodes[rightIdx];
        if (!ln || !rn) return;
        const lb = ln.getBoundingClientRect();
        const rb = rn.getBoundingClientRect();
        const order = lefts.findIndex(function (l) {
          return l.i === leftIdx;
        });
        const color = PAIR_COLORS[order % PAIR_COLORS.length];

        const x1 = lb.right - box.left;
        const y1 = lb.top + lb.height / 2 - box.top;
        const x2 = rb.left - box.left;
        const y2 = rb.top + rb.height / 2 - box.top;
        const mid = (x1 + x2) / 2;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + mid + ' ' + y1 + ', ' + mid + ' ' + y2 + ', ' + x2 + ' ' + y2);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);

        [[x1, y1], [x2, y2]].forEach(function (pt) {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', pt[0]);
          c.setAttribute('cy', pt[1]);
          c.setAttribute('r', '4');
          c.setAttribute('fill', color);
          svg.appendChild(c);
        });
      });
    }

    // 화면 크기가 바뀌거나 이미지가 늦게 로드되면 선 위치가 어긋나므로 다시 그린다.
    const onResize = function () {
      drawLines();
    };
    window.addEventListener('resize', onResize);
    container.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('load', onResize);
    });
    setTimeout(drawLines, 60);

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
      redraw: drawLines,
      destroy: function () {
        window.removeEventListener('resize', onResize);
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

  /* ---------------- 근사치: 숫자 키패드 ---------------- */

  /** 계산기처럼 숫자 버튼으로 값을 입력한다. (모바일 키보드가 뜨지 않음) */
  function buildNumberPad(body, question) {
    let digits = '';
    const unit = question.approxUnit || '';

    const display = el('div', 'numpad-display');
    const valueNode = el('span', 'numpad-value', '0');
    const unitNode = el('span', 'numpad-unit', unit);
    display.appendChild(valueNode);
    display.appendChild(unitNode);
    body.appendChild(display);

    const pad = el('div', 'numpad');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '←'];

    function refresh() {
      const n = digits === '' ? 0 : Number(digits);
      valueNode.textContent = n.toLocaleString('ko-KR');
      S.answer = digits === '' ? null : n;
    }

    keys.forEach(function (k) {
      const b = el('button', 'numkey' + (k === '←' ? ' wide-back' : ''), k);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (S.submitted) return;
        if (k === '←') {
          digits = digits.slice(0, -1);
        } else {
          // 자리수 폭주 방지 (최대 12자리)
          if (digits.length + k.length > 12) return;
          if (digits === '' && k === '00') return;
          digits += k;
          digits = digits.replace(/^0+(?=\d)/, '');
        }
        vibrate(8);
        refresh();
      });
      pad.appendChild(b);
    });
    body.appendChild(pad);

    const clearBtn = el('button', 'btn ghost small', '전체 지우기');
    clearBtn.type = 'button';
    clearBtn.style.cssText = 'margin-top:10px';
    clearBtn.addEventListener('click', function () {
      if (S.submitted) return;
      digits = '';
      refresh();
    });
    body.appendChild(clearBtn);

    body.appendChild(
      el('p', 'puzzle-legend', '정답에 가장 가까운 사람이 1등! 숫자 버튼으로 입력해 주세요.')
    );
    refresh();
  }

  /* ---------------- 근사치: 날짜 스크롤 ---------------- */

  /** 년/월/일을 스크롤(휠)로 고르는 피커 */
  function buildDateWheel(body, question) {
    const start = parseISO(question.approxDateStart) || { y: 1900, m: 1, d: 1 };
    const end = parseISO(question.approxDateEnd) || { y: 2100, m: 12, d: 31 };
    const today = new Date();
    // 초기값은 선택 가능 범위의 가운데쯤 (오늘이 범위 안이면 오늘)
    let cur = {
      y: Math.min(Math.max(today.getFullYear(), start.y), end.y),
      m: today.getMonth() + 1,
      d: today.getDate(),
    };

    const display = el('div', 'wheel-display');
    body.appendChild(display);

    const wheels = el('div', 'wheels');
    body.appendChild(wheels);

    const years = [];
    for (let y = start.y; y <= end.y; y++) years.push(y);

    const yearCol = makeWheel(years, cur.y, '년', function (v) {
      cur.y = v;
      rebuildDays();
      refresh();
    });
    const monthCol = makeWheel(range(1, 12), cur.m, '월', function (v) {
      cur.m = v;
      rebuildDays();
      refresh();
    });
    let dayCol = makeWheel(range(1, daysInMonth(cur.y, cur.m)), cur.d, '일', function (v) {
      cur.d = v;
      refresh();
    });

    wheels.appendChild(yearCol.node);
    wheels.appendChild(monthCol.node);
    wheels.appendChild(dayCol.node);

    function rebuildDays() {
      const max = daysInMonth(cur.y, cur.m);
      if (cur.d > max) cur.d = max;
      const fresh = makeWheel(range(1, max), cur.d, '일', function (v) {
        cur.d = v;
        refresh();
      });
      wheels.replaceChild(fresh.node, dayCol.node);
      dayCol = fresh;
    }

    function refresh() {
      const iso = toISO(cur.y, cur.m, cur.d);
      display.textContent = cur.y + '년 ' + cur.m + '월 ' + cur.d + '일';
      S.answer = iso;
    }

    body.appendChild(
      el('p', 'puzzle-legend', '위아래로 굴려서 날짜를 맞춰보세요. 정답에 가까울수록 높은 점수!')
    );
    refresh();
  }

  /** 스크롤 스냅으로 값을 고르는 세로 휠 하나 */
  function makeWheel(values, initial, suffix, onPick) {
    // 가운데 표시선(mask)은 스크롤 컨테이너 "밖"에 둬야 함께 스크롤되지 않는다.
    const wrap = el('div', 'wheel-wrap');
    const node = el('div', 'wheel');
    const list = el('div', 'wheel-list');
    node.appendChild(list);
    wrap.appendChild(node);
    wrap.appendChild(el('div', 'wheel-mask'));

    // 위아래 여백을 넣어야 첫/마지막 항목도 가운데로 올 수 있다.
    list.appendChild(el('div', 'wheel-pad'));
    values.forEach(function (v) {
      const item = el('div', 'wheel-item', String(v) + suffix);
      item.dataset.v = String(v);
      item.addEventListener('click', function () {
        scrollTo(values.indexOf(v));
      });
      list.appendChild(item);
    });
    list.appendChild(el('div', 'wheel-pad'));

    const ITEM_H = 38;
    function scrollTo(idx) {
      node.scrollTop = idx * ITEM_H;
    }
    function highlight() {
      const idx = Math.round(node.scrollTop / ITEM_H);
      Array.prototype.forEach.call(list.querySelectorAll('.wheel-item'), function (n, i) {
        n.classList.toggle('on', i === idx);
      });
      return values[Math.min(Math.max(idx, 0), values.length - 1)];
    }

    let settle = null;
    node.addEventListener('scroll', function () {
      highlight();
      if (settle) clearTimeout(settle);
      settle = setTimeout(function () {
        const v = highlight();
        if (v != null) onPick(v);
      }, 90);
    });

    const startIdx = Math.max(0, values.indexOf(initial));
    setTimeout(function () {
      scrollTo(startIdx);
      highlight();
    }, 0);

    return { node: wrap };
  }

  function range(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function toISO(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function parseISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    const parts = s.split('-');
    return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) };
  }

  /* ---------------- 문제 공개 (카드 뒤집기) ---------------- */

  const TYPE_EMOJI = { choice: '⚡', audio: '🔊', short: '✏️', puzzle: '🧩', approx: '🎯' };

  /**
   * 보드에서 보던 칸(앞면)이 그대로 떠올랐다가 뒤집히며 문제 카드(뒷면)가 나온다.
   * @param {boolean} instant 재접속처럼 이미 공개된 상태로 들어올 땐 애니메이션 없이 뒤집힌 채로.
   */
  function showReveal(data, instant) {
    const card = $('#flip-card');
    card.classList.remove('open');

    $('#ff-title').textContent = data.title || '문제';
    $('#ff-hearts').textContent = String(data.hearts || 0);

    const thumb = $('#fb-thumb');
    const img = $('#fb-image');
    if (data.image) {
      img.src = data.image;
      thumb.classList.add('has-image');
    } else {
      img.removeAttribute('src');
      thumb.classList.remove('has-image');
      $('#fb-emoji').textContent = TYPE_EMOJI[data.type] || '🎯';
    }
    $('#fb-sub').textContent = data.subtitle || '';
    $('#fb-title').textContent = data.title || '문제';
    $('#fb-text').textContent = data.text || TYPE_LABEL[data.type] || '';

    showOverlay('overlay-rank', false);
    showOverlay('overlay-reveal', true);

    if (instant) {
      card.classList.add('open');
      return;
    }
    vibrate([20, 60, 20]);
    // 앞면을 잠깐 보여준 뒤 뒤집는다
    if (S.flipTimer) clearTimeout(S.flipTimer);
    S.flipTimer = setTimeout(function () {
      card.classList.add('open');
      vibrate(30);
    }, 450);
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
    stopAllAudio();
    S.audios = [];

    showOverlay('overlay-reveal', false);
    showOverlay('overlay-rank', false);
    showScreen('question');

    $('#q-title').textContent = question.title + (question.subtitle ? ' · ' + question.subtitle : '');
    const typeBadge = $('#q-type');
    typeBadge.textContent = TYPE_LABEL[question.type] || '';
    typeBadge.className = typeBadgeClass(question.type);
    $('#q-x2').classList.toggle('hidden', !question.doublePoints);
    $('#q-text').textContent = question.text || '';
    const qImgWrap = $('#q-image-wrap');
    if (question.image) {
      $('#q-image').src = question.image;
      qImgWrap.classList.remove('hidden');
    } else {
      qImgWrap.classList.add('hidden');
    }
    $('#hint-box').classList.add('hidden');
    $('#hint-box').textContent = '';

    const body = $('#q-body');
    body.innerHTML = '';

    if (question.type === 'choice' || question.type === 'audio') {
      const list = el('div', 'options');
      (question.options || []).forEach(function (opt, order) {
        const b = el('button', 'opt');
        b.type = 'button';
        if (opt.image) {
          const img = el('img', 'opt-img');
          img.src = opt.image;
          img.alt = '';
          b.appendChild(img);
        }
        const row = el('div', 'opt-row');
        row.appendChild(el('span', 'k', String(order + 1)));
        row.appendChild(el('span', null, opt.text));
        b.appendChild(row);

        // 음성이 붙어 있으면 재생 버튼을 넣는다. 재생 버튼을 눌러도 보기가 선택되지는 않는다.
        if (opt.audio) {
          const audio = new Audio(opt.audio);
          audio.preload = 'none';
          const playBtn = el('span', 'opt-play', '▶︎ 듣기');
          playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            // 다른 보기 음성은 멈추고 이 보기만 재생
            stopAllAudio();
            if (audio.paused) {
              audio.play().catch(function () {
                toast('음성을 재생하지 못했어요.', 'err');
              });
              playBtn.textContent = '⏸ 정지';
            }
          });
          audio.addEventListener('ended', function () {
            playBtn.textContent = '▶︎ 듣기';
          });
          audio.addEventListener('pause', function () {
            playBtn.textContent = '▶︎ 듣기';
          });
          S.audios.push(audio);
          b.appendChild(playBtn);
        }

        b.addEventListener('click', function () {
          if (S.submitted) return;
          S.answer = opt.i;
          Array.prototype.forEach.call(list.children, function (c) {
            c.classList.remove('selected');
          });
          b.classList.add('selected');
          vibrate(10);
        });
        list.appendChild(b);
      });
      body.appendChild(list);
    } else if (question.type === 'approx') {
      if (question.approxMode === 'date') buildDateWheel(body, question);
      else buildNumberPad(body, question);
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
    const t = S.question.type;
    if (t === 'choice' || t === 'audio' || t === 'approx') return S.answer;
    if (t === 'short') {
      const input = document.getElementById('short-answer');
      return input ? input.value : S.answer;
    }
    if (t === 'puzzle') return S.puzzle ? S.puzzle.getAnswer() : null;
    return null;
  }

  function submit(auto) {
    if (!S.question || S.submitted) return;
    const t = S.question.type;
    const answer = currentAnswer();
    if (!auto) {
      if ((t === 'choice' || t === 'audio') && answer == null) {
        toast('보기를 선택해 주세요.', 'err');
        return;
      }
      if (t === 'short' && !String(answer || '').trim()) {
        toast('정답을 입력해 주세요.', 'err');
        return;
      }
      if (t === 'approx' && (answer == null || answer === '')) {
        toast(
          S.question.approxMode === 'date' ? '날짜를 골라 주세요.' : '숫자를 입력해 주세요.',
          'err'
        );
        return;
      }
      // 퍼즐은 부분 점수가 있으므로 다 연결하지 않아도 제출할 수 있다.
      if (t === 'puzzle' && S.puzzle && S.puzzle.matchedCount() === 0) {
        toast('카드를 하나 이상 연결해 주세요.', 'err');
        return;
      }
    }
    stopAllAudio();
    // 결과 화면에서 "내가 연결한 짝"과 비교해 보여주기 위해 기억해 둔다.
    if (t === 'puzzle') S.myPuzzleAnswer = Array.isArray(answer) ? answer.slice() : null;
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

  /** 결과 화면에 보기 전체(객관식) 또는 짝 전체(퍼즐)를 풀이로 보여준다. */
  function renderBreakdown(data) {
    const wrap = $('#r-breakdown-wrap');
    const holder = $('#r-breakdown');
    holder.innerHTML = '';

    if ((data.type === 'choice' || data.type === 'audio') && Array.isArray(data.options) && data.options.length) {
      $('#r-breakdown-title').textContent = '보기별 정답 확인';
      const list = el('div', 'bd-list');
      data.options.forEach(function (o, order) {
        const item = el('div', 'bd-item' + (o.correct ? ' correct' : ''));
        item.appendChild(el('span', 'k', String(order + 1)));
        if (o.image) {
          const img = el('img');
          img.src = o.image;
          img.alt = '';
          item.appendChild(img);
        }
        item.appendChild(el('span', 'tx', o.text));
        // 음성 보기는 결과 화면에서도 다시 들어볼 수 있게
        if (o.audio) {
          const audio = new Audio(o.audio);
          audio.preload = 'none';
          const play = el('span', 'opt-play', '▶︎');
          play.addEventListener('click', function (e) {
            e.stopPropagation();
            stopAllAudio();
            audio.play().catch(function () {});
          });
          S.audios.push(audio);
          item.appendChild(play);
        }
        if (o.correct) item.appendChild(el('span', 'mark', '정답 ✓'));
        list.appendChild(item);
      });
      holder.appendChild(list);
      wrap.classList.remove('hidden');
      return;
    }

    if (data.type === 'puzzle' && Array.isArray(data.pairs) && data.pairs.length) {
      $('#r-breakdown-title').textContent = '정답 짝 (내가 연결한 것과 비교해 보세요)';
      const list = el('div', 'bd-list');
      const mine = Array.isArray(data.myAnswer) ? data.myAnswer : S.myPuzzleAnswer;
      data.pairs.forEach(function (p, i) {
        const gotIt = Array.isArray(mine) && Number(mine[i]) === i;
        const item = el('div', 'bd-pair' + (Array.isArray(mine) ? (gotIt ? ' ok' : ' no') : ''));
        item.appendChild(sideNode(p.left));
        item.appendChild(el('span', 'bd-arrow', '→'));
        item.appendChild(sideNode(p.right));
        if (Array.isArray(mine)) {
          item.appendChild(el('span', 'bd-mark', gotIt ? '⭕️' : '❌'));
        }
        list.appendChild(item);
      });
      holder.appendChild(list);
      wrap.classList.remove('hidden');
      return;
    }

    if (data.type === 'approx') {
      $('#r-breakdown-title').textContent = '근사치 결과';
      const box = el('div', 'bd-approx');
      const answerText =
        data.approxMode === 'date'
          ? String(data.approxAnswer || '')
          : Number(data.approxAnswer || 0).toLocaleString('ko-KR') + (data.approxUnit || '');
      box.appendChild(el('div', 'bd-approx-label', '정답'));
      box.appendChild(el('div', 'bd-approx-value', answerText));
      holder.appendChild(box);
      wrap.classList.remove('hidden');
      return;
    }

    wrap.classList.add('hidden');
  }

  /** 근사치/퍼즐 결과에서 "얼마나 차이났는지"를 사람이 읽기 좋게 */
  function diffText(type, r, approxMode, unit) {
    if (type === 'approx' && r.distance != null) {
      if (approxMode === 'date') return r.distance === 0 ? '정확!' : r.distance + '일 차이';
      return r.distance === 0
        ? '정확!'
        : Number(r.distance).toLocaleString('ko-KR') + (unit || '') + ' 차이';
    }
    if (type === 'puzzle' && r.totalCount) return r.correctCount + '/' + r.totalCount + '개';
    return '';
  }

  function sideNode(card) {
    const node = el('div', 'bd-side');
    if (card.image) {
      const img = el('img');
      img.src = card.image;
      img.alt = '';
      node.appendChild(img);
    }
    node.appendChild(el('span', null, card.text));
    return node;
  }

  function renderResult(data) {
    stopTicker();
    S.question = null;
    S.lastResult = data;
    showOverlay('overlay-reveal', false);
    showScreen('result');

    const rImgWrap = $('#r-image-wrap');
    if (data.image) {
      $('#r-image').src = data.image;
      rImgWrap.classList.remove('hidden');
    } else {
      rImgWrap.classList.add('hidden');
    }

    const mine = S.me
      ? (data.results || []).find(function (r) {
          return r.nick === S.me.nick;
        })
      : null;

    // 유형마다 "잘했다"의 기준이 달라서 문구를 나눠 준다.
    let emoji = '🙈';
    let title = '아쉬워요!';
    if (!mine) {
      emoji = '⏰';
      title = '제출하지 못했어요';
    } else if (data.type === 'approx') {
      if (mine.rank === 1) {
        emoji = mine.distance === 0 ? '🎯' : '🥇';
        title = mine.distance === 0 ? '정확히 맞혔어요!' : '1등! 가장 가까웠어요!';
      } else if (mine.rank && mine.rank <= 4) {
        emoji = '🎉';
        title = mine.rank + '등! 꽤 가까웠어요';
      } else {
        emoji = '👏';
        title = '참여 점수를 받았어요';
      }
    } else if (data.type === 'puzzle') {
      if (mine.correct) {
        emoji = mine.rank === 1 ? '🥇' : '🎉';
        title = mine.rank === 1 ? '1등! 전부 맞혔어요!' : mine.rank + '등! 전부 맞혔어요';
      } else if (mine.correctCount > 0) {
        emoji = '👏';
        title = mine.correctCount + '개 맞혔어요! (' + (mine.rank ? mine.rank + '등' : '순위 밖') + ')';
      } else {
        emoji = '😢';
        title = '한 개도 못 맞혔어요…';
      }
    } else if (mine.correct) {
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
    } else {
      emoji = '😢';
      title = '오답이에요…';
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

    const explBox = $('#r-explanation-box');
    if (data.explanation && String(data.explanation).trim()) {
      $('#r-explanation').textContent = data.explanation;
      explBox.classList.remove('hidden');
    } else {
      explBox.classList.add('hidden');
    }

    renderBreakdown(data);

    const list = $('#r-list');
    list.innerHTML = '';
    if (!data.results || !data.results.length) {
      list.appendChild(el('div', 'muted center tiny', '제출한 사람이 없어요.'));
    }
    (data.results || []).forEach(function (r) {
      const ranked = r.rank != null;
      const row = el('div', 'rank-row' + (ranked && r.rank === 1 ? ' top1' : '') + (ranked ? '' : ' wrong'));
      if (S.me && r.nick === S.me.nick) row.classList.add('me');
      row.appendChild(el('span', 'no', ranked ? String(r.rank) : '✗'));
      row.appendChild(el('span', 'nm', r.nick));
      // 근사치는 "얼마나 차이났는지", 퍼즐은 "몇 개 맞혔는지"를 시간보다 먼저 보여준다.
      const extra = diffText(data.type, r, data.approxMode, data.approxUnit);
      if (extra) row.appendChild(el('span', 'dv', extra));
      if (data.type === 'approx' && r.answerLabel) {
        row.appendChild(el('span', 'tm', r.answerLabel));
      } else {
        row.appendChild(el('span', 'tm', (r.elapsed / 1000).toFixed(2) + '초'));
      }
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
    showOverlay('overlay-reveal', false);
    showOverlay('overlay-rank', false);
    showScreen('practice');
    $('#pr-text').textContent = puzzle.text || '카드를 눌러 짝을 맞춰보세요!';

    const card = function (c) {
      return typeof c === 'string' ? { text: c, image: '' } : { text: (c && c.text) || '', image: (c && c.image) || '' };
    };
    const lefts = puzzle.pairs.map(function (p, i) {
      const c = card(p.left);
      return { i: i, text: c.text, image: c.image };
    });
    const rights = puzzle.pairs
      .map(function (p, i) {
        const c = card(p.right);
        return { i: i, text: c.text, image: c.image };
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
    renderRoster(d.playerRoster);
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
    } else if (d.round && d.round.stage === 'reveal') {
      showScreen('board');
      showReveal(d.round, true);
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

  socket.on('emote:show', function (d) {
    emoteLayer.show(d && d.id);
  });

  socket.on('players:roster', function (d) {
    renderRoster(d.players);
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
    showOverlay('overlay-reveal', false);
    renderBoard(d.board);
    showScreen('board');
  });

  socket.on('hearts:update', function (d) {
    updateHearts(d.items || []);
  });

  socket.on('round:reveal', function (d) {
    clock.sync(d.serverNow);
    if (!S.me) return;
    showScreen('board');
    showReveal(d);
  });

  socket.on('round:cancel', function () {
    if (S.flipTimer) clearTimeout(S.flipTimer);
    showOverlay('overlay-reveal', false);
    toast('진행자가 출제를 취소했어요.', 'err');
  });

  socket.on('round:start', function (d) {
    clock.sync(d.serverNow);
    if (!S.me) return;
    if (S.flipTimer) clearTimeout(S.flipTimer);
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
    showOverlay('overlay-reveal', false);
    showOverlay('overlay-rank', false);
    showScreen('join');
    toast((d && d.reason) || '연결이 종료되었습니다.', 'err', 4000);
  });
})();
