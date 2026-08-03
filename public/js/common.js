/* 참가자/관리자 화면이 함께 쓰는 유틸 */
(function (global) {
  'use strict';

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 서버-클라이언트 시계 차이를 보정한다. */
  const clock = {
    offset: 0,
    sync: function (serverNow) {
      if (typeof serverNow === 'number') this.offset = serverNow - Date.now();
    },
    now: function () {
      return Date.now() + this.offset;
    },
  };

  let toastWrap = null;
  function toast(message, kind, ms) {
    if (!toastWrap) toastWrap = document.getElementById('toasts');
    if (!toastWrap) return;
    const node = el('div', 'toast' + (kind ? ' ' + kind : ''), message);
    toastWrap.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s ease, transform .25s ease';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, ms || 2200);
  }

  const TYPE_LABEL = {
    choice: '⚡ 선착순 객관식',
    audio: '🔊 음성 퀴즈',
    short: '✏️ 주관식',
    puzzle: '🧩 퍼즐 매칭',
    approx: '🎯 근사치 맞추기',
  };
  const TYPE_SHORT = {
    choice: '객관식',
    audio: '음성',
    short: '주관식',
    puzzle: '퍼즐',
    approx: '근사치',
  };

  function typeBadgeClass(type) {
    return 'badge type-' + (type || 'choice');
  }

  function fmtSeconds(ms) {
    return (Math.max(0, ms) / 1000).toFixed(1);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        /* 무시 */
      }
    }
  }

  /**
   * 라이브 반응 스티커 5종.
   * 그림은 public/img/stickers/<key>.png 이고, 서버에는 인덱스(0~4)만 오간다.
   */
  const EMOTES = [
    { key: 'k', label: 'ㅋㅋㅋㅋㅋ' },
    { key: 'crazy', label: '미친!!' },
    { key: 'hard', label: '어려워요ㅠ' },
    { key: 'easy', label: '쉽다 풉ㅋ' },
    { key: 'fast', label: '빨리빨리!' },
  ];

  /** 스티커 한 장 DOM (첨부해 주신 스티커 이미지 그대로 사용) */
  function makeSticker(index) {
    const e = EMOTES[index];
    if (!e) return null;
    const n = el('img', 'sticker stk-' + e.key);
    n.src = '/img/stickers/' + e.key + '.png';
    n.alt = e.label;
    n.draggable = false;
    return n;
  }

  /**
   * 화면 아래에서 채팅처럼 떠오르는 반응 레이어.
   * 동시에 최대 5개까지만 보이고, 넘치면 가장 오래된 것부터 지운다.
   */
  function createEmoteLayer(layerNode) {
    const MAX_VISIBLE = 5;
    const LIFE_MS = 2800; // CSS emote-life 애니메이션 길이와 맞춰야 한다
    const live = [];

    function remove(node) {
      const i = live.indexOf(node);
      if (i !== -1) live.splice(i, 1);
      if (node.parentNode) node.parentNode.removeChild(node);
    }

    return {
      show: function (index) {
        const sticker = makeSticker(index);
        if (!sticker || !layerNode) return;

        const item = el('div', 'emote-item');
        // 같은 자리에 겹쳐 쌓이지 않도록 가로 위치를 살짝 흩뜨린다.
        // 왼쪽으로 흘러가도(--drift) 잘리지 않도록 시작 위치에 여유를 둔다.
        item.style.setProperty('--ex', (14 + Math.random() * 80).toFixed(0) + 'px');
        item.style.setProperty('--drift', (Math.random() * 24 - 12).toFixed(0) + 'px');
        item.appendChild(sticker);
        layerNode.appendChild(item);
        live.push(item);

        while (live.length > MAX_VISIBLE) remove(live[0]);

        setTimeout(function () {
          remove(item);
        }, LIFE_MS);
      },
    };
  }

  const PAIR_COLORS = [
    '#7c5cff',
    '#ff4d8d',
    '#35d0a5',
    '#ffd166',
    '#4cc9f0',
    '#f772a1',
    '#a0e548',
    '#ff9f1c',
  ];

  global.QQ = {
    $: $,
    $$: $$,
    el: el,
    esc: esc,
    clock: clock,
    toast: toast,
    TYPE_LABEL: TYPE_LABEL,
    TYPE_SHORT: TYPE_SHORT,
    typeBadgeClass: typeBadgeClass,
    fmtSeconds: fmtSeconds,
    vibrate: vibrate,
    PAIR_COLORS: PAIR_COLORS,
    EMOTES: EMOTES,
    makeSticker: makeSticker,
    createEmoteLayer: createEmoteLayer,
  };
})(window);
