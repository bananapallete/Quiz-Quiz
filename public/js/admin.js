/* 진행자(노트북) 콘솔 */
(function () {
  'use strict';

  const { $, $$, el, clock, toast, TYPE_LABEL, TYPE_SHORT, typeBadgeClass } = window.QQ;
  const socket = io();

  const A = {
    authed: false,
    state: null,
    players: [],
    rankingVisible: false,
    practiceOn: false,
    liveTimer: null,
    editorBuilt: false,
  };

  /* ---------------- 로그인 ---------------- */

  function authenticate(pw, silent) {
    socket.emit('admin:auth', { password: pw }, function (res) {
      if (!res || !res.ok) {
        if (!silent) toast((res && res.error) || '인증 실패', 'err');
        sessionStorage.removeItem('qq_admin_pw');
        return;
      }
      sessionStorage.setItem('qq_admin_pw', pw);
      A.authed = true;
      $('#admin-login').classList.remove('active');
      $('#admin-main').classList.remove('hidden');
      $('#join-url').textContent = location.origin;
    });
  }

  $('#login-btn').addEventListener('click', function () {
    authenticate($('#pw').value);
  });
  $('#pw').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') authenticate($('#pw').value);
  });

  /* ---------------- 이미지 업로드 ---------------- */

  /** 사진을 캔버스로 리사이즈·압축해 data URL 문자열로 반환한다. */
  function compressImageFile(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('이미지 파일만 선택할 수 있어요.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('파일을 읽지 못했어요.'));
      };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () {
          reject(new Error('이미지를 불러오지 못했어요.'));
        };
        img.onload = function () {
          let w = img.width;
          let h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * 이미지 업로드 위젯 하나를 만든다. 값은 hidden input(data-f) 에 저장되므로
   * 기존 collect() 의 val() 로 똑같이 읽을 수 있다.
   */
  function buildImageField(dataF, initialValue) {
    const wrap = el('div');
    wrap.style.cssText = 'margin-bottom:10px';

    const hidden = el('input');
    hidden.type = 'hidden';
    hidden.dataset.f = dataF;
    hidden.value = initialValue || '';

    const preview = el('img');
    preview.style.cssText =
      'max-width:220px;max-height:130px;border-radius:10px;display:none;margin-bottom:6px;border:1px solid var(--border);object-fit:cover';

    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.cssText = 'max-width:190px;font-size:12px';

    const clearBtn = el('button', 'btn ghost small', '이미지 삭제');
    clearBtn.type = 'button';

    function refresh() {
      if (hidden.value) {
        preview.src = hidden.value;
        preview.style.display = 'block';
        clearBtn.style.display = 'inline-flex';
      } else {
        preview.style.display = 'none';
        preview.src = '';
        clearBtn.style.display = 'none';
      }
    }

    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      compressImageFile(file, 900, 0.72)
        .then(function (dataUrl) {
          hidden.value = dataUrl;
          refresh();
        })
        .catch(function (err) {
          toast((err && err.message) || '이미지를 불러오지 못했어요.', 'err');
        });
    });
    clearBtn.addEventListener('click', function () {
      hidden.value = '';
      refresh();
    });

    row.appendChild(fileInput);
    row.appendChild(clearBtn);
    wrap.appendChild(hidden);
    wrap.appendChild(preview);
    wrap.appendChild(row);
    refresh();
    return wrap;
  }

  /* ---------------- 탭 ---------------- */

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      ['run', 'edit', 'settings'].forEach(function (name) {
        $('#tab-' + name).classList.toggle('hidden', name !== tab.dataset.tab);
      });
      if (tab.dataset.tab === 'edit' && A.state) buildEditor(A.state.questions);
    });
  });

  /* ---------------- 진행 보드 ---------------- */

  function renderAdminBoard(state) {
    const board = state.board;
    const maxHearts = Math.max.apply(
      null,
      [1].concat(
        board.map(function (b) {
          return b.hearts || 0;
        })
      )
    );
    const holder = $('#admin-board');
    holder.innerHTML = '';

    board.forEach(function (q) {
      const hot = q.hearts > 0 && q.hearts >= maxHearts * 0.6;
      const tile = el('div', 'a-tile' + (q.played ? ' played' : '') + (hot ? ' hot' : ''));

      const head = el('div');
      head.appendChild(el('div', 'a-title', q.index + 1 + '. ' + q.title));
      if (q.subtitle) head.appendChild(el('div', 'a-sub', q.subtitle));
      tile.appendChild(head);

      const meta = el('div', 'a-meta');
      const tb = el('span', typeBadgeClass(q.type), TYPE_SHORT[q.type] || q.type);
      meta.appendChild(tb);
      if (q.doublePoints) meta.appendChild(el('span', 'badge x2', '2배'));
      if (q.played) meta.appendChild(el('span', 'badge', '출제됨'));
      const full = (state.questions || []).find(function (x) {
        return x.id === q.id;
      });
      const hasImage = full && (full.image || (full.options || []).some(function (o) {
        return o && o.image;
      }));
      if (hasImage) meta.appendChild(el('span', 'badge', '🖼'));
      meta.appendChild(el('span', 'a-hearts', '💗 ' + (q.hearts || 0)));
      tile.appendChild(meta);

      const actions = el('div', 'a-actions');

      const startBtn = el('button', 'btn small', '▶ 출제하기');
      startBtn.addEventListener('click', function () {
        socket.emit('admin:startQuestion', { questionId: q.id }, function (res) {
          if (!res || !res.ok) toast((res && res.error) || '출제 실패', 'err');
        });
      });
      actions.appendChild(startBtn);

      const x2Btn = el('button', 'btn ghost small', q.doublePoints ? '2배 끄기' : '2배 켜기');
      x2Btn.addEventListener('click', function () {
        socket.emit('admin:setDouble', { questionId: q.id, value: !q.doublePoints }, function (res) {
          if (!res || !res.ok) toast((res && res.error) || '변경 실패', 'err');
        });
      });
      actions.appendChild(x2Btn);

      const editBtn = el('button', 'btn ghost small', '✏️');
      editBtn.title = '이 문제 편집';
      editBtn.addEventListener('click', function () {
        $$('.tab').forEach(function (t) {
          t.classList.toggle('active', t.dataset.tab === 'edit');
        });
        ['run', 'edit', 'settings'].forEach(function (name) {
          $('#tab-' + name).classList.toggle('hidden', name !== 'edit');
        });
        buildEditor(A.state.questions);
        const details = document.getElementById('ed-' + q.id);
        if (details) {
          details.open = true;
          details.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      actions.appendChild(editBtn);

      const playedBtn = el('button', 'btn ghost small', q.played ? '↩︎' : '✓');
      playedBtn.title = q.played ? '출제 기록 해제' : '출제됨으로 표시';
      playedBtn.addEventListener('click', function () {
        socket.emit('admin:togglePlayed', { questionId: q.id });
      });
      actions.appendChild(playedBtn);

      tile.appendChild(actions);
      holder.appendChild(tile);
    });
  }

  /* ---------------- 라이브 패널 ---------------- */

  function updateLivePanel(state) {
    const panel = $('#live-panel');
    const round = state.round;
    const running = state.phase === 'countdown' || state.phase === 'question';

    if (!round || !running) {
      panel.classList.add('hidden');
      if (A.liveTimer) {
        clearInterval(A.liveTimer);
        A.liveTimer = null;
      }
      return;
    }

    const q = state.questions.find(function (x) {
      return x.id === round.questionId;
    });
    panel.classList.remove('hidden');
    $('#live-title').textContent = q ? q.title + (q.subtitle ? ' · ' + q.subtitle : '') : '진행 중';
    const tb = $('#live-type');
    tb.textContent = q ? TYPE_LABEL[q.type] : '';
    tb.className = q ? typeBadgeClass(q.type) : 'badge';
    $('#live-submitted').textContent = round.submitted || 0;
    $('#live-x2').textContent = round.doublePoints ? '2배 ⭐' : '1배';
    $('#btn-live-x2').textContent = round.doublePoints ? '⭐ 2배 점수 끄기' : '⭐ 2배 점수 켜기';
    $('#live-answer').textContent = q ? '정답 : ' + answerText(q) + (q.hint ? '  ·  힌트 : ' + q.hint : '') : '';

    if (A.liveTimer) clearInterval(A.liveTimer);
    A.liveTimer = setInterval(function () {
      const now = clock.now();
      if (state.phase === 'countdown') {
        $('#live-timer').textContent = '출제 대기…';
        return;
      }
      if (!round.startedAt) return;
      const remain = Math.max(0, round.timeLimit * 1000 - (now - round.startedAt));
      $('#live-timer').textContent = (remain / 1000).toFixed(1) + '초';
    }, 100);
  }

  function answerText(q) {
    if (q.type === 'choice') return (q.options[q.answerIndex] && q.options[q.answerIndex].text) || '(미설정)';
    if (q.type === 'short') return (q.answers || []).join(' / ') || '(미설정)';
    if (q.type === 'puzzle')
      return q.pairs
        .map(function (p) {
          return p.left + '→' + p.right;
        })
        .join(', ');
    return '';
  }

  function renderResultPanel(results, question) {
    const panel = $('#result-panel');
    if (!results) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    const list = $('#result-list');
    list.innerHTML = '';
    if (!results.length) {
      list.appendChild(el('div', 'muted tiny center', '제출한 사람이 없습니다.'));
      return;
    }
    results.forEach(function (r) {
      const row = el('div', 'rank-row' + (r.correct && r.rank === 1 ? ' top1' : ''));
      row.appendChild(el('span', 'no', r.correct ? String(r.rank) : '✗'));
      row.appendChild(el('span', 'nm', r.nick));
      row.appendChild(el('span', 'tm', (r.elapsed / 1000).toFixed(2) + '초'));
      row.appendChild(el('span', 'pt', (r.gained ? '+' + r.gained : '0') + ' (' + r.total + ')'));
      list.appendChild(row);
    });
  }

  /* ---------------- 참가자 목록 ---------------- */

  function renderPlayers(count, players) {
    A.players = players;
    $('#player-count').textContent = players.length;
    $('#online-count').textContent = '접속 ' + count + '명';
    $('#live-players').textContent = count;

    const list = $('#player-list');
    list.innerHTML = '';
    if (!players.length) {
      list.appendChild(el('div', 'muted tiny center', '아직 참가자가 없습니다.'));
      return;
    }
    players.forEach(function (p, i) {
      const row = el('div', 'player-row');
      row.appendChild(el('span', 'conn-dot' + (p.connected ? '' : ' off')));
      row.appendChild(el('span', 'tiny muted', String(i + 1)));
      row.appendChild(el('span', 'pname', p.nick));
      row.appendChild(el('span', 'pscore', String(p.score)));

      const minus = el('button', 'btn ghost small', '−');
      minus.addEventListener('click', function () {
        socket.emit('admin:adjustScore', { key: p.key, delta: -1 });
      });
      const plus = el('button', 'btn ghost small', '+');
      plus.addEventListener('click', function () {
        socket.emit('admin:adjustScore', { key: p.key, delta: 1 });
      });
      const del = el('button', 'btn ghost small', '×');
      del.title = '참가자 삭제';
      del.addEventListener('click', function () {
        if (confirm(p.nick + ' 참가자를 삭제할까요? 점수도 함께 사라집니다.')) {
          socket.emit('admin:removePlayer', { key: p.key });
        }
      });
      row.appendChild(minus);
      row.appendChild(plus);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  /* ---------------- 문제 편집기 ---------------- */

  function buildEditor(questions) {
    const holder = $('#editor-list');
    holder.innerHTML = '';
    questions.forEach(function (q) {
      holder.appendChild(buildEditorItem(q));
    });
    A.editorBuilt = true;
  }

  function buildEditorItem(q) {
    const details = el('details', 'editor-item');
    details.id = 'ed-' + q.id;

    const summary = el('summary');
    details.appendChild(summary);

    // 저장 직후에도 접힌 요약(제목·유형·배지)이 다시 열지 않아도 바로 최신 상태로 보이도록 분리해둔다.
    function refreshSummary(cur) {
      summary.innerHTML = '';
      summary.appendChild(el('span', 'idx', String(cur.index != null ? cur.index + 1 : q.index + 1)));
      summary.appendChild(el('span', null, cur.title));
      summary.appendChild(el('span', 'tiny muted', cur.subtitle || ''));
      const sBadge = el('span', typeBadgeClass(cur.type), TYPE_SHORT[cur.type]);
      sBadge.style.marginLeft = 'auto';
      summary.appendChild(sBadge);
      if (cur.doublePoints) summary.appendChild(el('span', 'badge x2', '2배'));
      const hasImage = cur.image || (cur.options || []).some(function (o) {
        return o && o.image;
      });
      if (hasImage) summary.appendChild(el('span', 'badge', '🖼 이미지'));
    }
    refreshSummary(q);

    const body = el('div', 'editor-body');

    // 타이틀 / 부제목
    const row1 = el('div', 'row2');
    row1.appendChild(field('타이틀 (칸에 크게 표시)', inputNode('text', q.title, 'f-title')));
    row1.appendChild(field('부제목 (칸에 작게 표시)', inputNode('text', q.subtitle || '', 'f-subtitle')));
    body.appendChild(row1);

    // 유형 / 제한시간
    const typeSel = el('select', 'select');
    typeSel.dataset.f = 'f-type';
    [
      ['choice', '⚡ 선착순 객관식'],
      ['short', '✏️ 주관식'],
      ['puzzle', '🧩 퍼즐 매칭'],
    ].forEach(function (pair) {
      const o = el('option', null, pair[1]);
      o.value = pair[0];
      if (q.type === pair[0]) o.selected = true;
      typeSel.appendChild(o);
    });
    const row2 = el('div', 'row2');
    row2.appendChild(field('문제 유형', typeSel));
    row2.appendChild(field('제한시간 (초)', inputNode('number', q.timeLimit, 'f-timeLimit')));
    body.appendChild(row2);

    // 문제 본문
    const ta = el('textarea', 'textarea');
    ta.dataset.f = 'f-text';
    ta.value = q.text || '';
    ta.placeholder = '참가자에게 보여줄 문제 내용';
    body.appendChild(field('문제 내용', ta));

    // 문제 이미지 (모든 유형 공통)
    body.appendChild(field('문제 이미지 (선택)', buildImageField('f-image', q.image)));

    // 객관식
    const choiceBox = el('div');
    choiceBox.dataset.sec = 'choice';
    const optLabel = el('label', null, '보기 (라디오를 눌러 정답 지정, 이미지는 선택)');
    optLabel.style.cssText = 'display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px';
    choiceBox.appendChild(optLabel);
    const opts = q.options && q.options.length ? q.options : ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const opt = opts[i] && typeof opts[i] === 'object' ? opts[i] : { text: opts[i] || '', image: '' };
      const optWrap = el('div');
      optWrap.style.cssText = 'margin-bottom:14px;padding-bottom:10px;border-bottom:1px dashed var(--border)';
      const line = el('div', 'opt-edit');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'ans-' + q.id;
      radio.dataset.f = 'f-answerIndex';
      radio.value = String(i);
      if (Number(q.answerIndex) === i) radio.checked = true;
      const inp = el('input', 'input');
      inp.type = 'text';
      inp.dataset.f = 'f-option';
      inp.value = opt.text || '';
      inp.placeholder = i + 1 + '번 보기';
      line.appendChild(radio);
      line.appendChild(inp);
      optWrap.appendChild(line);
      optWrap.appendChild(buildImageField('f-option-image', opt.image));
      choiceBox.appendChild(optWrap);
    }
    body.appendChild(choiceBox);

    // 주관식
    const shortBox = el('div');
    shortBox.dataset.sec = 'short';
    const ansInput = inputNode('text', (q.answers || []).join(', '), 'f-answers');
    ansInput.placeholder = '정답1, 정답2 (쉼표로 여러 개)';
    shortBox.appendChild(
      field('정답 (쉼표로 구분 · 띄어쓰기/대소문자는 무시됩니다)', ansInput)
    );
    body.appendChild(shortBox);

    // 퍼즐
    const puzzleBox = el('div');
    puzzleBox.dataset.sec = 'puzzle';
    const pLabel = el('label', null, '매칭 짝 (왼쪽 ↔ 오른쪽, 최대 6쌍)');
    pLabel.style.cssText = 'display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px';
    puzzleBox.appendChild(pLabel);
    const pairs = (q.pairs || []).slice();
    for (let i = 0; i < 6; i++) {
      const p = pairs[i] || { left: '', right: '' };
      const line = el('div', 'pair-edit');
      const l = el('input', 'input');
      l.type = 'text';
      l.dataset.f = 'f-pair-left';
      l.value = p.left;
      l.placeholder = '왼쪽 카드';
      const arrow = el('div', 'center muted', '↔');
      const r = el('input', 'input');
      r.type = 'text';
      r.dataset.f = 'f-pair-right';
      r.value = p.right;
      r.placeholder = '오른쪽 카드';
      const num = el('div', 'tiny muted center', String(i + 1));
      line.appendChild(l);
      line.appendChild(arrow);
      line.appendChild(r);
      line.appendChild(num);
      puzzleBox.appendChild(line);
    }
    body.appendChild(puzzleBox);

    // 힌트 / 2배
    const hintInput = inputNode('text', q.hint || '', 'f-hint');
    hintInput.placeholder = '종료 N초 전에 참가자에게 공개됩니다';
    body.appendChild(field('힌트', hintInput));

    const dblWrap = el('label');
    dblWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:12px;cursor:pointer';
    const dbl = el('input');
    dbl.type = 'checkbox';
    dbl.dataset.f = 'f-doublePoints';
    dbl.checked = !!q.doublePoints;
    dbl.style.cssText = 'width:20px;height:20px;accent-color:var(--accent)';
    dblWrap.appendChild(dbl);
    dblWrap.appendChild(el('span', null, '⭐ 이 문제에 2배 점수 적용'));
    body.appendChild(dblWrap);

    // 저장
    const saveRow = el('div');
    saveRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const saveBtn = el('button', 'btn small', '💾 저장');
    saveBtn.addEventListener('click', function () {
      const payload = collect(body, q);
      socket.emit('admin:saveQuestion', { question: payload }, function (res) {
        if (res && res.ok) {
          toast(payload.title + ' 저장 완료 ✓', 'ok');
          refreshSummary(payload);
        } else {
          toast((res && res.error) || '저장 실패', 'err');
        }
      });
    });
    const startBtn = el('button', 'btn ghost small', '▶ 저장하고 바로 출제');
    startBtn.addEventListener('click', function () {
      const payload = collect(body, q);
      socket.emit('admin:saveQuestion', { question: payload }, function (res) {
        if (!res || !res.ok) {
          toast((res && res.error) || '저장 실패', 'err');
          return;
        }
        refreshSummary(payload);
        socket.emit('admin:startQuestion', { questionId: q.id }, function (r2) {
          if (!r2 || !r2.ok) toast((r2 && r2.error) || '출제 실패', 'err');
          else toast('출제했습니다!', 'ok');
        });
      });
    });
    saveRow.appendChild(saveBtn);
    saveRow.appendChild(startBtn);
    body.appendChild(saveRow);

    details.appendChild(body);

    function syncSections() {
      const t = typeSel.value;
      choiceBox.style.display = t === 'choice' ? 'block' : 'none';
      shortBox.style.display = t === 'short' ? 'block' : 'none';
      puzzleBox.style.display = t === 'puzzle' ? 'block' : 'none';
    }
    typeSel.addEventListener('change', syncSections);
    syncSections();

    return details;
  }

  function field(labelText, node) {
    const wrap = el('div', 'field');
    wrap.appendChild(el('label', null, labelText));
    wrap.appendChild(node);
    return wrap;
  }

  function inputNode(type, value, fname) {
    const n = el('input', 'input');
    n.type = type;
    n.value = value == null ? '' : value;
    n.dataset.f = fname;
    return n;
  }

  function collect(body, q) {
    function val(f) {
      const n = body.querySelector('[data-f="' + f + '"]');
      return n ? n.value : '';
    }
    const optionTexts = Array.prototype.map.call(
      body.querySelectorAll('[data-f="f-option"]'),
      function (n) {
        return n.value;
      }
    );
    const optionImages = Array.prototype.map.call(
      body.querySelectorAll('[data-f="f-option-image"]'),
      function (n) {
        return n.value;
      }
    );
    const options = optionTexts.map(function (text, i) {
      return { text: text, image: optionImages[i] || '' };
    });
    const checkedRadio = body.querySelector('[data-f="f-answerIndex"]:checked');
    const lefts = body.querySelectorAll('[data-f="f-pair-left"]');
    const rights = body.querySelectorAll('[data-f="f-pair-right"]');
    const pairs = [];
    for (let i = 0; i < lefts.length; i++) {
      pairs.push({ left: lefts[i].value, right: rights[i] ? rights[i].value : '' });
    }
    return {
      id: q.id,
      title: val('f-title') || q.title,
      subtitle: val('f-subtitle'),
      type: val('f-type'),
      text: val('f-text'),
      image: val('f-image'),
      timeLimit: parseInt(val('f-timeLimit'), 10) || q.timeLimit,
      hint: val('f-hint'),
      doublePoints: !!body.querySelector('[data-f="f-doublePoints"]').checked,
      options: options,
      answerIndex: checkedRadio ? Number(checkedRadio.value) : 0,
      answers: val('f-answers')
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean),
      pairs: pairs.filter(function (p) {
        return p.left.trim() && p.right.trim();
      }),
    };
  }

  /* ---------------- 상단 버튼 ---------------- */

  $('#btn-ranking').addEventListener('click', function () {
    socket.emit('admin:ranking', { visible: !A.rankingVisible }, function (res) {
      if (!res || !res.ok) toast((res && res.error) || '실패', 'err');
    });
  });

  $('#btn-practice').addEventListener('click', function () {
    socket.emit('admin:practice', { on: !A.practiceOn }, function (res) {
      if (!res || !res.ok) toast((res && res.error) || '실패', 'err');
    });
  });

  $('#btn-board').addEventListener('click', function () {
    socket.emit('admin:backToBoard', {}, function () {
      renderResultPanel(null);
    });
  });

  $('#btn-end').addEventListener('click', function () {
    socket.emit('admin:endRound', {}, function (res) {
      if (!res || !res.ok) toast((res && res.error) || '실패', 'err');
    });
  });

  $('#btn-live-x2').addEventListener('click', function () {
    if (!A.state || !A.state.round) return;
    socket.emit('admin:setDouble', {
      questionId: A.state.round.questionId,
      value: !A.state.round.doublePoints,
    });
  });

  $('#btn-save-settings').addEventListener('click', function () {
    const settings = {
      scoreFirst: $('#s-first').value,
      scoreTop: $('#s-top').value,
      scoreTopUntilRank: $('#s-until').value,
      scoreRest: $('#s-rest').value,
      countdownSeconds: $('#s-count').value,
      hintBeforeSeconds: $('#s-hint').value,
    };
    socket.emit('admin:saveSettings', { settings: settings }, function (res) {
      if (res && res.ok) toast('설정을 저장했습니다 ✓', 'ok');
      else toast((res && res.error) || '저장 실패', 'err');
    });
  });

  $$('[data-reset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const what = btn.dataset.reset;
      const labels = {
        hearts: '모든 하트를 0으로 되돌릴까요?',
        played: '출제 기록을 모두 지울까요?',
        scores: '모든 참가자의 점수를 0으로 만들까요?',
        players: '참가자를 전부 삭제할까요? (점수도 사라집니다)',
        all: '하트 · 점수 · 참가자 · 출제기록을 모두 초기화할까요?',
      };
      if (!confirm(labels[what] || '진행할까요?')) return;
      socket.emit('admin:reset', { what: what }, function (res) {
        if (res && res.ok) toast('초기화 완료', 'ok');
        else toast((res && res.error) || '실패', 'err');
      });
    });
  });

  /* ---------------- 설정 폼 반영 ---------------- */

  function fillSettings(s) {
    $('#s-first').value = s.scoreFirst;
    $('#s-top').value = s.scoreTop;
    $('#s-until').value = s.scoreTopUntilRank;
    $('#s-rest').value = s.scoreRest;
    $('#s-count').value = s.countdownSeconds;
    $('#s-hint').value = s.hintBeforeSeconds;
    $('#settings-preview').textContent =
      '지금 규칙 : 1등 ' +
      s.scoreFirst +
      '점, 2~' +
      s.scoreTopUntilRank +
      '등 ' +
      s.scoreTop +
      '점, 그 외 정답자 ' +
      s.scoreRest +
      '점 · 카운트다운 ' +
      s.countdownSeconds +
      '초 · 종료 ' +
      s.hintBeforeSeconds +
      '초 전 힌트 공개';
  }

  const PHASE_LABEL = {
    lobby: '대기 중 · 참가자들이 하트를 누르고 있어요',
    countdown: '출제 카운트다운 중…',
    question: '문제 진행 중',
    result: '결과 화면 표시 중',
    practice: '퍼즐 연습 화면 표시 중',
  };

  /* ---------------- 소켓 ---------------- */

  socket.on('hello', function (d) {
    clock.sync(d.serverNow);
  });

  socket.on('connect', function () {
    const pw = sessionStorage.getItem('qq_admin_pw');
    if (pw) authenticate(pw, true);
  });

  socket.on('admin:state', function (state) {
    clock.sync(state.round ? state.round.serverNow : undefined);
    A.state = state;
    A.rankingVisible = state.rankingVisible;
    A.practiceOn = state.phase === 'practice';

    $('#phase-label').textContent = PHASE_LABEL[state.phase] || state.phase;
    $('#btn-ranking').textContent = state.rankingVisible ? '🏆 순위 닫기' : '🏆 순위 공개';
    $('#btn-practice').textContent = A.practiceOn ? '🧩 연습 화면 닫기' : '🧩 퍼즐 연습 화면';

    renderAdminBoard(state);
    updateLivePanel(state);
    fillSettings(state.settings);
    if (!A.editorBuilt && !$('#tab-edit').classList.contains('hidden')) {
      buildEditor(state.questions);
    }
  });

  socket.on('admin:players', function (d) {
    renderPlayers(d.count, d.players);
  });

  socket.on('hearts:update', function (d) {
    if (!A.state) return;
    (d.items || []).forEach(function (item) {
      const rec = A.state.board.find(function (b) {
        return b.id === item.id;
      });
      if (rec) rec.hearts = item.total;
    });
    renderAdminBoard(A.state);
  });

  socket.on('round:end', function (d) {
    renderResultPanel(d.results, null);
    toast('채점 완료! ' + (d.results || []).filter(function (r) { return r.correct; }).length + '명 정답', 'ok');
  });

  socket.on('ranking:show', function () {
    A.rankingVisible = true;
    $('#btn-ranking').textContent = '🏆 순위 닫기';
  });
  socket.on('ranking:hide', function () {
    A.rankingVisible = false;
    $('#btn-ranking').textContent = '🏆 순위 공개';
  });

  socket.on('disconnect', function () {
    $('#phase-label').textContent = '⚠️ 서버와 연결이 끊겼습니다. 다시 연결하는 중…';
  });
})();
