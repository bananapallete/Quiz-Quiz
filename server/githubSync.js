'use strict';

/**
 * 진행자 콘솔에서 저장한 내용(문제·설정·큰 화면 글자 등)을 GitHub 저장소에
 * 자동으로 커밋한다. 그래야 호스팅(예: Render) 디스크가 초기화돼도 상태가
 * 남고, 서버가 다시 켜질 때 커밋된 state.json 을 그대로 불러온다.
 *
 * 설계
 *  - 상태는 코드 브랜치가 아니라 "전용 상태 브랜치"(기본 quiz-state)에 커밋한다.
 *    → 배포가 코드 브랜치를 자동 재배포하더라도 상태 저장이 재배포를 유발하지 않는다.
 *  - 서버 시작 시 그 브랜치에서 state.json 을 내려받아(load) 복원한다.
 *    → 임시 디스크(파일이 날아가는 환경)에서도 상태가 유지된다.
 *  - 상태 브랜치가 없으면 저장소 기본 브랜치에서 자동으로 만든다.
 *
 * 환경변수
 *  - GITHUB_TOKEN       : 저장소 쓰기 권한 토큰 (Contents: write). 이것만 있으면 켜진다.
 *  - GITHUB_REPO        : "owner/repo"  (기본 bananapallete/Quiz-Quiz)
 *  - GITHUB_BRANCH      : 상태를 커밋할 전용 브랜치 (기본 quiz-state)
 *  - GITHUB_STATE_PATH  : 저장 경로 (기본 data/state.json)
 *  - GITHUB_SYNC_DEBOUNCE_MS : 연속 저장을 묶는 지연(ms, 기본 4000)
 *  - GITHUB_SYNC=0      : 토큰이 있어도 강제로 끄고 싶을 때
 */

const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = (process.env.GITHUB_REPO || 'bananapallete/Quiz-Quiz').trim();
const BRANCH = (process.env.GITHUB_BRANCH || 'quiz-state').trim();
const FILE_PATH = (process.env.GITHUB_STATE_PATH || 'data/state.json').trim();
const DEBOUNCE_MS = Number(process.env.GITHUB_SYNC_DEBOUNCE_MS || 4000);

// 토큰만 있으면 켜진다. (GITHUB_SYNC=0 이면 명시적으로 끈다.)
const enabled = !!(TOKEN && REPO && BRANCH) && process.env.GITHUB_SYNC !== '0';

let timer = null;
let inFlight = false;
let pendingContent = null; // 다음에 올릴 최신 내용(문자열)
let lastPushed = null; // 마지막으로 올린 내용 (같으면 건너뛴다)
let cachedSha = null; // 파일 SHA 캐시 (매번 조회하지 않으려고)
let branchReady = false; // 상태 브랜치 존재 확인/생성 완료 여부
let writesPaused = false; // 데이터 보호용: 켜지면 이번 실행 동안 저장을 멈춘다
let resultCb = null;

function isEnabled() {
  return enabled;
}

/** 원격을 못 읽은 경우 등, 이번 실행 동안 자동 저장(쓰기)을 멈춘다. */
function pauseWrites() {
  writesPaused = true;
}

/** 동기화 결과(성공/실패)를 받아볼 콜백 */
function onResult(fn) {
  resultCb = fn;
}

/**
 * 상태 브랜치에서 현재 state.json 내용을 내려받는다.
 * @returns {Promise<string|null>} 파일 내용(문자열) 또는 없으면 null
 */
function load() {
  if (!enabled) return Promise.resolve(null);
  // 중요: GitHub contents API(JSON)는 1MB 넘는 파일의 content 를 빈 문자열로 준다.
  // state.json 은 이미지 때문에 수 MB 이므로, raw 미디어 타입으로 원문을 그대로 받아야 한다.
  return requestRaw('GET', apiPath() + '?ref=' + encodeURIComponent(BRANCH)).then(function (res) {
    if (res.status === 404) return null; // 브랜치나 파일이 아직 없음
    if (res.status >= 200 && res.status < 300) {
      branchReady = true;
      return res.text && res.text.length ? res.text : null;
    }
    throw new Error('원격 상태 조회 실패 (HTTP ' + res.status + ')');
  });
}

