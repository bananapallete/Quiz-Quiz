/*
 * 큰 화면(/screen)에 뜨는 글자·요소들의 조절 규격 — 서버와 브라우저가 공유한다.
 * 화면(문제/공개/결과)별로 각 요소가 어떤 조절값(표시 여부·크기·여백·두께·이미지 높이)을
 * 갖는지 한 곳에 정의한다. 값 저장 구조: style[view][key] = { show, size, margin, weight, maxH }
 *
 * range: [min, max, default]. 두께(weight)는 100~900.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QQ_SCREEN = api;
})(this, function () {
  const SPEC = [
    {
      view: 'question',
      label: '문제',
      items: [
        { key: 'title', label: '제목 배지', size: [10, 48, 22], weight: [100, 900, 800] },
        { key: 'type', label: '유형 배지', size: [10, 48, 22], weight: [100, 900, 800] },
        { key: 'timer', label: '타이머', size: [20, 120, 64], weight: [100, 900, 800] },
        { key: 'image', label: '문제 이미지', maxH: [10, 80, 56] },
        { key: 'qtext', label: '문제 문구', size: [12, 120, 40], margin: [0, 80, 12], weight: [100, 900, 800] },
        { key: 'optnum', label: '보기 번호', size: [14, 60, 20], weight: [100, 900, 800] },
        { key: 'opt', label: '보기 글자', size: [12, 80, 24], weight: [100, 900, 800] },
        { key: 'foot', label: '제출 인원', size: [10, 48, 22], weight: [100, 900, 600] },
      ],
    },
    {
      view: 'reveal',
      label: '공개',
      items: [
        { key: 'eyebrow', label: '상단 문구', size: [12, 60, 28], weight: [100, 900, 800] },
        { key: 'media', label: '이미지/이모지', maxH: [20, 90, 56] },
        { key: 'sub', label: '부제목', size: [12, 60, 28], weight: [100, 900, 600] },
        { key: 'title', label: '제목', size: [20, 160, 72], margin: [0, 80, 10], weight: [100, 900, 800] },
        { key: 'text', label: '설명', size: [12, 100, 32], margin: [0, 80, 14], weight: [100, 900, 600] },
      ],
    },
    {
      view: 'result',
      label: '결과',
      items: [
        { key: 'title', label: '제목 배지', size: [10, 48, 22], weight: [100, 900, 800] },
        { key: 'type', label: '유형 배지', size: [10, 48, 22], weight: [100, 900, 800] },
        { key: 'image', label: '문제 이미지', maxH: [10, 80, 56] },
        { key: 'qtext', label: '문제 문구', size: [12, 120, 40], margin: [0, 80, 12], weight: [100, 900, 800] },
        { key: 'anslabel', label: '"정답" 라벨', size: [10, 40, 18], weight: [100, 900, 600] },
        { key: 'answer', label: '정답 값', size: [16, 120, 44], margin: [0, 80, 14], weight: [100, 900, 800] },
        { key: 'explain', label: '해설', size: [12, 60, 28], weight: [100, 900, 800] },
        { key: 'rank', label: '순위', size: [12, 48, 24], weight: [100, 900, 600] },
      ],
    },
  ];

  const PROPS = ['size', 'margin', 'weight', 'maxH'];

  function clampInt(v, min, max, fb) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fb;
    return Math.min(max, Math.max(min, n));
  }

  /** 화면·항목별 기본값 전체 */
  function defaults() {
    const out = {};
    SPEC.forEach(function (g) {
      out[g.view] = {};
      g.items.forEach(function (it) {
        out[g.view][it.key] = itemDefaults(it);
      });
    });
    return out;
  }

  function itemDefaults(it) {
    const o = { show: 1 };
    PROPS.forEach(function (p) {
      if (it[p]) o[p] = it[p][2];
    });
    return o;
  }

  /** 저장된 값을 규격에 맞게(범위 안으로) 정리한다. 없는 값은 기본값. */
  function normalize(saved) {
    saved = saved || {};
    const out = {};
    SPEC.forEach(function (g) {
      const sv = saved[g.view] || {};
      out[g.view] = {};
      g.items.forEach(function (it) {
        const s = sv[it.key] || {};
        const o = { show: s.show === 0 ? 0 : 1 };
        PROPS.forEach(function (p) {
          if (it[p]) o[p] = clampInt(s[p], it[p][0], it[p][1], it[p][2]);
        });
        out[g.view][it.key] = o;
      });
    });
    return out;
  }

  /**
   * 렌더된 DOM(root) 안의 요소들에 스타일을 인라인으로 적용한다.
   * 요소는 data-sc="<key>" 로 표시돼 있어야 한다. (같은 key 여러 개면 전부 적용)
   */
  function apply(root, view, style) {
    if (!root) return;
    const group = SPEC.find(function (g) {
      return g.view === view;
    });
    if (!group) return;
    const vs = (style && style[view]) || {};
    group.items.forEach(function (it) {
      const s = vs[it.key] || itemDefaults(it);
      const els = root.querySelectorAll('[data-sc="' + it.key + '"]');
      Array.prototype.forEach.call(els, function (el) {
        if (s.show === 0) {
          el.style.display = 'none';
          return;
        }
        el.style.display = '';
        if (it.size && s.size) el.style.fontSize = s.size + 'px';
        if (it.weight && s.weight) el.style.fontWeight = String(s.weight);
        if (it.margin && s.margin != null) {
          el.style.marginTop = s.margin + 'px';
          el.style.marginBottom = s.margin + 'px';
        }
        if (it.maxH && s.maxH) {
          const img = el.tagName === 'IMG' ? el : el.querySelector('img');
          if (img) img.style.maxHeight = s.maxH + 'vh';
        }
      });
    });
  }

  return {
    SPEC: SPEC,
    PROPS: PROPS,
    defaults: defaults,
    itemDefaults: itemDefaults,
    normalize: normalize,
    apply: apply,
    clampInt: clampInt,
  };
});
