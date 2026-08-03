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
  };
})(window);
