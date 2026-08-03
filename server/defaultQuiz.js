'use strict';

/**
 * 4x4 보드의 기본 문제 16개.
 * 관리자 페이지에서 전부 수정할 수 있고, 수정 결과는 data/state.json 에 저장된다.
 *
 * type
 *  - choice : 선착순 객관식
 *  - short  : 주관식
 *  - puzzle : 카드 매칭 퍼즐
 */

function q(index, title, subtitle, extra) {
  const merged = Object.assign(
    {
      id: 'q' + (index + 1),
      index,
      title,
      subtitle,
      type: 'choice',
      text: '',
      image: '',
      timeLimit: 30,
      hint: '',
      explanation: '',
      doublePoints: false,
      options: ['', '', '', ''],
      answerIndex: 0,
      answers: [],
      pairs: [],
    },
    extra
  );
  // 보기/카드는 여기서는 문자열로 짧게 적고, 실제로는 {text, image} 형태로 통일해서 내보낸다.
  merged.options = merged.options.map((o) =>
    typeof o === 'string' ? { text: o, image: '' } : { text: (o && o.text) || '', image: (o && o.image) || '' }
  );
  merged.pairs = merged.pairs.map((p) => ({
    left: toCard(p.left),
    right: toCard(p.right),
  }));
  return merged;
}

function toCard(c) {
  return typeof c === 'string' ? { text: c, image: '' } : { text: (c && c.text) || '', image: (c && c.image) || '' };
}

