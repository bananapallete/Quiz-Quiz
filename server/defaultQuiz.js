'use strict';

/**
 * 4x4 보드의 기본 문제 16개.
 * 관리자 페이지에서 전부 수정할 수 있고, 수정 결과는 data/state.json 에 저장된다.
 *
 * type
 *  - choice : 선착순 객관식
 *  - audio  : 음성 객관식 (보기마다 음성 파일, 정답 고르기)
 *  - short  : 주관식
 *  - puzzle : 카드 매칭 퍼즐 (맞춘 개수 + 시간으로 순위)
 *  - approx : 근사치 맞추기 (정답에 가까울수록 높은 점수)
 *             approxMode 'number' = 가격/숫자 맞추기, 'date' = 날짜 맞추기
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
      // 객관식 / 음성
      options: ['', '', '', ''],
      answerIndex: 0,
      // 주관식
      answers: [],
      // 퍼즐
      pairs: [],
      // 근사치
      approxMode: 'number',
      approxTarget: 0,
      approxUnit: '',
      approxDate: '',
      approxDateStart: '',
      approxDateEnd: '',
    },
    extra
  );
  merged.options = merged.options.map(toOption);
  merged.pairs = merged.pairs.map((p) => ({ left: toCard(p.left), right: toCard(p.right) }));
  return merged;
}

function toOption(o) {
  if (typeof o === 'string') return { text: o, image: '', audio: '' };
  return { text: (o && o.text) || '', image: (o && o.image) || '', audio: (o && o.audio) || '' };
}

function toCard(c) {
  if (typeof c === 'string') return { text: c, image: '' };
  return { text: (c && c.text) || '', image: (c && c.image) || '' };
}

const defaultQuestions = [
  q(0, '아이스브레이킹', '몸풀기 한 문제', {
    type: 'choice',
    text: '대한민국의 수도는?',
    options: ['부산', '서울', '인천', '대구'],
    answerIndex: 1,
    timeLimit: 20,
    hint: '한강이 흐르는 도시!',
    explanation: '서울은 1394년 조선의 수도가 된 이후 지금까지 대한민국의 중심 도시입니다.',
  }),
  q(1, '상식 퀴즈', '누구나 아는 그것', {
    type: 'choice',
    text: '1년은 몇 일일까요? (평년 기준)',
    options: ['360일', '364일', '365일', '366일'],
    answerIndex: 2,
    timeLimit: 20,
    hint: '윤년은 하루가 더 많아요.',
    explanation: '평년은 365일, 4년마다 오는 윤년은 366일입니다.',
  }),
  q(2, '주관식 도전', '직접 입력하세요', {
    type: 'short',
    text: '태양계에서 가장 큰 행성의 이름은?',
    answers: ['목성', 'jupiter'],
    timeLimit: 30,
    hint: '영어 이름은 Jupiter 입니다.',
    explanation: '목성은 지구 지름의 약 11배로, 태양계 행성 중 가장 큽니다.',
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
    explanation: '많이 맞출수록, 그리고 빨리 제출할수록 순위가 높아집니다.',
  }),
  q(4, '스피드 퀴즈', '빠른 손이 이긴다', {
    type: 'choice',
    text: '무지개의 색은 모두 몇 가지로 표현할까요?',
    options: ['5가지', '6가지', '7가지', '8가지'],
    answerIndex: 2,
    timeLimit: 15,
    hint: '빨주노초파남보',
    explanation: '한국에서는 보통 빨강·주황·노랑·초록·파랑·남색·보라 일곱 가지로 표현합니다.',
  }),
  q(5, '음성 퀴즈', '소리를 듣고 맞혀요', {
    type: 'audio',
    text: '재생 버튼을 눌러 들어보고, 정답을 고르세요.',
    options: ['1번 소리', '2번 소리', '3번 소리', '4번 소리'],
    answerIndex: 0,
    timeLimit: 30,
    hint: '가장 먼저 나온 소리예요.',
    explanation: '문제 편집에서 보기마다 음성 파일을 첨부하면 참가자 화면에 재생 버튼이 생깁니다.',
  }),
  q(6, '음악 퀴즈', '이 노래 아시나요', {
    type: 'choice',
    text: '오케스트라에서 가장 낮은 음을 내는 현악기는?',
    options: ['바이올린', '비올라', '첼로', '콘트라베이스'],
    answerIndex: 3,
    timeLimit: 20,
    hint: '이름이 가장 길어요.',
    explanation: '콘트라베이스는 현악기 중 가장 크고 가장 낮은 음역을 담당합니다.',
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
    explanation: '연결한 카드는 선으로 이어져 한눈에 확인할 수 있어요.',
  }),
  q(8, '역사 퀴즈', '그때 그 시절', {
    type: 'short',
    text: '훈민정음을 창제한 조선의 왕은?',
    answers: ['세종대왕', '세종', '세종왕'],
    timeLimit: 30,
    hint: '만원 지폐 속 인물입니다.',
    explanation: '세종대왕이 1443년 훈민정음을 창제하고 1446년에 반포했습니다.',
  }),
  q(9, '스포츠 퀴즈', '경기장의 규칙', {
    type: 'choice',
    text: '축구 경기에서 한 팀이 경기장에 서는 선수는 몇 명?',
    options: ['9명', '10명', '11명', '12명'],
    answerIndex: 2,
    timeLimit: 20,
    hint: '골키퍼를 포함한 숫자예요.',
    explanation: '골키퍼 1명과 필드 플레이어 10명, 모두 11명이 뜁니다.',
  }),
  q(10, '음식 퀴즈', '맛있는 문제', {
    type: 'choice',
    text: '김치의 주재료로 가장 많이 쓰이는 채소는?',
    options: ['상추', '배추', '양배추', '시금치'],
    answerIndex: 1,
    timeLimit: 15,
    hint: '"배"로 시작합니다.',
    explanation: '가장 흔한 배추김치의 주재료는 배추입니다.',
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
    explanation: '전부 맞히지 못해도 맞힌 개수만큼 순위에 반영됩니다.',
  }),
  q(12, '가격 맞추기', '근사치 승부', {
    type: 'approx',
    approxMode: 'number',
    approxTarget: 4500,
    approxUnit: '원',
    text: '편의점 아메리카노 한 잔의 가격은 얼마일까요?',
    timeLimit: 40,
    hint: '4천 원대입니다.',
    explanation: '정답에 가장 가까운 사람부터 순위가 매겨집니다.',
  }),
  q(13, '넌센스', '머리를 말랑하게', {
    type: 'choice',
    text: '세상에서 가장 뜨거운 바다는?',
    options: ['홍해', '열바다', '흑해', '사해'],
    answerIndex: 1,
    timeLimit: 20,
    hint: '"열"이 들어갑니다.',
    explanation: '"열 받다"의 열 + 바다를 합친 말장난입니다.',
  }),
  q(14, '날짜 맞추기', '근사치 승부', {
    type: 'approx',
    approxMode: 'date',
    approxDate: '1988-09-17',
    approxDateStart: '1950-01-01',
    approxDateEnd: '2030-12-31',
    text: '서울 올림픽 개막식이 열린 날짜는 언제일까요?',
    timeLimit: 45,
    hint: '1980년대 가을이었습니다.',
    explanation: '1988년 9월 17일 잠실 올림픽 주경기장에서 개막했습니다.',
  }),
  q(15, '파이널 라운드', '마지막 한 방', {
    type: 'short',
    text: '1부터 10까지 모든 수를 더하면?',
    answers: ['55'],
    timeLimit: 30,
    doublePoints: true,
    hint: '50보다 크고 60보다 작아요.',
    explanation: '1+2+…+10 = 10×11÷2 = 55 입니다.',
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
    { left: { text: '해', image: '' }, right: { text: '☀️', image: '' } },
    { left: { text: '달', image: '' }, right: { text: '🌙', image: '' } },
    { left: { text: '별', image: '' }, right: { text: '⭐', image: '' } },
    { left: { text: '구름', image: '' }, right: { text: '☁️', image: '' } },
  ],
};

module.exports = { defaultQuestions, defaultSettings, practicePuzzle };