/**
 * 저장할 내용을 예약한다. 짧은 시간에 여러 번 저장해도 마지막 것만 한 번 올린다.
 * @param {string} content 파일에 쓸 문자열(JSON)
 */
function schedule(content) {
  if (!enabled || writesPaused) return;
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

/** 상태 브랜치가 있는지 확인하고, 없으면 기본 브랜치에서 만든다. */
function ensureBranch() {
  if (branchReady) return Promise.resolve();
  return request('GET', '/repos/' + REPO + '/branches/' + encodeURIComponent(BRANCH), null).then(function (res) {
    if (res.status >= 200 && res.status < 300) {
      branchReady = true;
      return;
    }
    if (res.status !== 404) throw new Error('상태 브랜치 확인 실패 (HTTP ' + res.status + ')');
    // 없으면 저장소 기본 브랜치의 HEAD 에서 새로 만든다.
    return request('GET', '/repos/' + REPO, null).then(function (r2) {
      const def = r2.body && r2.body.default_branch;
      if (!def) throw new Error('기본 브랜치를 확인하지 못했습니다 (HTTP ' + r2.status + ')');
      return request('GET', '/repos/' + REPO + '/git/ref/heads/' + encodeURIComponent(def), null).then(function (r3) {
        const sha = r3.body && r3.body.object && r3.body.object.sha;
        if (!sha) throw new Error('기본 브랜치 SHA 조회 실패 (HTTP ' + r3.status + ')');
        return request('POST', '/repos/' + REPO + '/git/refs', {
          ref: 'refs/heads/' + BRANCH,
          sha: sha,
        }).then(function (r4) {
          // 201 생성 성공, 혹은 422(이미 존재 - 경합) 도 준비된 것으로 본다.
          if ((r4.status >= 200 && r4.status < 300) || r4.status === 422) {
            branchReady = true;
            return;
          }
          throw new Error('상태 브랜치 생성 실패 (HTTP ' + r4.status + ')');
        });
      });
    });
  });
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
  return ensureBranch()
    .then(getSha)
    .then(function (sha) {
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
        const msg = (res.body && res.body.message) || 'HTTP ' + res.status;
        throw new Error(msg);
      });
    });
}

function apiPath() {
  // /repos/{owner}/{repo}/contents/{path}
  return '/repos/' + REPO + '/contents/' + FILE_PATH.split('/').map(encodeURIComponent).join('/');
}

/**
 * raw 미디어 타입으로 파일 원문을 그대로 받는다. (1MB 넘는 파일도 OK)
 * 리다이렉트(302)가 오면 최대 몇 번 따라간다.
 */
function requestRaw(method, url, hops) {
  hops = hops || 0;
  return new Promise(function (resolve, reject) {
    let host = 'api.github.com';
    let path = url;
    const m = /^https?:\/\/([^/]+)(\/.*)$/.exec(url);
    if (m) {
      host = m[1];
      path = m[2];
    }
    const headers = {
      'User-Agent': 'quizquiz-app',
      Accept: 'application/vnd.github.raw',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    // GitHub API 호스트에만 토큰을 붙인다(리다이렉트된 CDN에는 붙이지 않음).
    if (host === 'api.github.com') headers.Authorization = 'Bearer ' + TOKEN;
    const req = https.request({ method: method, host: host, path: path, headers: headers, timeout: 20000 }, function (res) {
      // 리다이렉트 추적
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 4) {
        res.resume();
        resolve(requestRaw(method, res.headers.location, hops + 1));
        return;
      }
      let data = '';
      res.on('data', function (c) {
        data += c;
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, text: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('요청 시간 초과'));
    });
    req.end();
  });
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
  load: load,
  pauseWrites: pauseWrites,
  // 테스트용
  _apiPath: apiPath,
  _config: { REPO: REPO, BRANCH: BRANCH, FILE_PATH: FILE_PATH, enabled: enabled },
};
