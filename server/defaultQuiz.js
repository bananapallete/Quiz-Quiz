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

// 아래 첨부 표시가 있는 문제는 실제 사진/음성 파일이 아직 없어서
// 보기·카드 왼쪽을 임시 텍스트로 채워 뒀다. 진행자 콘솔의 "문제 편집"에서
// 파일을 첨부하고 정답을 다시 지정해 주면 된다.
const TEMP_TEXT = '(임시문제) 아직 문제 내용이 채워지지 않았어요. 진행자가 파티 전에 직접 입력해 주세요.';

const defaultQuestions = [
  q(0, '기남', '팝스타', {
    type: 'choice',
    text: '레이디가가 앨범표지를 보고 맞춰보세요! (진행자: 보기마다 실제 앨범 사진을 첨부해 주세요 — 1·2번은 위쪽, 3·4번은 아래쪽 커버예요)',
    options: ['1번', '2번', '3번', '4번'],
    answerIndex: 3,
    timeLimit: 10,
  }),
  q(1, '정우', '모자랄게 없는 남자', {
    type: 'approx',
    approxMode: 'number',
    approxTarget: 69300,
    approxUnit: '원',
    text: '오늘 최연소 참가자 정우군은 수염제모를 9,900원에 받은 것으로 유명한데요. 반면! 진행자인 조한정군이 강남에서 받은 수염제모의 가격은 얼마일까요?',
    timeLimit: 10,
  }),
  q(2, '기훈', '희비의 계곡', {
    type: 'approx',
    approxMode: 'date',
    approxDate: '2025-10-04',
    approxDateStart: '2020-01-01',
    approxDateEnd: '2026-12-31',
    text: '비트코인의 차트를 보고, 표시된 날짜를 맞춰보세요. (진행자: 차트 이미지를 문제에 첨부해 주세요)',
    timeLimit: 15,
  }),
  q(3, '니엘', '하늘이시어', {
    type: 'puzzle',
    text: '2025년 기준, 각 교회의 성도수를 알맞게 연결하세요.',
    pairs: [
      { left: '여의도 순복음 교회(영등포구)', right: '78만여 명' },
      { left: '은혜와진리교회 (안양시)', right: '13만여 명' },
      { left: '금란교회 (중랑구)', right: '9만여 명' },
      { left: '주안장로교회 (인천 부평구)', right: '7만여 명' },
    ],
    timeLimit: 15,
  }),
  q(4, '형민', '초록이', {
    type: 'puzzle',
    text: '내 사랑 리트리버 카페의 회원으로 유명하신 형민님! 사진 속 리트리버 종류를 맞춰주세요. (진행자: 카드 왼쪽에 실제 강아지 사진을 첨부해 주세요)',
    pairs: [
      { left: '사진 1', right: '플랫 코티드 리트리버' },
      { left: '사진 2', right: '래브라도 리트리버' },
      { left: '사진 3', right: '노바 스코샤 덕 톨링 리트리버' },
      { left: '사진 4', right: '골든 리트리버' },
    ],
    timeLimit: 10,
  }),
  q(5, '건우', '운명전쟁49', {
    type: 'approx',
    approxMode: 'date',
    approxDate: '2006-11-29',
    approxDateStart: '1980-01-01',
    approxDateEnd: '2026-12-31',
    text: '평소 지인의 생일을 잘 외우는 것으로 유명한 건우! 사진 속 사람(이토미나미)의 생년월일을 맞춰보세요. (진행자: 사진을 첨부해 주세요)',
    timeLimit: 15,
  }),
  q(6, '민규 A', '개골개골', {
    type: 'audio',
    text: '다음 중 민규의 목소리를 고르세요. (진행자: 보기마다 실제 음성 파일을 첨부하고 정답을 다시 지정해 주세요)',
    options: ['보기 1', '보기 2', '보기 3', '보기 4'],
    answerIndex: 0,
    timeLimit: 15,
  }),
  q(7, '민규 B', '운명전쟁 49', {
    type: 'choice',
    text: '드라마 <방법> 굿 장면을 재생해 주세요. 평소 무속 관련 컨텐츠를 좋아하는 민규군은 이 장면을 보고 감탄하며 이 말을 했습니다. 뭐라고 했을까요?',
    options: ['무섭네ㅋ', '징그러워ㅠ', '해보고 싶다', '예술이네'],
    answerIndex: 3,
    timeLimit: 10,
  }),
  q(8, '윤수', '상식의 늪', {
    type: 'short',
    text: TEMP_TEXT,
    answers: ['미정'],
    timeLimit: 10,
  }),
  q(9, '장호', '', {
    type: 'short',
    text: TEMP_TEXT,
    answers: ['미정'],
    timeLimit: 20,
  }),
  q(10, '경우', '뮤지컬 퀴즈', {
    type: 'choice',
    text: '세계 4대 뮤지컬이 아닌 것은?',
    options: ['캣츠', '오페라의 유령', '레미제라블', '레베카', '미스 사이공'],
    answerIndex: 3,
    timeLimit: 10,
  }),
  q(11, '영선', '노래퀴즈', {
    type: 'short',
    text: TEMP_TEXT,
    answers: ['미정'],
    timeLimit: 20,
  }),
  q(12, '성배 A', '한의학 관상학', {
    type: 'choice',
    text: '다음 중 한의사가 아닌 사람은? (진행자: 보기마다 실제 사진을 첨부해 주세요)',
    options: ['1번', '2번', '3번', '4번'],
    answerIndex: 3,
    timeLimit: 10,
  }),
  q(13, '성배 B', '한의학 머니경제', {
    type: 'approx',
    approxMode: 'number',
    approxTarget: 42800,
    approxUnit: '원',
    text: '한의사 가운의 가격을 맞춰보세요. (진행자: 가운 사진을 첨부해 주세요)',
    timeLimit: 10,
  }),
  q(14, '성배 C', '성배의 보석함', {
    type: 'puzzle',
    text: '성배는 평소 "보석함"으로 유명한데요, 성배가 팔로우하는 사람의 프로필 사진과 인스타그램 아이디를 매칭하세요. (진행자: 카드 왼쪽에 실제 프로필 사진을 첨부해 주세요)',
    pairs: [
      { left: '프로필 사진 1', right: 'thdzhn' },
      { left: '프로필 사진 2', right: 'racter__choi' },
      { left: '프로필 사진 3', right: 'hyoku_' },
      { left: '프로필 사진 4', right: 'bexxmmo' },
    ],
    timeLimit: 15,
  }),
  q(15, '태중', '알콜중독', {
    type: 'puzzle',
    text: '2025 국내 맥주 시장 점유율을 알맞게 연결하세요.',
    pairs: [
      { left: '카스 프레시', right: '48%' },
      { left: '테라', right: '약 10%' },
      { left: '카스 라이트', right: '4.9%' },
      { left: '켈리', right: '3.5%' },
    ],
    timeLimit: 15,
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
