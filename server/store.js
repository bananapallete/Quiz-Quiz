'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[store] 저장 파일을 읽지 못했습니다:', err.message);
    return null;
  }
}

let pending = null;
let timer = null;

/** 잦은 쓰기를 막기 위해 500ms 디바운스 저장 */
function save(data) {
  pending = data;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const snapshot = pending;
    pending = null;
    try {
      ensureDir();
      fs.writeFileSync(FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (err) {
      console.error('[store] 저장 실패:', err.message);
    }
  }, 500);
}

function saveNow(data) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] 저장 실패:', err.message);
  }
}

module.exports = { load, save, saveNow, FILE };
