'use strict';

/**
 * 진행자 콘솔에서 저장한 내용(문제·설정·큰 화면 글자 등)을 GitHub 저장소에
 * 자동으로 커밋한다. 그래야 호스팅(예: Render) 디스크가 초기화돼도 상태가
 * 남고, 재배포하면 커밋된 data/state.json 을 그대로 불러온다.
 *
 * 환경변수 (없으면 기능이 꺼지고 아무 일도 하지 않는다 → 로컬 개발엔 영향 없음)
 *  - GITHUB_TOKEN       : 저장소 쓰기 권한 토큰 (Contents: write)
 *  - GITHUB_REPO        : "owner/repo"  (예: bananapallete/Quiz-Quiz)
 *  - GITHUB_BRANCH      : 커밋할 브랜치 (예: main 또는 배포 브랜치)
 *  - GITHUB_STATE_PATH  : 저장 경로 (기본 data/state.json)
 *  - GITHUB_SYNC_DEBOUNCE_MS : 연속 저장을 묶는 지연(ms, 기본 4000)
 */

const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = (process.env.GITHUB_REPO || '').trim();
const BRANCH = (process.env.GITHUB_BRANCH || '').trim();
const FILE_PATH = (process.env.GITHUB_STATE_PATH || 'data/state.json').trim();
const DEBOUNCE_MS = Number(process.env.GITHUB_SYNC_DEBOUNCE_MS || 4000);

const enabled = !!(TOKEN && REPO && BRANCH);

let timer = null;
let inFlight = false;
let pendingContent = null; // 다음에 올릴 최신 내용(문자열)
let lastPushed = null; // 마지막으로 올린 내용 (같으면 건너뛴다)
let cachedSha = null; // 파일 SHA 캐시 (매번 조회하지 않으려고)
let resultCb = null;

function isEnabled() {
  return enabled;
}

/** 동기화 결과(성공/실패)를 받아볼 콜백 */
function onResult(fn) {
  resultCb = fn;
}

/**
 * 저장할 내용을 예약한다. 짧은 시간에 여러 번 저장해도 마지막 것만 한 번 올린다.
 * @param {string} content 파일에 쓸 문자열(JSON)
 */
function schedule(content) {
  if (!enabled) return;
  pendingContent = content;
  if (timer || inFlight) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

function flush() {
  timer = null;
  if (inFlight || pendingContent == null) return;
  const content = pendingContent;
  pendingContent = null;
  if (content === lastPushed) return; // 바뀐 게 없으면 건너뛴다

  inFlight = true;
  pushFile(content)
    .then(function (info) {
      lastPushed = content;
      cachedSha = info.sha || cachedSha;
      report(true, info.commitUrl || '');
    })
    .catch(function (err) {
      cachedSha = null; // SHA 가 어긋났을 수 있으니 다음엔 다시 조회
      report(false, err.message || String(err));
    })
    .then(function () {
      inFlight = false;
      // 대기 중인 최신 내용이 있으면 이어서 올린다
      if (pendingContent != null && !timer) timer = setTimeout(flush, DEBOUNCE_MS);
    });
}

function report(ok, detail) {
  if (ok) console.log('[github-sync] 저장 완료 → %s (%s)', REPO + '@' + BRANCH, detail);
  else console.error('[github-sync] 저장 실패:', detail);
  if (resultCb) {
    try {
      resultCb(ok, detail);
    } catch (e) {
      /* 콜백 오류는 무시 */
    }
  }
}

/** 현재 파일 SHA 를 얻는다(없으면 null = 새로 만들기). */
function getSha() {
  if (cachedSha) return Promise.resolve(cachedSha);
  return request('GET', apiPath() + '?ref=' + encodeURIComponent(BRANCH), null).then(function (res) {
    if (res.status === 404) return null;
    if (res.status >= 200 && res.status < 300 && res.body && res.body.sha) return res.body.sha;
    throw new Error('SHA 조회 실패 (HTTP ' + res.status + ')');
  });
}

function pushFile(content) {
  return getSha().then(function (sha) {
    const body = {
      message: '진행자 콘솔 저장 자동 반영',
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    return request('PUT', apiPath(), body).then(function (res) {
      if (res.status >= 200 && res.status < 300) {
        return {
          sha: res.body && res.body.content && res.body.content.sha,
          commitUrl: (res.body && res.body.commit && res.body.commit.html_url) || '',
        };
      }
      const msg = (res.body && res.body.message) || ('HTTP ' + res.status);
      throw new Error(msg);
    });
  });
}

function apiPath() {
  // /repos/{owner}/{repo}/contents/{path}
  return '/repos/' + REPO + '/contents/' + FILE_PATH.split('/').map(encodeURIComponent).join('/');
}

function request(method, path, bodyObj) {
  return new Promise(function (resolve, reject) {
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = https.request(
      {
        method: method,
        host: 'api.github.com',
        path: path,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'User-Agent': 'quizquiz-app',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'Content-Length': payload ? payload.length : 0,
        },
        timeout: 15000,
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
        });
        res.on('end', function () {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (e) {
            /* JSON 아니면 그냥 둔다 */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('요청 시간 초과'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  isEnabled: isEnabled,
  onResult: onResult,
  schedule: schedule,
  // 테스트용
  _apiPath: apiPath,
  _config: { REPO: REPO, BRANCH: BRANCH, FILE_PATH: FILE_PATH, enabled: enabled },
};