const defaultQuestions = [
  q(0, '아이스브레이킹', '몸풀기 한 문제', {
    type: 'choice',
    text: '대한민국의 수도는?',
    options: ['부산', '서울', '인천', '대구'],
    answerIndex: 1,
    timeLimit: 20,
    hint: '한강이 흐르는 도시!',
    explanation: '서울은 1394년 조선의 도읍이 된 이래 지금까지 대한민국의 수도예요.',
  }),
  q(1, '상식 퀴즈', '누구나 아는 그것', {
    type: 'choice',
    text: '1년은 몇 일일까요? (평년 기준)',
    options: ['360일', '364일', '365일', '366일'],
    answerIndex: 2,
    timeLimit: 20,
    hint: '윤년은 하루가 더 많아요.',
  }),
  q(2, '주관식 도전', '직접 입력하세요', {
    type: 'short',
    text: '태양계에서 가장 큰 행성의 이름은?',
    answers: ['목성', 'jupiter'],
    timeLimit: 30,
    hint: '영어 이름은 Jupiter 입니다.',
  }),
  q(3, '짝을 찾아라', '카드 매칭 퍼즐', {
    type: 'puzzle',
    text: '나라와 수도를 알맞게 연결하세요.',
    pairs: [
      { left: '대한민국', right: '서울' },
      { left: '일본', right: '도쿄' },
      { left: '프랑스', right: '파리' },
      { left: '영국', right: '런던' },
    ],
    timeLimit: 45,
    hint: '프랑스의 수도는 에펠탑이 있는 곳!',
    explanation: '수도는 그 나라의 정치·행정 중심 도시예요. 서울, 도쿄, 파리, 런던 모두 각 나라의 대표 도시랍니다.',
  }),
  q(4, '스피드 퀴즈', '빠른 손이 이긴다', {
    type: 'choice',
    text: '무지개의 색은 모두 몇 가지로 표현할까요?',
    options: ['5가지', '6가지', '7가지', '8가지'],
    answerIndex: 2,
    timeLimit: 15,
    hint: '빨주노초파남보',
  }),
  q(5, '영화 퀴즈', '스크린 속 한 장면', {
    type: 'short',
    text: '2019년 칸 황금종려상을 받은 봉준호 감독의 영화 제목은?',
    answers: ['기생충', 'parasite'],
    timeLimit: 30,
    hint: '영어 제목은 Parasite 입니다.',
  }),
  q(6, '음악 퀴즈', '이 노래 아시나요', {
    type: 'choice',
    text: '오케스트라에서 가장 낮은 음을 내는 현악기는?',
    options: ['바이올린', '비올라', '첼로', '콘트라베이스'],
    answerIndex: 3,
    timeLimit: 20,
    hint: '이름이 가장 길어요.',
  }),
  q(7, '연결고리', '카드 매칭 퍼즐', {
    type: 'puzzle',
    text: '동물과 울음소리를 연결하세요.',
    pairs: [
      { left: '강아지', right: '멍멍' },
      { left: '고양이', right: '야옹' },
      { left: '소', right: '음메' },
      { left: '오리', right: '꽥꽥' },
    ],
    timeLimit: 40,
    hint: '소는 "음"으로 시작해요.',
  }),
  q(8, '역사 퀴즈', '그때 그 시절', {
    type: 'short',
    text: '훈민정음을 창제한 조선의 왕은?',
    answers: ['세종대왕', '세종', '세종왕'],
    timeLimit: 30,
    hint: '만원 지폐 속 인물입니다.',
  }),
  q(9, '스포츠 퀴즈', '경기장의 규칙', {
    type: 'choice',
    text: '축구 경기에서 한 팀이 경기장에 서는 선수는 몇 명?',
    options: ['9명', '10명', '11명', '12명'],
    answerIndex: 2,
    timeLimit: 20,
    hint: '골키퍼를 포함한 숫자예요.',
  }),
  q(10, '음식 퀴즈', '맛있는 문제', {
    type: 'choice',
    text: '김치의 주재료로 가장 많이 쓰이는 채소는?',
    options: ['상추', '배추', '양배추', '시금치'],
    answerIndex: 1,
    timeLimit: 15,
    hint: '"배"로 시작합니다.',
  }),
  q(11, '두뇌 풀가동', '카드 매칭 퍼즐', {
    type: 'puzzle',
    text: '과일과 대표 색깔을 연결하세요.',
    pairs: [
      { left: '바나나', right: '노랑' },
      { left: '수박', right: '초록' },
      { left: '딸기', right: '빨강' },
      { left: '포도', right: '보라' },
    ],
    timeLimit: 40,
    hint: '수박 겉면을 떠올려 보세요.',
  }),
  q(12, '과학 퀴즈', '알쏭달쏭 원리', {
    type: 'short',
    text: '물의 화학식은 무엇일까요?',
    answers: ['h2o', 'H₂O'],
    timeLimit: 25,
    hint: '수소 2개, 산소 1개',
  }),
  q(13, '넌센스', '머리를 말랑하게', {
    type: 'choice',
    text: '세상에서 가장 뜨거운 바다는?',
    options: ['홍해', '열바다', '흑해', '사해'],
    answerIndex: 1,
    timeLimit: 20,
    hint: '"열"이 들어갑니다.',
  }),
  q(14, '지리 퀴즈', '세계 지도 펼치기', {
    type: 'choice',
    text: '세계에서 가장 긴 강은?',
    options: ['나일강', '아마존강', '양쯔강', '미시시피강'],
    answerIndex: 0,
    timeLimit: 25,
    hint: '아프리카에 있습니다.',
  }),
  q(15, '파이널 라운드', '마지막 한 방', {
    type: 'short',
    text: '1부터 10까지 모든 수를 더하면?',
    answers: ['55'],
    timeLimit: 30,
    doublePoints: true,
    hint: '50보다 크고 60보다 작아요.',
  }),
];

const defaultSettings = {
  scoreFirst: 5,
  scoreTop: 2,
  scoreTopUntilRank: 4,
  scoreRest: 1,
  countdownSeconds: 3,
  hintBeforeSeconds: 5,
};

/** 퍼즐 연습 화면에서 쓰는 샘플 (점수와 무관) */
const practicePuzzle = {
  text: '연습! 카드를 눌러 짝을 맞춰보세요. 점수에 반영되지 않아요.',
  pairs: [
    { left: '해', right: '☀️' },
    { left: '달', right: '🌙' },
    { left: '별', right: '⭐' },
    { left: '구름', right: '☁️' },
  ],
};

module.exports = { defaultQuestions, defaultSettings, practicePuzzle };
