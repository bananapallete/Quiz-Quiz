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
    editorOpen: null, // 팝업으로 열려 있는 문제 id
    screenStyleLoaded: false, // 큰 화면 글자값을 서버에서 한 번 받아왔는지
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
      'max-width:220px;max-height:130px;border-radius:10px;display:none;margin-bottom:6px;border:1px solid var(--border);object-fit:contain';

    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.cssText = 'max-width:150px;font-size:12px';

    // 클릭 후 Ctrl+V 로도 붙여넣을 수 있게, 포커스를 받을 수 있는 영역을 별도로 둔다.
    const pasteZone = el('div', 'paste-zone', '📋 여기 클릭 후 붙여넣기 (Ctrl/⌘+V)');
    pasteZone.tabIndex = 0;
    pasteZone.title = '이미지를 복사한 뒤 여기를 클릭하고 붙여넣거나, 파일을 끌어다 놓으세요';

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
      // 사진을 넣거나 지우면 미리보기가 바로 갱신되도록 입력 이벤트를 흘려보낸다.
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function loadFile(file) {
      if (!file) return;
      compressImageFile(file, 900, 0.72)
        .then(function (dataUrl) {
          hidden.value = dataUrl;
          refresh();
        })
        .catch(function (err) {
          toast((err && err.message) || '이미지를 불러오지 못했어요.', 'err');
        });
    }

    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      loadFile(file);
    });
    pasteZone.addEventListener('paste', function (e) {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      let imageItem = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          imageItem = items[i];
          break;
        }
      }
      if (!imageItem) {
        toast('클립보드에 이미지가 없어요. 이미지를 먼저 복사해 주세요.', 'err');
        return;
      }
      e.preventDefault();
      loadFile(imageItem.getAsFile());
    });
    // 이미지 파일을 끌어다 놓아도 되도록
    pasteZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      pasteZone.style.borderColor = 'var(--accent)';
    });
    pasteZone.addEventListener('dragleave', function () {
      pasteZone.style.borderColor = '';
    });
    pasteZone.addEventListener('drop', function (e) {
      e.preventDefault();
      pasteZone.style.borderColor = '';
      loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    clearBtn.addEventListener('click', function () {
      hidden.value = '';
      refresh();
    });

    row.appendChild(fileInput);
    row.appendChild(pasteZone);
    row.appendChild(clearBtn);
    wrap.appendChild(hidden);
    wrap.appendChild(preview);
    wrap.appendChild(row);
    refresh();
    return wrap;
  }

  /**
   * 음성 파일 업로드 위젯. 이미지와 달리 압축할 수 없으므로 용량을 미리 확인해서 막는다.
   * (서버는 base64 기준 4,000,000자까지 허용 → 원본 약 2.9MB)
   */
  const MAX_AUDIO_BYTES = 2.8 * 1024 * 1024;

  function buildAudioField(dataF, initialValue) {
    const wrap = el('div');
    wrap.style.cssText = 'margin-bottom:10px';

    const hidden = el('input');
    hidden.type = 'hidden';
    hidden.dataset.f = dataF;
    hidden.value = initialValue || '';

    const player = el('audio');
    player.controls = true;
    player.preload = 'none';
    player.style.cssText = 'display:none;width:100%;max-width:250px;margin-bottom:6px;height:34px';

    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.cssText = 'max-width:170px;font-size:12px';

    const clearBtn = el('button', 'btn ghost small', '음성 삭제');
    clearBtn.type = 'button';

    function refresh() {
      if (hidden.value) {
        player.src = hidden.value;
        player.style.display = 'block';
        clearBtn.style.display = 'inline-flex';
      } else {
        player.removeAttribute('src');
        player.style.display = 'none';
        clearBtn.style.display = 'none';
      }
    }

    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > MAX_AUDIO_BYTES) {
        toast('음성 파일이 너무 큽니다. 2.8MB 이하로 잘라서 올려주세요.', 'err', 4000);
        return;
      }
      const reader = new FileReader();
      reader.onerror = function () {
        toast('음성 파일을 읽지 못했어요.', 'err');
      };
      reader.onload = function () {
        hidden.value = reader.result;
        refresh();
        toast('음성을 넣었어요 ✓', 'ok', 1200);
      };
      reader.readAsDataURL(file);
    });
    clearBtn.addEventListener('click', function () {
      hidden.value = '';
      refresh();
    });

    row.appendChild(fileInput);
    row.appendChild(clearBtn);
    wrap.appendChild(hidden);
    wrap.appendChild(player);
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
      ['run', 'screen', 'settings'].forEach(function (name) {
        $('#tab-' + name).classList.toggle('hidden', name !== tab.dataset.tab);
      });
      if (tab.dataset.tab === 'screen') renderScreenPreview();
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
      tile.dataset.id = q.id;

      // 제목·부제목은 왼쪽, 유형 배지와 하트는 오른쪽 위
      const head = el('div', 'a-head');
      if (q.faceImage) {
        const face = el('img', 'a-face');
        face.src = q.faceImage;
        face.alt = '';
        head.appendChild(face);
      }
      const name = el('div', 'a-name');
      name.appendChild(el('div', 'a-title', q.index + 1 + '. ' + q.title));
      if (q.subtitle) name.appendChild(el('div', 'a-sub', q.subtitle));
      head.appendChild(name);

      const tags = el('div', 'a-tags');
      tags.appendChild(el('span', typeBadgeClass(q.type), TYPE_SHORT[q.type] || q.type));
      const full = (state.questions || []).find(function (x) {
        return x.id === q.id;
      });
      if (questionHasImage(full)) {
        const m = el('span', 'a-mark', '📷');
        m.title = '이미지가 붙어 있어요';
        tags.appendChild(m);
      }
      if (questionHasAudio(full)) {
        const m = el('span', 'a-mark', '🔊');
        m.title = '음성이 붙어 있어요';
        tags.appendChild(m);
      }
      tags.appendChild(el('span', 'a-hearts', '💗 ' + (q.hearts || 0)));
      head.appendChild(tags);
      tile.appendChild(head);

      const actions = el('div', 'a-actions');
      const miniRow = el('div', 'a-mini-row');

      const editBtn = el('button', 'a-mini a-edit', '✏️');
      editBtn.title = '카드 수정하기';
      editBtn.addEventListener('click', function () {
        openEditor(q.id);
      });
      miniRow.appendChild(editBtn);

      const x2Btn = el('button', 'a-mini a-x2' + (q.doublePoints ? ' on' : ''), '2배');
      x2Btn.title = q.doublePoints ? '2배 점수 끄기' : '2배 점수 켜기';
      x2Btn.addEventListener('click', function () {
        socket.emit('admin:setDouble', { questionId: q.id, value: !q.doublePoints }, function (res) {
          if (!res || !res.ok) toast((res && res.error) || '변경 실패', 'err');
        });
      });
      miniRow.appendChild(x2Btn);

      const playedBtn = el('button', 'a-mini a-played', q.played ? '↩︎' : '✔');
      playedBtn.title = q.played ? '출제 기록 해제' : '출제됨으로 표시';
      playedBtn.addEventListener('click', function () {
        socket.emit('admin:togglePlayed', { questionId: q.id });
      });
      miniRow.appendChild(playedBtn);
      actions.appendChild(miniRow);

      const startBtn = el('button', 'a-start', '▶ 출제하기');
      startBtn.addEventListener('click', function () {
        socket.emit('admin:startQuestion', { questionId: q.id }, function (res) {
          if (!res || !res.ok) toast((res && res.error) || '출제 실패', 'err');
        });
      });
      actions.appendChild(startBtn);

      tile.appendChild(actions);
      holder.appendChild(tile);
    });
  }

  /* ---------------- 라이브 패널 ---------------- */

  function updateLivePanel(state) {
    const panel = $('#live-panel');
    const round = state.round;
    const revealing = state.phase === 'reveal';
    const running = revealing || state.phase === 'question';

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

    // 카드가 뒤집힌 상태에서는 "퀴즈 시작하기"만, 시작한 뒤에는 채점 버튼을 보여준다.
    $('#btn-begin').classList.toggle('hidden', !revealing);
    $('#btn-end').textContent = revealing ? '✕ 출제 취소' : '⏹ 바로 채점하기';

    if (A.liveTimer) clearInterval(A.liveTimer);
    if (revealing) {
      $('#live-timer').textContent = '시작 대기';
      return;
    }
    A.liveTimer = setInterval(function () {
      const now = clock.now();
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
          return asCard(p.left).text + '→' + asCard(p.right).text;
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

  /** 보드 카드의 ✏️ 를 누르면 그 문제의 편집창만 팝업으로 띄운다 */
  function openEditor(questionId) {
    if (!A.state) return;
    const q = (A.state.questions || []).find(function (x) {
      return x.id === questionId;
    });
    if (!q) return;

    const body = $('#editor-modal-body');
    body.innerHTML = '';
    const item = buildEditorItem(q);
    item.open = true;
    body.appendChild(item);

    $('#editor-modal-title').textContent = (q.index + 1) + '. ' + q.title + ' 수정하기';
    A.editorOpen = questionId;
    $('#overlay-editor').classList.add('active');
    body.scrollTop = 0;
  }

  function closeEditor() {
    A.editorOpen = null;
    $('#overlay-editor').classList.remove('active');
    $('#editor-modal-body').innerHTML = '';
  }

  $('#editor-close').addEventListener('click', closeEditor);
  // 바깥 여백을 눌러도 닫히게. 편집창 안쪽 클릭은 그대로 둔다.
  $('#overlay-editor').addEventListener('click', function (e) {
    if (e.target === this) closeEditor();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && A.editorOpen) closeEditor();
  });

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
      if (questionHasImage(cur)) summary.appendChild(el('span', 'badge', '📷 이미지'));
      if (questionHasAudio(cur)) summary.appendChild(el('span', 'badge', '🔊 음성'));
    }
    refreshSummary(q);

    const body = el('div', 'editor-body');

    // 실제 출제 화면과 똑같은 미리보기. 아래 폼을 고치면 곧바로 여기 반영된다.
    const previewWrap = el('div', 'ep-wrap');
    previewWrap.appendChild(el('div', 'ep-label', '👀 참가자에게 이렇게 보여요'));
    const epPhone = el('div', 'ep-phone');
    const epScreen = el('div', 'ep-screen');
    epPhone.appendChild(epScreen);
    previewWrap.appendChild(epPhone);
    body.appendChild(previewWrap);

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
      ['audio', '🔊 음성 퀴즈'],
      ['short', '✏️ 주관식'],
      ['puzzle', '🧩 퍼즐 매칭'],
      ['approx', '🎯 근사치 맞추기'],
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

    // 출제할 때 뒤집히는 카드 하단에 보여줄 짧은 설명. 비우면 위의 문제 내용을 대신 쓴다.
    const cardTa = el('textarea', 'textarea');
    cardTa.dataset.f = 'f-cardText';
    cardTa.value = q.cardText || '';
    cardTa.placeholder = '비워두면 위의 문제 내용이 카드에 그대로 나와요';
    cardTa.style.minHeight = '56px';
    body.appendChild(field('카드 설명 (출제할 때 뒤집히는 카드 하단 문구)', cardTa));

    // 문제 이미지 (모든 유형 공통)
    body.appendChild(field('문제 이미지 (선택)', buildImageField('f-image', q.image)));

    // 출제할 때 뒤집히며 나오는 카드에 들어갈 사진.
    // 비워두면 위의 문제 이미지를 그대로 쓴다.
    body.appendChild(
      field('카드 사진 (출제할 때 뒤집히는 카드에 보여요)', buildImageField('f-cardImage', q.cardImage))
    );

    // 객관식 / 음성 — 보기 개수를 자유롭게 추가·삭제할 수 있다.
    const MAX_OPTIONS = 8;
    const MIN_OPTIONS = 2;
    const choiceBox = el('div');
    choiceBox.dataset.sec = 'choice';
    const optLabel = el('label', null, '보기 (라디오를 눌러 정답 지정)');
    optLabel.style.cssText = 'display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px';
    choiceBox.appendChild(optLabel);

    const optList = el('div');
    choiceBox.appendChild(optList);

    const optBtnRow = el('div');
    optBtnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px';
    const addOptBtn = el('button', 'btn ghost small', '＋ 보기 추가');
    addOptBtn.type = 'button';
    addOptBtn.addEventListener('click', function () {
      if (optList.children.length >= MAX_OPTIONS) {
        toast('보기는 최대 ' + MAX_OPTIONS + '개까지 만들 수 있어요.', 'err');
        return;
      }
      optList.appendChild(buildOptionRow({ text: '', image: '', audio: '' }));
      renumberOptions();
    });
    optBtnRow.appendChild(addOptBtn);
    choiceBox.appendChild(optBtnRow);

    /** 보기 한 줄 (번호 · 정답 라디오 · 텍스트 · 삭제 · 이미지 · 음성) */
    function buildOptionRow(opt) {
      const optWrap = el('div', 'opt-block');

      const line = el('div', 'opt-edit');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'ans-' + q.id;
      radio.dataset.f = 'f-answerIndex';
      radio.title = '이 보기를 정답으로';
      const inp = el('input', 'input');
      inp.type = 'text';
      inp.dataset.f = 'f-option';
      inp.value = opt.text || '';
      const delBtn = el('button', 'btn ghost small', '✕');
      delBtn.type = 'button';
      delBtn.title = '이 보기 삭제';
      delBtn.addEventListener('click', function () {
        if (optList.children.length <= MIN_OPTIONS) {
          toast('보기는 최소 ' + MIN_OPTIONS + '개는 있어야 해요.', 'err');
          return;
        }
        const wasChecked = radio.checked;
        optList.removeChild(optWrap);
        renumberOptions();
        // 정답으로 지정돼 있던 보기를 지우면 첫 번째 보기를 정답으로 되돌린다.
        if (wasChecked) {
          const first = optList.querySelector('[data-f="f-answerIndex"]');
          if (first) first.checked = true;
        }
      });
      line.appendChild(radio);
      line.appendChild(inp);
      line.appendChild(delBtn);
      optWrap.appendChild(line);

      const mediaRow = el('div');
      mediaRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px';
      const imgCol = el('div');
      imgCol.appendChild(smallLabel('보기 이미지 (선택)'));
      imgCol.appendChild(buildImageField('f-option-image', opt.image));
      const audCol = el('div', 'opt-audio-col');
      audCol.appendChild(smallLabel('보기 음성 (음성 퀴즈용)'));
      audCol.appendChild(buildAudioField('f-option-audio', opt.audio));
      mediaRow.appendChild(imgCol);
      mediaRow.appendChild(audCol);
      optWrap.appendChild(mediaRow);

      return optWrap;
    }

    /** 보기를 추가·삭제한 뒤 번호와 정답 라디오 값을 다시 매긴다. */
    function renumberOptions() {
      Array.prototype.forEach.call(optList.children, function (row, i) {
        const radio = row.querySelector('[data-f="f-answerIndex"]');
        const inp = row.querySelector('[data-f="f-option"]');
        if (radio) radio.value = String(i);
        if (inp) inp.placeholder = i + 1 + '번 보기';
      });
    }

    const startOpts = q.options && q.options.length ? q.options : [{}, {}, {}, {}];
    startOpts.forEach(function (raw) {
      const opt = raw && typeof raw === 'object' ? raw : { text: raw || '', image: '', audio: '' };
      optList.appendChild(buildOptionRow(opt));
    });
    renumberOptions();
    const initialRadio = optList.querySelectorAll('[data-f="f-answerIndex"]')[Number(q.answerIndex) || 0];
    if (initialRadio) initialRadio.checked = true;
    else {
      const first = optList.querySelector('[data-f="f-answerIndex"]');
      if (first) first.checked = true;
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
    const pLabel = el('label', null, '매칭 짝 (왼쪽 ↔ 오른쪽, 최대 6쌍 · 카드마다 이미지 첨부 가능)');
    pLabel.style.cssText = 'display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px';
    puzzleBox.appendChild(pLabel);
    const pairs = (q.pairs || []).slice();
    for (let i = 0; i < 6; i++) {
      const raw = pairs[i] || { left: '', right: '' };
      const p = { left: asCard(raw.left), right: asCard(raw.right) };

      const pairWrap = el('div');
      pairWrap.style.cssText = 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px dashed var(--border)';

      const line = el('div', 'pair-edit');
      const l = el('input', 'input');
      l.type = 'text';
      l.dataset.f = 'f-pair-left';
      l.value = p.left.text;
      l.placeholder = '왼쪽 카드';
      const arrow = el('div', 'center muted', '↔');
      const r = el('input', 'input');
      r.type = 'text';
      r.dataset.f = 'f-pair-right';
      r.value = p.right.text;
      r.placeholder = '오른쪽 카드';
      const num = el('div', 'tiny muted center', String(i + 1));
      line.appendChild(l);
      line.appendChild(arrow);
      line.appendChild(r);
      line.appendChild(num);
      pairWrap.appendChild(line);

      // 왼쪽/오른쪽 카드 이미지를 나란히
      const imgRow = el('div');
      imgRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px';
      const leftImg = el('div');
      leftImg.appendChild(smallLabel('왼쪽 카드 이미지'));
      leftImg.appendChild(buildImageField('f-pair-left-image', p.left.image));
      const rightImg = el('div');
      rightImg.appendChild(smallLabel('오른쪽 카드 이미지'));
      rightImg.appendChild(buildImageField('f-pair-right-image', p.right.image));
      imgRow.appendChild(leftImg);
      imgRow.appendChild(rightImg);
      pairWrap.appendChild(imgRow);

      puzzleBox.appendChild(pairWrap);
    }
    body.appendChild(puzzleBox);

    // 근사치 맞추기
    const approxBox = el('div');
    approxBox.dataset.sec = 'approx';

    const modeSel = el('select', 'select');
    modeSel.dataset.f = 'f-approxMode';
    [
      ['number', '💰 숫자 · 가격 맞추기 (숫자 버튼으로 입력)'],
      ['date', '📅 날짜 맞추기 (스크롤로 조절)'],
    ].forEach(function (pair) {
      const o = el('option', null, pair[1]);
      o.value = pair[0];
      if ((q.approxMode || 'number') === pair[0]) o.selected = true;
      modeSel.appendChild(o);
    });
    approxBox.appendChild(field('근사치 방식', modeSel));

    // 숫자 모드
    const numBox = el('div');
    const numRow = el('div', 'row2');
    const targetInput = inputNode('number', q.approxTarget != null ? q.approxTarget : 0, 'f-approxTarget');
    targetInput.placeholder = '예) 4500';
    const unitInput = inputNode('text', q.approxUnit || '', 'f-approxUnit');
    unitInput.placeholder = '예) 원, 개, kg';
    numRow.appendChild(field('정답 숫자', targetInput));
    numRow.appendChild(field('단위 (선택)', unitInput));
    numBox.appendChild(numRow);
    approxBox.appendChild(numBox);

    // 날짜 모드
    const dateBox = el('div');
    const dateAnswer = inputNode('date', q.approxDate || '', 'f-approxDate');
    dateBox.appendChild(field('정답 날짜', dateAnswer));
    const dateRow = el('div', 'row2');
    dateRow.appendChild(field('선택 가능 시작일', inputNode('date', q.approxDateStart || '', 'f-approxDateStart')));
    dateRow.appendChild(field('선택 가능 종료일', inputNode('date', q.approxDateEnd || '', 'f-approxDateEnd')));
    dateBox.appendChild(dateRow);
    approxBox.appendChild(dateBox);

    const approxNote = el(
      'p',
      'tiny muted',
      '정답에 가장 가까운 사람이 1등입니다. 선착순이 아니라 차이가 작은 순으로 순위가 정해지고, 차이가 같으면 먼저 제출한 사람이 앞섭니다.'
    );
    approxBox.appendChild(approxNote);
    body.appendChild(approxBox);

    function syncApproxMode() {
      const isDate = modeSel.value === 'date';
      numBox.style.display = isDate ? 'none' : 'block';
      dateBox.style.display = isDate ? 'block' : 'none';
    }
    modeSel.addEventListener('change', syncApproxMode);
    syncApproxMode();

    // 힌트 / 해설 / 2배
    const hintInput = inputNode('text', q.hint || '', 'f-hint');
    hintInput.placeholder = '종료 N초 전에 참가자에게 공개됩니다';
    body.appendChild(field('힌트', hintInput));

    const explTa = el('textarea', 'textarea');
    explTa.dataset.f = 'f-explanation';
    explTa.value = q.explanation || '';
    explTa.placeholder = '채점이 끝난 뒤 결과 화면에 보여줄 설명 (선택)';
    body.appendChild(field('해설', explTa));

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
          if (A.editorOpen === q.id) closeEditor();
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
        if (A.editorOpen === q.id) closeEditor();
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
      const choiceLike = t === 'choice' || t === 'audio';
      choiceBox.style.display = choiceLike ? 'block' : 'none';
      shortBox.style.display = t === 'short' ? 'block' : 'none';
      puzzleBox.style.display = t === 'puzzle' ? 'block' : 'none';
      approxBox.style.display = t === 'approx' ? 'block' : 'none';
      // 음성 퀴즈일 때만 보기별 음성 입력칸을 강조해서 보여준다.
      optLabel.textContent = t === 'audio'
        ? '보기 (라디오를 눌러 정답 지정 · 보기마다 음성 파일을 첨부하세요)'
        : '보기 (라디오를 눌러 정답 지정)';
      $$('.opt-audio-col', choiceBox).forEach(function (n) {
        n.style.display = t === 'audio' ? 'block' : 'none';
      });
    }
    typeSel.addEventListener('change', syncSections);
    addOptBtn.addEventListener('click', syncSections);
    syncSections();

    // 폼을 고칠 때마다 미리보기를 실제 출제 화면과 똑같이 다시 그린다.
    let previewQueued = false;
    function updatePreview() {
      previewQueued = false;
      try {
        renderQuestionPreview(epScreen, collect(body, q));
      } catch (e) {
        /* 편집 도중 잠깐 비어 있는 값이 있어도 미리보기는 조용히 넘어간다 */
      }
    }
    function schedulePreview() {
      if (previewQueued) return;
      previewQueued = true;
      // 보기 추가/삭제처럼 DOM 이 바뀐 뒤 값을 읽도록 한 틱 미룬다.
      setTimeout(updatePreview, 0);
    }
    body.addEventListener('input', schedulePreview);
    body.addEventListener('change', schedulePreview);
    body.addEventListener('click', schedulePreview);
    updatePreview();

    return details;
  }

  /* ---------------- 실제 출제 화면과 똑같은 미리보기 ---------------- */

  const PREVIEW_TYPE_EMOJI = { choice: '⚡', audio: '🔊', short: '✏️', puzzle: '🧩', approx: '🎯' };

  /** 참가자 문제 화면(public/index.html #screen-question)과 같은 구조·클래스로 그린다. */
  function renderQuestionPreview(root, q) {
    root.innerHTML = '';

    const head = el('div', 'q-head');
    const titleText = q.title + (q.subtitle ? ' · ' + q.subtitle : '');
    head.appendChild(el('span', 'badge', titleText || '(제목 없음)'));
    head.appendChild(el('span', typeBadgeClass(q.type), TYPE_LABEL[q.type] || ''));
    if (q.doublePoints) head.appendChild(el('span', 'badge x2', '⭐ 2배 점수'));
    root.appendChild(head);

    // 타이머 바 (미리보기라 가득 찬 상태로 고정)
    const tw = el('div', 'timer-wrap');
    const bar = el('div', 'timer-bar');
    const fill = el('div', 'timer-fill');
    fill.style.width = '100%';
    bar.appendChild(fill);
    tw.appendChild(bar);
    const trow = el('div', 'timer-row');
    trow.appendChild(el('span', null, '제출 0명'));
    trow.appendChild(el('span', 'timer-num', (q.timeLimit || 30) + '초'));
    tw.appendChild(trow);
    root.appendChild(tw);

    if (q.image) {
      const wrap = el('div', 'q-image-wrap');
      const img = el('img');
      img.src = q.image;
      img.alt = '';
      wrap.appendChild(img);
      root.appendChild(wrap);
    }

    root.appendChild(el('div', 'q-text', q.text || ''));

    const bodyC = el('div');
    if (q.type === 'choice' || q.type === 'audio') previewChoice(bodyC, q);
    else if (q.type === 'short') previewShort(bodyC);
    else if (q.type === 'approx') {
      if (q.approxMode === 'date') previewDateWheel(bodyC, q);
      else previewNumberPad(bodyC, q);
    } else if (q.type === 'puzzle') previewPuzzle(bodyC, q);
    root.appendChild(bodyC);

    if (q.hint) {
      const hb = el('div', 'hint-box');
      hb.textContent = '💡 힌트 : ' + q.hint;
      root.appendChild(hb);
    }

    const sb = el('div', 'submit-bar');
    const btn = el('button', 'btn full', '제출하기');
    btn.type = 'button';
    btn.disabled = true;
    sb.appendChild(btn);
    root.appendChild(sb);
  }

  function previewChoice(body, q) {
    const list = el('div', 'options');
    (q.options || []).forEach(function (opt, i) {
      const b = el('button', 'opt' + (q.answerIndex === i ? ' selected' : ''));
      b.type = 'button';
      b.disabled = true;
      if (opt.image) {
        const img = el('img', 'opt-img');
        img.src = opt.image;
        img.alt = '';
        b.appendChild(img);
      }
      const row = el('div', 'opt-row');
      row.appendChild(el('span', 'k', String(i + 1)));
      row.appendChild(el('span', null, opt.text || ''));
      b.appendChild(row);
      if (q.type === 'audio' && opt.audio) b.appendChild(el('span', 'opt-play', '▶︎ 듣기'));
      list.appendChild(b);
    });
    if (!list.children.length) list.appendChild(el('p', 'puzzle-legend', '보기를 입력하면 여기 나와요.'));
    body.appendChild(list);
  }

  function previewShort(body) {
    const input = el('input', 'input');
    input.type = 'text';
    input.placeholder = '정답을 입력하세요';
    input.disabled = true;
    body.appendChild(input);
  }

  function previewNumberPad(body, q) {
    const display = el('div', 'numpad-display');
    display.appendChild(el('span', 'numpad-value', '0'));
    display.appendChild(el('span', 'numpad-unit', q.approxUnit || ''));
    body.appendChild(display);
    const pad = el('div', 'numpad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '←'].forEach(function (k) {
      const b = el('button', 'numkey' + (k === '←' ? ' wide-back' : ''), k);
      b.type = 'button';
      b.disabled = true;
      pad.appendChild(b);
    });
    body.appendChild(pad);
    body.appendChild(el('p', 'puzzle-legend', '정답에 가장 가까운 사람이 1등! 숫자 버튼으로 입력해 주세요.'));
  }

  function previewDateWheel(body, q) {
    const start = parseYear(q.approxDateStart, 1980);
    const end = parseYear(q.approxDateEnd, 2026);
    const mid = parseISOish(q.approxDate) || { y: Math.round((start + end) / 2), m: 8, d: 1 };
    const display = el('div', 'wheel-display', mid.y + '년 ' + mid.m + '월 ' + mid.d + '일');
    body.appendChild(display);
    const wheels = el('div', 'wheels');
    wheels.appendChild(previewWheelCol(mid.y, '년'));
    wheels.appendChild(previewWheelCol(mid.m, '월'));
    wheels.appendChild(previewWheelCol(mid.d, '일'));
    body.appendChild(wheels);
    body.appendChild(el('p', 'puzzle-legend', '위아래로 굴려서 날짜를 맞춰보세요. 정답에 가까울수록 높은 점수!'));
  }

  /** 정적 휠 한 칸 (가운데 값 강조) */
  function previewWheelCol(center, unit) {
    const wrap = el('div', 'wheel-wrap');
    const wheel = el('div', 'wheel');
    wheel.appendChild(el('div', 'wheel-pad'));
    for (let d = -2; d <= 2; d++) {
      const it = el('div', 'wheel-item' + (d === 0 ? ' on' : ''), String(center + d) + unit);
      wheel.appendChild(it);
    }
    wheel.appendChild(el('div', 'wheel-pad'));
    wrap.appendChild(wheel);
    wrap.appendChild(el('div', 'wheel-mask'));
    return wrap;
  }

  function previewPuzzle(body, q) {
    const pairs = q.pairs || [];
    if (!pairs.length) {
      body.appendChild(el('p', 'puzzle-legend', '짝을 입력하면 여기 카드로 나와요.'));
      return;
    }
    body.appendChild(
      el('p', 'puzzle-legend', '왼쪽 카드를 누른 뒤 오른쪽 카드를 누르면 연결돼요. 연결된 카드를 다시 누르면 해제됩니다.')
    );
    const wrap = el('div', 'puzzle');
    const colL = el('div', 'puzzle-col');
    const colR = el('div', 'puzzle-col');
    pairs.forEach(function (p) {
      colL.appendChild(previewCard(p.left));
      colR.appendChild(previewCard(p.right));
    });
    wrap.appendChild(colL);
    wrap.appendChild(colR);
    body.appendChild(wrap);
  }

  function previewCard(item) {
    const c = asCard(item);
    const card = el('button', 'pcard');
    card.type = 'button';
    card.disabled = true;
    if (c.image) {
      const img = el('img', 'pcard-img');
      img.src = c.image;
      img.alt = '';
      card.appendChild(img);
    }
    const row = el('div', 'pcard-row');
    row.appendChild(el('span', null, c.text || ''));
    card.appendChild(row);
    return card;
  }

  function parseYear(iso, fallback) {
    const m = /^(\d{4})-/.exec(String(iso || ''));
    return m ? Number(m[1]) : fallback;
  }
  function parseISOish(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  }

  /* ---------------- 큰 화면 요소별 표시·크기·여백·두께 ---------------- */

  const SCREEN = window.QQ_SCREEN;
  // 프로퍼티별 표시 정보
  const PROP_META = {
    size: { label: '크기', suffix: 'px', step: 1 },
    margin: { label: '여백', suffix: 'px', step: 1 },
    weight: { label: '두께', suffix: '', step: 100 },
    maxH: { label: '이미지 높이', suffix: 'vh', step: 1 },
  };
  // 미리보기에서 이미지 요소를 눈에 보이게 할 샘플 그림 (조절 효과 확인용)
  const SC_SAMPLE_IMG =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'>" +
    "<rect width='320' height='200' rx='16' fill='%23182a5c'/>" +
    "<text x='160' y='110' font-size='28' fill='%239eb8eb' text-anchor='middle' font-family='sans-serif'>이미지</text></svg>";

  A.screenStyle = SCREEN.defaults();
  A.scView = 'question';
  let scBuilt = false;

  function scGroup() {
    return SCREEN.SPEC.find(function (g) { return g.view === A.scView; });
  }
  function clampNum(v, min, max, fb) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fb;
    return Math.min(max, Math.max(min, n));
  }

  function buildScreenControls() {
    const holder = $('#scfg-controls');
    if (!holder) return;
    holder.innerHTML = '';
    const group = scGroup();
    if (!group) return;
    group.items.forEach(function (it) {
      const vs = A.screenStyle[A.scView][it.key];
      const block = el('div', 'scfg-item' + (vs.show === 0 ? ' off' : ''));

      // 머리말: 항목 이름 + "표시" 체크박스
      const head = el('div', 'scfg-item-head');
      head.appendChild(el('span', 'scfg-item-label', it.label));
      const showLbl = el('label', 'scfg-show');
      const chk = el('input');
      chk.type = 'checkbox';
      chk.id = 'scf-' + A.scView + '-' + it.key + '-show';
      chk.checked = vs.show !== 0;
      chk.addEventListener('change', function () {
        vs.show = chk.checked ? 1 : 0;
        block.classList.toggle('off', !chk.checked);
        applyPreview();
      });
      showLbl.appendChild(chk);
      showLbl.appendChild(el('span', null, '표시'));
      head.appendChild(showLbl);
      block.appendChild(head);

      // 각 조절값 (크기·여백·두께·이미지 높이)
      SCREEN.PROPS.forEach(function (p) {
        if (!it[p]) return;
        // 두께는 200 · 600 · 800 세 가지 버튼으로만
        if (p === 'weight') {
          block.appendChild(buildWeightRow(vs));
          return;
        }
        const range = it[p]; // [min, max, def]
        const meta = PROP_META[p];
        const row = el('div', 'scfg-row');
        row.appendChild(el('label', null, meta.label));
        const val = vs[p];
        const slider = el('input');
        slider.type = 'range';
        slider.min = range[0]; slider.max = range[1]; slider.step = meta.step; slider.value = val;
        slider.className = 'scfg-slider';
        const num = el('input', 'input scfg-num');
        num.type = 'number';
        num.id = 'scf-' + A.scView + '-' + it.key + '-' + p;
        num.min = range[0]; num.max = range[1]; num.step = meta.step; num.value = val;
        function sync(src) {
          const n = clampNum(src.value, range[0], range[1], val);
          slider.value = n; num.value = n;
          vs[p] = n;
          applyPreview();
        }
        slider.addEventListener('input', function () { sync(slider); });
        num.addEventListener('input', function () { sync(num); });
        const box = el('div', 'scfg-inputs');
        box.appendChild(slider);
        box.appendChild(num);
        box.appendChild(el('span', 'scfg-unit', meta.suffix || '두께'));
        row.appendChild(box);
        block.appendChild(row);
      });
      holder.appendChild(block);
    });
    scBuilt = true;
  }

  const WEIGHT_OPTIONS = [200, 600];
  function buildWeightRow(vs) {
    // 예전에 800으로 저장된 값은 남은 선택지 중 가까운 쪽으로 맞춘다
    if (WEIGHT_OPTIONS.indexOf(vs.weight) === -1) {
      vs.weight = WEIGHT_OPTIONS.reduce(function (a, b) {
        return Math.abs(b - vs.weight) < Math.abs(a - vs.weight) ? b : a;
      });
    }
    const row = el('div', 'scfg-row');
    row.appendChild(el('label', null, '두께'));
    const group = el('div', 'scfg-weights');
    WEIGHT_OPTIONS.forEach(function (w) {
      const btn = el('button', 'scfg-wbtn' + (vs.weight === w ? ' active' : ''), String(w));
      btn.type = 'button';
      btn.addEventListener('click', function () {
        vs.weight = w;
        Array.prototype.forEach.call(group.children, function (c) {
          c.classList.toggle('active', c === btn);
        });
        applyPreview();
      });
      group.appendChild(btn);
    });
    row.appendChild(group);
    return row;
  }

  function applyPreview() {
    const screen = $('#scfg-screen');
    if (screen && SCREEN) SCREEN.apply(screen, A.scView, A.screenStyle);
  }

  function renderScreenPreview() {
    if (!scBuilt) buildScreenControls();
    const screen = $('#scfg-screen');
    if (!screen) return;
    screen.innerHTML = '';
    if (A.scView === 'reveal') scPreviewReveal(screen);
    else if (A.scView === 'result') scPreviewResult(screen);
    else scPreviewQuestion(screen);
    applyPreview();
  }

  /** data-sc 태그를 붙여 반환 */
  function pt(node, sc) {
    node.dataset.sc = sc;
    return node;
  }
  function scSampleImage(sc) {
    const wrap = pt(el('div', 'sc-image'), sc);
    const img = el('img');
    img.src = SC_SAMPLE_IMG;
    img.alt = '';
    wrap.appendChild(img);
    return wrap;
  }
  function scTop(title, type, extra) {
    const top = el('div', 'sc-top');
    top.appendChild(pt(el('span', 'badge sc-badge', title), 'title'));
    top.appendChild(pt(el('span', typeBadgeClass(type) + ' sc-badge', TYPE_LABEL[type] || ''), 'type'));
    if (extra) top.appendChild(el('span', 'badge sc-badge', extra));
    return top;
  }

  function scPreviewQuestion(root) {
    const head = scTop('1. 기남 · 팝스타', 'choice');
    head.appendChild(pt(el('div', 'sc-timer', '30초'), 'timer'));
    root.appendChild(head);
    root.appendChild(scSampleImage('image'));
    root.appendChild(pt(el('div', 'sc-q-text', '레이디가가의 진짜 앨범표지를 찾아주세요'), 'qtext'));
    const list = el('div', 'sc-options');
    ['1번', '2번', '3번', '4번'].forEach(function (t, i) {
      const opt = el('div', 'sc-opt');
      opt.appendChild(pt(el('span', 'sc-opt-k', String(i + 1)), 'optnum'));
      opt.appendChild(pt(el('span', 'sc-opt-tx', t), 'opt'));
      list.appendChild(opt);
    });
    root.appendChild(list);
    root.appendChild(pt(el('div', 'sc-foot', '제출 0명'), 'foot'));
  }

  function scPreviewReveal(root) {
    const c = el('div', 'sc-center');
    c.appendChild(pt(el('div', 'sc-reveal-eyebrow', '곧 시작합니다'), 'eyebrow'));
    c.appendChild(scSampleImage('media'));
    c.appendChild(pt(el('div', 'sc-reveal-sub', '팝스타'), 'sub'));
    c.appendChild(pt(el('h1', 'sc-reveal-title', '기남'), 'title'));
    c.appendChild(pt(el('div', 'sc-reveal-text', '레이디가가의 진짜 앨범표지를 찾아주세요'), 'text'));
    root.appendChild(c);
  }

  function scPreviewResult(root) {
    root.appendChild(scTop('1. 기남 · 팝스타', 'choice', '결과'));
    root.appendChild(scSampleImage('image'));
    root.appendChild(pt(el('div', 'sc-q-text', '레이디가가의 진짜 앨범표지를 찾아주세요'), 'qtext'));
    const ans = el('div', 'sc-answer-box');
    ans.appendChild(pt(el('div', 'sc-answer-label', '정답'), 'anslabel'));
    ans.appendChild(pt(el('div', 'sc-answer-value', '4번'), 'answer'));
    root.appendChild(ans);
    const ex = el('div', 'sc-explain');
    ex.appendChild(el('div', 'sc-explain-label', '해설'));
    ex.appendChild(pt(el('div', 'sc-explain-text', '진짜 앨범표지는 4번입니다.'), 'explain'));
    root.appendChild(ex);
    const rank = el('div', 'sc-rank');
    ['민수', '영희', '철수'].forEach(function (nick, i) {
      const row = pt(el('div', 'sc-rank-row'), 'rank');
      row.appendChild(el('span', 'sc-rank-no', String(i + 1)));
      row.appendChild(el('span', 'sc-rank-nick', nick));
      row.appendChild(el('span', 'sc-rank-gain', '+' + (5 - i)));
      rank.appendChild(row);
    });
    root.appendChild(rank);
  }

  $$('#scfg-toggle [data-scv]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      A.scView = btn.dataset.scv;
      $$('#scfg-toggle [data-scv]').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      buildScreenControls(); // 새 화면에 맞는 항목만 다시 그린다
      renderScreenPreview();
    });
  });

  $('#btn-save-screen').addEventListener('click', function () {
    socket.emit('admin:saveScreenStyle', { screenStyle: A.screenStyle }, function (res) {
      if (res && res.ok) toast('큰 화면 설정을 저장했어요 ✓', 'ok');
      else toast((res && res.error) || '저장 실패', 'err');
    });
  });

  $('#btn-reset-screen').addEventListener('click', function () {
    A.screenStyle = SCREEN.defaults();
    buildScreenControls();
    renderScreenPreview();
    toast('기본값으로 되돌렸어요. 저장을 눌러 반영하세요.', 'ok');
  });

  /** 서버에서 받은 설정으로 컨트롤을 채운다. */
  function fillScreenStyle(st) {
    A.screenStyle = SCREEN.normalize(st);
    if (scBuilt) buildScreenControls();
    if (!$('#tab-screen').classList.contains('hidden')) renderScreenPreview();
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

  /** 문제 본문·보기·퍼즐 카드 중 하나라도 이미지가 붙어 있는지 */
  function questionHasImage(q) {
    if (!q) return false;
    if (q.image || q.cardImage) return true;
    if ((q.options || []).some(function (o) { return o && o.image; })) return true;
    return (q.pairs || []).some(function (p) {
      return p && (asCard(p.left).image || asCard(p.right).image);
    });
  }

  /** 보기 중 하나라도 음성이 붙어 있는지 */
  function questionHasAudio(q) {
    return !!(q && (q.options || []).some(function (o) { return o && o.audio; }));
  }

  function smallLabel(text) {
    const n = el('div', 'tiny muted', text);
    n.style.cssText = 'margin-bottom:4px;font-weight:700';
    return n;
  }

  /** 퍼즐 카드는 예전엔 문자열이었고 지금은 {text, image} 다. 둘 다 받아준다. */
  function asCard(c) {
    return typeof c === 'string'
      ? { text: c, image: '' }
      : { text: (c && c.text) || '', image: (c && c.image) || '' };
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
    const optionAudios = Array.prototype.map.call(
      body.querySelectorAll('[data-f="f-option-audio"]'),
      function (n) {
        return n.value;
      }
    );
    const options = optionTexts.map(function (text, i) {
      return { text: text, image: optionImages[i] || '', audio: optionAudios[i] || '' };
    });
    const checkedRadio = body.querySelector('[data-f="f-answerIndex"]:checked');
    const lefts = body.querySelectorAll('[data-f="f-pair-left"]');
    const rights = body.querySelectorAll('[data-f="f-pair-right"]');
    const leftImgs = body.querySelectorAll('[data-f="f-pair-left-image"]');
    const rightImgs = body.querySelectorAll('[data-f="f-pair-right-image"]');
    const pairs = [];
    for (let i = 0; i < lefts.length; i++) {
      pairs.push({
        left: { text: lefts[i].value, image: leftImgs[i] ? leftImgs[i].value : '' },
        right: { text: rights[i] ? rights[i].value : '', image: rightImgs[i] ? rightImgs[i].value : '' },
      });
    }
    return {
      id: q.id,
      title: val('f-title') || q.title,
      subtitle: val('f-subtitle'),
      type: val('f-type'),
      text: val('f-text'),
      cardText: val('f-cardText'),
      image: val('f-image'),
      cardImage: val('f-cardImage'),
      timeLimit: parseInt(val('f-timeLimit'), 10) || q.timeLimit,
      hint: val('f-hint'),
      explanation: val('f-explanation'),
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
        // 사진만 있는 카드(글자 없음)도 유효한 짝으로 인정한다.
        return (p.left.text.trim() || p.left.image) && (p.right.text.trim() || p.right.image);
      }),
      approxMode: val('f-approxMode') || 'number',
      approxTarget: Number(val('f-approxTarget')) || 0,
      approxUnit: val('f-approxUnit'),
      approxDate: val('f-approxDate'),
      approxDateStart: val('f-approxDateStart'),
      approxDateEnd: val('f-approxDateEnd'),
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

  $('#btn-begin').addEventListener('click', function () {
    socket.emit('admin:beginQuestion', {}, function (res) {
      if (!res || !res.ok) toast((res && res.error) || '시작 실패', 'err');
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
        questions:
          '16문제를 기본 문제(사진 포함)로 되돌릴까요?\n지금까지 편집한 문제 내용은 사라집니다.',
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
      '점 · 종료 ' +
      s.hintBeforeSeconds +
      '초 전 힌트 공개';
  }

  const PHASE_LABEL = {
    lobby: '대기 중 · 참가자들이 하트를 누르고 있어요',
    reveal: '카드 공개 · 시작 대기 중',
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
    // 편집 중인 값을 덮어쓰지 않도록 큰 화면 글자값은 처음 한 번만 채운다.
    if (!A.screenStyleLoaded && state.settings) {
      fillScreenStyle(state.settings.screenStyle);
      A.screenStyleLoaded = true;
    }
  });

  socket.on('admin:players', function (d) {
    renderPlayers(d.count, d.players);
  });

  socket.on('admin:notice', function (d) {
    if (d && d.msg) toast(d.msg, d.kind || 'ok');
  });

  const emoteLayer = QQ.createEmoteLayer($('#emote-layer'));
  socket.on('emote:show', function (d) {
    emoteLayer.show(d && d.id);
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
