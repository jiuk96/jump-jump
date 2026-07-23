'use strict';

/* =====================================================
 * 점프! 점프! — 두들 점프 스타일 무한 점프 게임
 *
 * 캐릭터 교체 방법:
 *   assets/character/ 폴더에 아래 파일을 넣으면 자동 적용됩니다.
 *     - jump-left.png  : 기본/하강 모습 (필수)
 *     - fly-left.png   : 점프로 상승 중일 때 모습 (선택)
 *     - jump-right.png : 오른쪽을 보는 모습 (없으면 좌우반전 사용)
 *     - shoot.png      : 위로 발사할 때 모습 (선택)
 *   파일이 없으면 내장 임시 캐릭터가 그려집니다.
 * ===================================================== */

// ---------- 기준 좌표계 (논리 해상도) ----------
const W = 360;           // 논리 폭
const H = 640;           // 논리 높이

// ---------- 물리 상수 ----------
const GRAVITY = 0.35;
const JUMP_VY = -11.5;      // 기본 점프 속도
const SPRING_VY = -19;      // 스프링
const JETPACK_VY = -14;     // 제트팩 지속 상승 속도
const JETPACK_TIME = 150;   // 제트팩 지속 프레임
const MOVE_ACC = 0.55;      // 좌우 가속
const MOVE_MAX = 6;         // 좌우 최대 속도
const MOVE_FRICTION = 0.90; // 좌우 감쇠
const BULLET_VY = -12;

// ---------- 아이템/코인 ----------
const COIN_R = 9;              // 코인 반지름
const MAGNET_RANGE = 110;      // 자석 흡인 범위
const REVIVE_INVINCIBLE = 180; // 부활 후 무적 프레임
const PRICES = {
  life: 150, rocket: 50, magnet: 75,
  bow: 200, hat: 300, glasses: 400, headphones: 450,
  tophat: 500, crown: 600, scarf: 250, cape: 700, wings: 800,
};
const MAX_OWN = {
  life: 3, rocket: 9, magnet: 9,
  bow: 1, hat: 1, glasses: 1, headphones: 1, tophat: 1, crown: 1, scarf: 1, cape: 1, wings: 1,
};

// ---------- 발판 ----------
const PLAT_W = 62;
const PLAT_H = 14;

const PlatType = {
  NORMAL: 'normal',     // 초록: 일반
  MOVING: 'moving',     // 파랑: 좌우 이동
  BREAKING: 'breaking', // 갈색: 밟으면 부서짐 (점프 불가)
  ONESHOT: 'oneshot',   // 흰색: 한 번 밟으면 사라짐
  ICE: 'ice',           // 하늘색: 밟으면 잠시 미끄러움 (눈 올 때 자주)
};

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 데일리 챌린지: 날짜 시드로 모두 같은 맵 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let worldRand = null;   // 데일리 모드면 시드 RNG, 아니면 null
let dailyMode = false;
const wr = () => (worldRand ? worldRand() : Math.random());
const wrand = (a, b) => a + wr() * (b - a);
function kstDateNum() { // 한국 시간 기준 오늘 날짜 (YYYYMMDD)
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return k.getUTCFullYear() * 10000 + (k.getUTCMonth() + 1) * 100 + k.getUTCDate();
}

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  scale = canvas.width / W;
}
window.addEventListener('resize', resize);
resize();

// ---------- 캐릭터 (코인으로 해금, 고유 능력) ----------
const CHARACTERS = {
  dungi: { name: '둥이', emoji: '🐶', price: 0, desc: '밸런스형 말티즈', dir: '' },
  rabbit: { name: '토실이', emoji: '🐰', price: 0, desc: '점프력 +10%', dir: 'rabbit/' },
  penguin: { name: '펭펭', emoji: '🐧', price: 0, desc: '얼음에서 안 미끄러움 · 코인 +10%', dir: 'penguin/' },
  cat: { name: '나비', emoji: '🐱', price: 0, desc: '한 판에 한 번 낙사 무시', dir: 'cat/' },
};
// 지금은 모든 캐릭터 무료 개방
let ownedChars = new Set(Object.keys(CHARACTERS));
let curChar = localStorage.getItem('jump-char') || 'dungi';
if (!CHARACTERS[curChar]) curChar = 'dungi';
function saveChars() {
  localStorage.setItem('jump-chars', JSON.stringify([...ownedChars]));
  localStorage.setItem('jump-char', curChar);
}

// ---------- 캐릭터 이미지 로딩 (없으면 내장 그림) ----------
const charImgs = { left: null, right: null, shoot: null, fly: null };
function tryLoadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}
async function loadCharImages() {
  const dir = 'assets/character/' + CHARACTERS[curChar].dir;
  charImgs.left = await tryLoadImage(dir + 'jump-left.png');
  charImgs.fly = await tryLoadImage(dir + 'fly-left.png');
  charImgs.right = await tryLoadImage(dir + 'jump-right.png');
  charImgs.shoot = await tryLoadImage(dir + 'shoot.png');
}
loadCharImages();

// ---------- 영구 강화 (코인으로 레벨업) ----------
const UPGRADES = {
  jump: { name: '점프력', icon: '🦵', desc: '점프 높이 +2%/레벨', max: 5, costs: [500, 1200, 2500, 4500, 7000] },
  magnet: { name: '기본 자석', icon: '🧲', desc: '자석 없이도 코인을 끌어당김', max: 3, costs: [800, 2000, 4000] },
  star: { name: '별 수집가', icon: '⭐', desc: '스타 파워 필요 별 -1/레벨', max: 2, costs: [1500, 3500] },
  revive: { name: '질긴 생명', icon: '❤️', desc: '부활 무적 +1초/레벨', max: 3, costs: [600, 1500, 3000] },
  rocket: { name: '출발 부스트', icon: '🚀', desc: '시작 시 제트팩 0.5초/레벨', max: 3, costs: [400, 1000, 2200] },
};
let upg = { jump: 0, magnet: 0, star: 0, revive: 0, rocket: 0 };
try { upg = Object.assign(upg, JSON.parse(localStorage.getItem('jump-upg') || '{}')); } catch (e) {}
function saveUpg() { localStorage.setItem('jump-upg', JSON.stringify(upg)); }

// 강화·캐릭터 효과 적용 헬퍼
function jumpV() {
  return JUMP_VY * (1 + upg.jump * 0.02 + (curChar === 'rabbit' ? 0.10 : 0));
}
function magnetRangeNow() {
  return magnetActive ? MAGNET_RANGE : [0, 45, 65, 85][upg.magnet];
}
function starGoalNow() { return STAR_GOAL - upg.star; }

// ---------- 사운드 (Web Audio 간단 효과음) ----------
let audioCtx = null;
function beep(freq, dur = 0.08, type = 'square', vol = 0.15) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* 사운드 실패는 무시 */ }
}
const sfx = {
  jump: () => beep(500, 0.07, 'square', 0.12),
  spring: () => beep(760, 0.15, 'square', 0.15),
  jetpack: () => beep(220, 0.4, 'sawtooth', 0.1),
  break: () => beep(160, 0.12, 'triangle', 0.15),
  shoot: () => beep(880, 0.05, 'square', 0.08),
  hit: () => beep(320, 0.1, 'sawtooth', 0.12),
  die: () => beep(120, 0.5, 'sawtooth', 0.2),
  coin: () => beep(1250, 0.06, 'square', 0.1),
  buy: () => beep(950, 0.12, 'square', 0.12),
  revive: () => beep(640, 0.3, 'square', 0.15),
  bonus: () => {
    beep(660, 0.12, 'square', 0.14);
    setTimeout(() => beep(880, 0.12, 'square', 0.14), 110);
    setTimeout(() => beep(1100, 0.22, 'square', 0.15), 220);
  },
};

// ---------- 저장 데이터 (지갑/인벤토리) ----------
let best = Number(localStorage.getItem('jump-best') || 0);
let wallet = Number(localStorage.getItem('jump-coins') || 0);
let inv = {
  life: 0, rocket: 0, magnet: 0,
  hat: 0, scarf: 0, glasses: 0, bow: 0, headphones: 0, tophat: 0, crown: 0, cape: 0, wings: 0,
};
try {
  inv = Object.assign(inv, JSON.parse(localStorage.getItem('jump-inv') || '{}'));
} catch (e) { /* 손상된 저장값은 무시 */ }

function saveWallet() { localStorage.setItem('jump-coins', String(wallet)); }
function saveInv() { localStorage.setItem('jump-inv', JSON.stringify(inv)); }

// ---------- 누적 통계 & 도전과제 ----------
let stats = {
  runs: 0, totalScore: 0, bestScore: 0, coins: 0, kills: 0,
  missions: 0, stars: 0, maxCombo: 0, revives: 0, space: false,
};
try { stats = Object.assign(stats, JSON.parse(localStorage.getItem('jump-stats') || '{}')); } catch (e) {}
let unlockedAch = new Set();
try { unlockedAch = new Set(JSON.parse(localStorage.getItem('jump-ach') || '[]')); } catch (e) {}
function saveStats() { localStorage.setItem('jump-stats', JSON.stringify(stats)); }
function saveAch() { localStorage.setItem('jump-ach', JSON.stringify([...unlockedAch])); }

const ACHIEVEMENTS = [
  { id: 'score10k', name: '하늘 높이', desc: '한 판에 10,000점 달성', target: 10000, get: (s) => s.bestScore, reward: 150 },
  { id: 'space', name: '우주 여행자', desc: '우주에 도달하기 (14,000점)', target: 1, get: (s) => (s.space ? 1 : 0), reward: 300 },
  { id: 'coins500', name: '코인 부자', desc: '코인 누적 500개 모으기', target: 500, get: (s) => s.coins, reward: 200 },
  { id: 'kill50', name: '몬스터 헌터', desc: '몬스터 누적 50마리 처치', target: 50, get: (s) => s.kills, reward: 200 },
  { id: 'mission20', name: '미션 마스터', desc: '미션 20회 완수', target: 20, get: (s) => s.missions, reward: 200 },
  { id: 'star5', name: '별의 아이', desc: '스타 파워 5회 발동', target: 5, get: (s) => s.stars, reward: 150 },
  { id: 'combo30', name: '콤보의 왕', desc: '한 판에 콤보 30 달성', target: 30, get: (s) => s.maxCombo, reward: 200 },
  { id: 'runs50', name: '끈기의 둥이', desc: '50판 플레이', target: 50, get: (s) => s.runs, reward: 150 },
  { id: 'total100k', name: '마라토너', desc: '누적 100,000점 오르기', target: 100000, get: (s) => s.totalScore, reward: 300 },
  { id: 'revive3', name: '불사조', desc: '생명으로 3회 부활', target: 3, get: (s) => s.revives, reward: 100 },
];

const achToast = []; // 달성 알림 대기열
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (unlockedAch.has(a.id)) continue;
    if (a.get(stats) >= a.target) {
      unlockedAch.add(a.id);
      wallet += a.reward;
      saveWallet();
      saveAch();
      achToast.push(a);
      sfx.bonus();
      vib(80);
    }
  }
}

// ---------- 꾸미기 (액세서리) ----------
// 슬롯: 같은 슬롯 아이템은 하나만 착용 가능
const COSMETIC_SLOTS = {
  hat: 'head', crown: 'head', tophat: 'head', bow: 'head', headphones: 'head',
  glasses: 'face',
  scarf: 'neck',
  wings: 'back', cape: 'back',
};
const COSMETICS = Object.keys(COSMETIC_SLOTS);
let equip = {};
for (const k of COSMETICS) equip[k] = false;
try { equip = Object.assign(equip, JSON.parse(localStorage.getItem('jump-equip') || '{}')); } catch (e) {}
function saveEquip() { localStorage.setItem('jump-equip', JSON.stringify(equip)); }

// ---------- 온라인 랭킹 (Supabase) ----------
const SUPA_URL = 'https://phegkfmhshinlalimdxg.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoZWdrZm1oc2hpbmxhbGltZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTU1MjAsImV4cCI6MjEwMDI3MTUyMH0.tCOfPLf4zuguy6g-TbHaOiMpnxn3N8JI3LEVqlVi3Qk';
const supaHeaders = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
};
let myName = localStorage.getItem('jump-name') || '';

async function submitScore(name, sc) {
  const post = (body) => fetch(`${SUPA_URL}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...supaHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  try {
    let res = await post({ name, score: sc, mode: dailyMode ? 'daily' : 'normal' });
    if (!res.ok) res = await post({ name, score: sc }); // mode 컬럼이 아직 없으면 폴백
    return res.ok;
  } catch (e) {
    return false;
  }
}

// 최근 상위 기록을 가져와 닉네임별 최고점만 남김
async function fetchScores(tab) {
  let url = `${SUPA_URL}/rest/v1/scores?select=name,score,created_at&order=score.desc&limit=300`;
  if (tab === 'week') {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    url += `&created_at=gte.${since}`;
  } else if (tab === 'day') {
    // 오늘의 챌린지: KST 자정 이후 + daily 모드만
    const now = Date.now() + 9 * 3600 * 1000;
    const k = new Date(now);
    const startUtc = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600 * 1000;
    url += `&mode=eq.daily&created_at=gte.${new Date(startUtc).toISOString()}`;
  }
  const res = await fetch(url, { headers: supaHeaders });
  if (!res.ok) throw new Error('fetch failed');
  const rows = await res.json();
  const bestByName = new Map();
  for (const r of rows) {
    if (!bestByName.has(r.name) || bestByName.get(r.name).score < r.score) {
      bestByName.set(r.name, r);
    }
  }
  return [...bestByName.values()].sort((a, b) => b.score - a.score).slice(0, 50);
}

function askNickname() {
  const cur = myName || '';
  let n = prompt('랭킹에 표시할 닉네임을 입력하세요 (1~12자)', cur);
  if (n === null) return null;
  n = n.trim().slice(0, 12);
  if (!n) return null;
  myName = n;
  localStorage.setItem('jump-name', n);
  return n;
}

async function autoSubmitScore() {
  const el = $('lb-status');
  const regBtn = $('btn-register');
  el.textContent = '';
  regBtn.classList.add('hidden');
  if (score < 100) return; // 너무 낮은 점수는 등록하지 않음
  if (!myName) {
    regBtn.classList.remove('hidden');
    return;
  }
  el.textContent = '🏅 랭킹 등록 중...';
  const ok = await submitScore(myName, score);
  el.textContent = ok ? `🏅 ${myName} — 랭킹에 등록됨!` : '⚠️ 랭킹 등록 실패 (네트워크 확인)';
}

let lbTab = 'all';
async function renderLeaderboard() {
  const list = $('lb-list');
  $('lb-tab-all').classList.toggle('active', lbTab === 'all');
  $('lb-tab-week').classList.toggle('active', lbTab === 'week');
  $('lb-tab-day').classList.toggle('active', lbTab === 'day');
  $('lb-my').textContent = myName ? `내 닉네임: ${myName} · 최고 ${best}점` : '게임오버 화면에서 닉네임을 만들면 랭킹에 올라갑니다';
  list.innerHTML = '<div class="lb-info">불러오는 중...</div>';
  try {
    const rows = await fetchScores(lbTab);
    if (!rows.length) {
      list.innerHTML = '<div class="lb-info">아직 기록이 없어요. 첫 주인공이 되어보세요!</div>';
      return;
    }
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    rows.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'lb-row' + (r.name === myName ? ' me' : '');
      el.innerHTML = `
        <span class="lb-rank">${medals[i] || (i + 1)}</span>
        <span class="lb-name"></span>
        <span class="lb-score">${r.score.toLocaleString()}</span>`;
      el.querySelector('.lb-name').textContent = r.name; // XSS 방지: textContent 사용
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = '<div class="lb-info">⚠️ 랭킹을 불러오지 못했어요.<br>인터넷 연결을 확인해주세요.</div>';
  }
}

// ---------- 진동 (숫자 또는 패턴 배열) ----------
function vib(msOrPattern) {
  try { if (navigator.vibrate) navigator.vibrate(msOrPattern); } catch (e) {}
}

// ---------- 배경음악 (칩튠 루프) ----------
// 32스텝 시퀀서: 멜로디(사각파) + 베이스(삼각파) + 하이 블립 퍼커션
const bgm = {
  on: localStorage.getItem('jump-bgm') !== '0',
  timer: null,
  step: 0,
  // 0 = 쉼표. 경쾌한 C장조 루프
  MEL: [
    523, 0, 659, 784, 659, 0, 523, 659,
    587, 0, 698, 880, 698, 0, 587, 698,
    523, 0, 659, 784, 1047, 0, 784, 659,
    698, 659, 587, 523, 659, 0, 523, 0,
  ],
  BASS: [
    131, 0, 131, 0, 175, 0, 175, 0,
    147, 0, 147, 0, 196, 0, 196, 0,
    131, 0, 131, 0, 175, 0, 175, 0,
    196, 0, 165, 0, 131, 0, 131, 0,
  ],
  start() {
    if (!this.on || this.timer) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { return; }
    this.timer = setInterval(() => {
      const i = this.step++;
      const m = this.MEL[i % 32];
      const b = this.BASS[i % 32];
      if (m) {
        beep(m, 0.16, 'square', 0.075);
        beep(m * 2, 0.16, 'square', 0.018); // 옥타브 위 살짝 겹쳐 풍성하게
      }
      if (b) beep(b, 0.3, 'triangle', 0.11);
      if (i % 4 === 2) beep(2093, 0.03, 'square', 0.02); // 퍼커션 블립
    }, 150);
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  toggle() {
    this.on = !this.on;
    localStorage.setItem('jump-bgm', this.on ? '1' : '0');
    if (!this.on) this.stop();
    else if (state === State.PLAYING || state === State.COUNTDOWN) this.start();
  },
};

// ---------- 미션 시스템 ----------
// 미션을 완수하면 보너스 타임: 제트팩을 타고 무적 상태로 상승!
const BONUS_JETPACK = 210;   // 보너스 비행 프레임
const BONUS_INVINCIBLE = 270;

const MISSION_DEFS = [
  {
    id: 'fresh10', minScore: 0, text: '새 발판 10개 연속 밟기',
    init: () => ({ n: 0 }),
    onLand(s, p, info) { s.n = info.fresh ? s.n + 1 : 0; },
    prog: (s) => `${s.n}/10`, done: (s) => s.n >= 10,
  },
  {
    id: 'coins10', minScore: 0, text: '코인 10개 모으기',
    init: () => ({ n: 0 }),
    onCoin(s) { s.n++; },
    prog: (s) => `${s.n}/10`, done: (s) => s.n >= 10,
  },
  {
    id: 'spring2', minScore: 0, text: '스프링 2번 타기',
    init: () => ({ n: 0 }),
    onLand(s, p, info) { if (info.spring) s.n++; },
    prog: (s) => `${s.n}/2`, done: (s) => s.n >= 2,
  },
  {
    id: 'shoot5', minScore: 0, text: '총알 5발 쏘기',
    init: () => ({ n: 0 }),
    onShoot(s) { s.n++; },
    prog: (s) => `${s.n}/5`, done: (s) => s.n >= 5,
  },
  {
    id: 'rush', minScore: 0, text: '15초 안에 700점 오르기',
    init: () => ({ t: 900, base: null, ok: false }),
    tick(s) {
      if (s.base === null) s.base = score;
      s.t--;
      if (score - s.base >= 700) s.ok = true;
      else if (s.t <= 0) { s.t = 900; s.base = score; } // 실패하면 자동 재도전
    },
    prog: (s) => `${Math.max(0, score - (s.base ?? score))}/700 · ${Math.ceil(Math.max(s.t, 0) / 60)}초`,
    done: (s) => s.ok,
  },
  {
    id: 'blue3', minScore: 1000, text: '파란 발판 3번 밟기',
    init: () => ({ n: 0 }),
    onLand(s, p) { if (p.type === PlatType.MOVING) s.n++; },
    prog: (s) => `${s.n}/3`, done: (s) => s.n >= 3,
  },
  {
    id: 'white3', minScore: 1000, text: '흰 발판 3번 밟기',
    init: () => ({ n: 0 }),
    onLand(s, p) { if (p.type === PlatType.ONESHOT) s.n++; },
    prog: (s) => `${s.n}/3`, done: (s) => s.n >= 3,
  },
  {
    id: 'colors', minScore: 1500, text: '초록·파랑·흰 발판 모두 밟기',
    init: () => ({ got: {} }),
    onLand(s, p) { s.got[p.type] = true; },
    prog(s) {
      const n = [PlatType.NORMAL, PlatType.MOVING, PlatType.ONESHOT].filter((t) => s.got[t]).length;
      return `${n}/3`;
    },
    done(s) {
      return [PlatType.NORMAL, PlatType.MOVING, PlatType.ONESHOT].every((t) => s.got[t]);
    },
  },
  {
    id: 'monster1', minScore: 1800, text: '몬스터 1마리 처치',
    init: () => ({ n: 0 }),
    onKill(s) { s.n++; },
    prog: (s) => `${s.n}/1`, done: (s) => s.n >= 1,
  },
];

let mission = null;        // { def, s }
let missionCooldown = 0;   // 다음 미션까지 남은 프레임
let missionFlash = 0;      // 성공 배너 표시 프레임
let lastMissionId = null;
let landedSet = null;      // 이번 판에 밟아본 발판들

function pickMission() {
  const cands = MISSION_DEFS.filter((m) => score >= m.minScore && m.id !== lastMissionId);
  const def = cands[Math.floor(Math.random() * cands.length)];
  mission = { def, s: def.init() };
}

function missionEvent(type, ...args) {
  if (!mission) return;
  const h = mission.def['on' + type];
  if (!h) return;
  h(mission.s, ...args);
  if (mission.def.done(mission.s)) completeMission();
}

function completeMission() {
  lastMissionId = mission.def.id;
  mission = null;
  missionFlash = 140;
  flashMain = '미션 성공!';
  flashSub = '🚀 보너스 타임!';
  missionCooldown = 420;
  jetpackTimer = Math.max(jetpackTimer, 0) + BONUS_JETPACK;
  jetpackSlow = false;
  invincible = Math.max(invincible, BONUS_INVINCIBLE);
  sfx.bonus();
  vib(80);
  addBurst(player.x, player.y, '#f1c40f');
  stats.missions++;
  saveStats();
  checkAchievements();
}

// 별 10개 → 스타 파워: 짧은 무적 비행
function starPower() {
  starCount = 0;
  missionFlash = 140;
  flashMain = '⭐ 스타 파워!';
  flashSub = '무적 비행!';
  jetpackTimer = Math.max(jetpackTimer, 0) + STAR_FLIGHT;
  jetpackSlow = false;
  invincible = Math.max(invincible, STAR_FLIGHT + 60);
  sfx.bonus();
  vib(80);
  addBurst(player.x, player.y, '#ffd832');
  stats.stars++;
  saveStats();
  checkAchievements();
}

// ---------- 날씨 ----------
function updateWeather() {
  // 우주(고고도)에서는 날씨 없음
  if (weather) {
    weather.t--;
    if (weather.t <= 0) {
      weather = null;
      weatherWait = Math.round(rand(900, 2200));
    } else {
      // 방울/눈송이 생성
      const n = weather.type === 'rain' ? 3 : 1;
      for (let i = 0; i < n && weatherDrops.length < 160; i++) {
        if (weather.type === 'rain') {
          weatherDrops.push({ x: rand(-20, W + 20), y: -20, vx: -1.6, vy: rand(11, 15), rain: true });
        } else {
          weatherDrops.push({
            x: rand(-10, W + 10), y: -10,
            vx: 0, vy: rand(0.8, 1.8), rain: false,
            swayPhase: rand(0, Math.PI * 2), r: rand(1.6, 3.2),
          });
        }
      }
    }
  } else if (score < 13000) {
    weatherWait--;
    if (weatherWait <= 0) {
      const winterBias = SEASON === 'winter' ? 0.25 : 0;
      const type = score > 8000 ? 'snow' : (Math.random() < 0.55 - winterBias ? 'rain' : 'snow');
      weather = { type, t: Math.round(rand(480, 750)) };
    }
  }
  for (const w of weatherDrops) {
    w.x += w.vx + (w.rain ? 0 : Math.sin(frame * 0.04 + w.swayPhase) * 0.7);
    w.y += w.vy;
  }
  weatherDrops = weatherDrops.filter((w) => w.y < H + 20);

  // 시즌 파티클: 봄 벚꽃잎 / 가을 낙엽 (지상~하늘 구간에서만)
  if ((SEASON === 'spring' || SEASON === 'autumn') && score < 8000 && frame % 14 === 0 && seasonParts.length < 40) {
    seasonParts.push({
      x: rand(-10, W + 10), y: -10,
      vy: rand(0.7, 1.4), sway: rand(0, Math.PI * 2), rot: rand(0, Math.PI * 2),
    });
  }
  for (const p of seasonParts) {
    p.y += p.vy;
    p.x += Math.sin(frame * 0.03 + p.sway) * 0.9;
    p.rot += 0.05;
  }
  seasonParts = seasonParts.filter((p) => p.y < H + 15);
}

// ---------- 게임 상태 ----------
const State = { MENU: 0, PLAYING: 1, PAUSED: 2, OVER: 3, COUNTDOWN: 4 };
let state = State.MENU;
let countdownUntil = 0; // 카운트다운 종료 시각 (performance.now 기준)

let player, platforms, monsters, bullets, particles, coinsArr;
let cameraY;          // 월드 기준 카메라 상단 y
let score;
let runCoins;         // 이번 판에 모은 코인
let lives;            // 이번 판에 들고 들어온 생명
let magnetActive;     // 이번 판 자석 사용 여부
let invincible;       // 부활 후 무적 프레임
let jetpackTimer;     // 남은 제트팩 프레임
let shootPose;        // 발사 포즈 표시 프레임
let highestPlatY;     // 지금까지 생성한 가장 높은(작은 y) 발판
let frame = 0;
let starCount;        // 모은 별 (10개 = 스타 파워)
let pickupTimer;      // 다음 코인/별 낙하까지 프레임
let weather;          // null 또는 { type:'rain'|'snow', t }
let weatherWait;      // 다음 날씨까지 프레임
let weatherDrops;     // 화면 좌표 빗방울/눈송이
let flashMain = '';   // 성공 배너 문구
let flashSub = '';

const STAR_GOAL = 10;
const STAR_FLIGHT = 190;  // 스타 파워 비행 프레임 (짧게)

let combo;             // 연속 새 발판 콤보
let floatTexts;        // 떠오르는 텍스트 [{x,y,text,life,color,size,screen}]
let shakeT;            // 화면 흔들림 프레임
let ambients;          // 배경 오브젝트 (비행기/열기구/위성/별똥별)
let ambientTimer;
let blackholes;        // 블랙홀 [{x,y,r,spin}]
let dizzyClouds;       // 어지러움 구름 [{x,y,w,h,used}]
let reversedT;         // 조작 반전 남은 프레임
let lastCloseCall;     // '아슬아슬' 중복 방지
let ghostPts = null;   // 최고 기록 고스트 궤적
let ghostRec;          // 이번 판 기록
const GHOST_STEP = 3;  // 몇 프레임마다 기록할지
let tut;               // 첫 판 튜토리얼 안내 플래그
let slipT;             // 얼음 발판 미끄러움 남은 프레임
let windState;         // null 또는 { dir, warnT, t } — 바람 지대
let windWait;          // 다음 바람까지 프레임
let cannons;           // 대포 [{x,y,ang,osc,fired,timer}]
let holdCannon;        // 현재 들어가 있는 대포
let spaceAnnounced;    // 무중력 안내 1회 표시
let catSave;           // 고양이: 한 판 1회 낙사 무시
let coinFrac;          // 펭귄: 코인 +10% 누적분
let closeStreak;       // 아슬아슬 연속 횟수
let closeRewarded;     // 간발의 승부사 보상 (판당 1회)
let boss;              // 미니보스
let standPlat;         // 보스전: 서 있는 발판 (점프 정지)
let ammo;              // 남은 총알 (탄창 10발)
let reloading;         // 재장전 남은 프레임
let jetpackSlow;       // 시작 로켓은 천천히 상승
const AMMO_MAX = 10;
const RELOAD_TIME = 95; // 약 1.6초
let bossShots;         // 보스 투사체
let nextBossAt;        // 다음 보스 등장 점수
let seasonParts = [];  // 시즌 파티클 (꽃잎/낙엽)
let menuHop = 0;       // 시작 화면 둥이 점프 연출
let photoMode = false; // 사진 모드

// 시즌: 월에 따라 배경 장식이 바뀜
const SEASON = (() => {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
})();

function addFloat(text, x, y, color = '#e67e22', size = 16, screen = false) {
  floatTexts.push({ text, x, y, color, size, life: 110, screen });
}

// ---------- 입력 ----------
const input = { left: false, right: false, tilt: 0 };

// 조작 방법: 'touch'(터치·방향키) 또는 'tilt'(기울이기)
let controlMode = localStorage.getItem('jump-control') || 'touch';

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') input.left = true;
  if (e.code === 'ArrowRight') input.right = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === State.PLAYING) shoot();
  }
  if (e.code === 'Escape' && state === State.PLAYING) pauseGame();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft') input.left = false;
  if (e.code === 'ArrowRight') input.right = false;
});

// 터치: [터치 모드] 좌/우 절반 이동, 위쪽 탭 발사 / [기울이기 모드] 아무 곳이나 탭 → 발사
let touchSide = null;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (photoMode) { exitPhotoMode(); return; }
  if (state !== State.PLAYING) return;
  if (holdCannon) { // 대포 안: 아무 곳이나 탭하면 발사
    shoot();
    return;
  }
  if (controlMode === 'tilt') return; // 기울이기 모드: 발사는 🔫 버튼으로
  const rect = canvas.getBoundingClientRect();
  const t = e.changedTouches[0];
  const x = t.clientX - rect.left;
  touchSide = x < rect.width / 2 ? 'left' : 'right';
  input.left = touchSide === 'left';
  input.right = touchSide === 'right';
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  touchSide = null;
  input.left = false;
  input.right = false;
}, { passive: false });

// 기울기 (모바일) — 기울이기 모드에서만 반영
// 감도를 낮추고(-25°에서 최대) 목표값을 부드럽게 따라가 급격한 움직임 방지
let tiltTarget = 0;
window.addEventListener('deviceorientation', (e) => {
  if (controlMode !== 'tilt') { tiltTarget = 0; input.tilt = 0; return; }
  if (e.gamma != null) tiltTarget = clamp(e.gamma / 25, -1, 1);
});

// iOS 13+ 은 사용자 제스처에서 권한 요청 필요
function requestTilt() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
}

// ---------- 게임 초기화 ----------
function newGame() {
  worldRand = dailyMode ? mulberry32(kstDateNum()) : null;
  player = {
    x: W / 2, y: H - 120,
    vx: 0, vy: JUMP_VY,
    w: 46, h: 46,
    facing: 'left',
  };
  platforms = [];
  monsters = [];
  bullets = [];
  particles = [];
  coinsArr = [];
  cameraY = 0;
  score = 0;
  runCoins = 0;
  invincible = 0;
  jetpackTimer = 0;
  shootPose = 0;
  frame = 0;

  // 미션 초기화
  mission = null;
  missionCooldown = 150; // 시작 2.5초 후 첫 미션 등장
  missionFlash = 0;
  lastMissionId = null;
  landedSet = new Set();

  // 별/낙하 아이템/날씨 초기화
  starCount = 0;
  pickupTimer = 60;
  weather = null;
  weatherWait = Math.round(rand(600, 1500));
  weatherDrops = [];

  // 콤보/연출/위험 요소/고스트 초기화
  combo = 0;
  floatTexts = [];
  shakeT = 0;
  ambients = [];
  ambientTimer = Math.round(rand(400, 900));
  blackholes = [];
  dizzyClouds = [];
  reversedT = 0;
  lastCloseCall = -999;
  ghostRec = [];
  try {
    const g = JSON.parse(localStorage.getItem('jump-ghost') || 'null');
    ghostPts = g && Array.isArray(g.pts) && g.pts.length > 10 ? g.pts : null;
  } catch (e) { ghostPts = null; }
  tut = localStorage.getItem('jump-tut-done')
    ? null
    : { move: false, spring: false, coin: false, star: false, mission: false };

  // 얼음/바람/대포/무중력 초기화
  slipT = 0;
  windState = null;
  windWait = Math.round(rand(700, 1600));
  cannons = [];
  holdCannon = null;
  spaceAnnounced = false;

  // 캐릭터 능력/보스/이스터에그 초기화
  catSave = curChar === 'cat';
  coinFrac = 0;
  closeStreak = 0;
  closeRewarded = false;
  boss = null;
  bossShots = [];
  nextBossAt = 5000;
  standPlat = null;
  ammo = AMMO_MAX;
  reloading = 0;
  jetpackSlow = false;

  // 들고 들어가는 아이템: 생명은 보유분 그대로, 로켓/자석은 있으면 1개 자동 사용
  lives = inv.life;
  magnetActive = false;
  if (state === State.COUNTDOWN) { // 메뉴 배경용 초기화 때는 소비하지 않음
    if (inv.rocket > 0) {
      inv.rocket--;
      jetpackTimer = JETPACK_TIME;
      jetpackSlow = true; // 시작 로켓은 부드럽게 상승
      sfx.jetpack();
    }
    if (inv.magnet > 0) {
      inv.magnet--;
      magnetActive = true;
    }
    saveInv();
    if (upg.rocket > 0) {
      jetpackTimer = Math.max(jetpackTimer, upg.rocket * 30); // 출발 부스트 강화
      jetpackSlow = true;
    }
  }

  // 시작 발판: 바닥 근처에 촘촘히
  platforms.push(makePlatform(W / 2 - PLAT_W / 2, H - 60, PlatType.NORMAL));
  highestPlatY = H - 60;
  while (highestPlatY > -H) spawnPlatformRow();
}

function makePlatform(x, y, type) {
  const d = difficulty();
  // 높이 올라갈수록 발판이 작아짐 (62 → 최소 ~44)
  const w = clamp(PLAT_W - d * 18 + wrand(-3, 3), 40, PLAT_W + 3);
  // 일부 발판은 늘었다 줄었다 (난이도 오를수록 자주)
  const pulse = type !== PlatType.BREAKING && wr() < 0.05 + d * 0.12;
  return {
    x, y, w, h: PLAT_H, type,
    baseW: w,
    pulse,
    pulsePhase: wrand(0, Math.PI * 2),
    vx: type === PlatType.MOVING ? wrand(0.8, 1.4 + d * 1.2) * (wr() < 0.5 ? -1 : 1) : 0,
    broken: false,
    breakAnim: 0,
    spring: false,
    jetpack: false,
  };
}

// 난이도: 0(쉬움) → 1(최대). 12000점에 걸쳐 천천히 어려워짐
function difficulty() {
  return clamp(score / 12000, 0, 1);
}

function spawnPlatformRow() {
  const d = difficulty();
  // 초반엔 아주 촘촘하게(30~44), 후반엔 성기게(최대 88~120)
  const gap = wrand(30 + d * 58, 44 + d * 76);
  const y = highestPlatY - gap;
  const x = wrand(0, W - PLAT_W);

  // 특수 발판 비율: 초반 6% → 후반 45%
  let type = PlatType.NORMAL;
  const r = wr();
  if (r < 0.03 + d * 0.24) type = PlatType.MOVING;
  else if (r < 0.06 + d * 0.39) type = PlatType.ONESHOT;
  // 얼음 발판: 평소 드물게, 눈 올 때는 자주
  if (type === PlatType.NORMAL) {
    const iceChance = 0.03 + d * 0.05 + (weather && weather.type === 'snow' ? 0.25 : 0);
    if (wr() < iceChance) type = PlatType.ICE;
  }

  const p = makePlatform(x, y, type);
  p.x = wrand(0, W - p.w);

  // 아이템: 일반 발판 위에만
  if (type === PlatType.NORMAL) {
    const ir = wr();
    if (ir < 0.06) p.spring = true;
    else if (ir < 0.075) p.jetpack = true;
  }
  platforms.push(p);

  // 부서지는 발판은 근처에 보너스로 추가 (단독 경로가 되지 않게)
  if (wr() < 0.06 + d * 0.2) {
    const bx = wrand(0, W - PLAT_W);
    const by = y - wrand(15, 35);
    if (Math.abs(bx - x) > PLAT_W * 0.8) {
      platforms.push(makePlatform(bx, by, PlatType.BREAKING));
    }
  }

  // 몬스터: 1500점부터 등장, 후반으로 갈수록 잦아짐 (7000점부터는 UFO도)
  if (score > 1500 && wr() < 0.02 + d * 0.07) {
    if (!localStorage.getItem('jump-shoot-hint')) {
      localStorage.setItem('jump-shoot-hint', '1');
      addFloat('👾 몬스터 등장! 화면 위쪽 탭(또는 스페이스바)으로 총 발사!', W / 2, 210, '#c0392b', 14, true);
    }
    const isUfo = score > 7000 && wr() < 0.35;
    monsters.push({
      x: wrand(30, W - 30), y: y - 40,
      w: isUfo ? 50 : 40, h: 34,
      vx: wrand(0.5, 1.2 + d * 0.8) * (wr() < 0.5 ? -1 : 1),
      dead: false,
      wobble: wr() * Math.PI * 2,
      kind: isUfo ? 'ufo' : 'bug',
      hp: isUfo ? 2 : 1,
      baseY: y - 40,
    });
  }

  // 블랙홀: 6000점부터 드물게 (닿으면 빨려들어감!)
  if (score > 6000 && wr() < 0.010 + d * 0.012) {
    blackholes.push({ x: wrand(45, W - 45), y: y - wrand(40, 90), r: 24, spin: 0 });
  }

  // 어지러움 구름: 5000점부터 드물게 (통과하면 잠시 조작 반전)
  if (score > 5000 && wr() < 0.012 + d * 0.012) {
    dizzyClouds.push({ x: wrand(50, W - 50), y: y - wrand(30, 70), w: 74, h: 36, used: false });
  }

  // 대포: 1200점부터 드물게 (떨어져서 들어가면 조준 발사!)
  if (score > 1200 && wr() < 0.009 + d * 0.008) {
    cannons.push({ x: wrand(45, W - 45), y: y - wrand(20, 50), ang: 0, osc: wrand(0, Math.PI * 2), fired: false, timer: 0 });
  }

  highestPlatY = y;
}

// ---------- 발사 ----------
function shoot() {
  if (holdCannon) { // 대포 안이면 탄환 대신 대포 발사! (탄약 소모 없음)
    fireCannon();
    return;
  }
  if (reloading > 0) { // 장전 중엔 빈 소리만
    beep(180, 0.05, 'square', 0.08);
    return;
  }
  if (ammo <= 0) {
    startReload();
    return;
  }
  ammo--;
  bullets.push({ x: player.x, y: player.y - player.h / 2, vy: BULLET_VY });
  shootPose = 20;
  sfx.shoot();
  missionEvent('Shoot');
  if (ammo <= 0) startReload(); // 다 쓰면 자동 재장전
  updateFireBtn();
}

function startReload() {
  if (reloading > 0) return;
  reloading = RELOAD_TIME;
  beep(300, 0.08, 'triangle', 0.12);
  setTimeout(() => beep(420, 0.08, 'triangle', 0.12), 160);
  updateFireBtn();
}

// ---------- 보스 아레나 종료 ----------
function endBossArena() {
  boss = null;
  bossShots = [];
  if (standPlat) {
    standPlat = null;
    player.vy = jumpV(); // 전투 종료 → 다시 통통!
  }
  for (const p of platforms) {
    if (p.arena) addBurst(p.x + p.w / 2, p.y, '#f6e58d');
  }
  platforms = platforms.filter((p) => !p.arena);
}

// ---------- 대포 발사 ----------
function fireCannon() {
  if (!holdCannon) return;
  const cn = holdCannon;
  holdCannon = null;
  cn.fired = true;
  const v = 18;
  player.vx = Math.sin(cn.ang) * v;
  player.vy = -Math.cos(cn.ang) * v * 1.15;
  invincible = Math.max(invincible, 30);
  shakeT = 10;
  beep(90, 0.35, 'sawtooth', 0.25); // 발사음
  vib(70);
  addBurst(cn.x, cn.y - 10, '#e67e22');
  addBurst(cn.x, cn.y - 10, '#f6e58d');
}

// ---------- 죽음 처리: 생명이 있으면 부활 ----------
function tryRevive() {
  // 고양이(나비): 한 판에 한 번 생명 없이도 부활
  if (catSave) {
    catSave = false;
    player.x = clamp(player.x, 30, W - 30);
    player.y = cameraY + H - 4;
    player.vy = SPRING_VY * 1.2;
    player.vx = 0;
    invincible = REVIVE_INVINCIBLE + upg.revive * 60;
    jetpackTimer = 0;
    combo = 0;
    shakeT = 14;
    sfx.revive();
    vib(120);
    addFloat('🐱 고양이 목숨! 한 번 더!', player.x, cameraY + H - 60, '#e67e22', 16);
    addBurst(player.x, player.y, '#f7b05c');
    return true;
  }
  if (lives > 0) {
    lives--;
    inv.life = lives;
    saveInv();
    // 화면 아래에서 크게 튀어오르며 부활 + 잠시 무적
    player.x = clamp(player.x, 30, W - 30);
    player.y = cameraY + H - 4;
    player.vy = SPRING_VY * 1.2;
    player.vx = 0;
    invincible = REVIVE_INVINCIBLE + upg.revive * 60;
    jetpackTimer = 0;
    combo = 0;
    shakeT = 14;
    sfx.revive();
    vib(120);
    addBurst(player.x, player.y, '#e74c3c');
    stats.revives++;
    saveStats();
    checkAchievements();
    return true;
  }
  gameOver();
  return false;
}

// ---------- 업데이트 ----------
function update() {
  frame++;
  if (invincible > 0) invincible--;

  // --- 대포 안에 있을 때: 조준만 하고 물리 정지 ---
  if (holdCannon) {
    holdCannon.osc += 0.05;
    holdCannon.ang = Math.sin(holdCannon.osc) * 0.9; // ±51°로 왕복 조준
    player.x = holdCannon.x;
    player.y = holdCannon.y - 6;
    player.vx = 0;
    player.vy = 0;
    invincible = Math.max(invincible, 3);
    if (--holdCannon.timer <= 0) fireCannon(); // 2초 내 입력 없으면 자동 발사
  }

  // --- 좌우 이동 (어지러움 구름에 닿으면 잠시 반전!) ---
  if (reversedT > 0) reversedT--;
  const rev = reversedT > 0 ? -1 : 1;
  // 기울기는 목표값을 천천히 따라감 (부드럽고 과민하지 않게)
  input.tilt += (tiltTarget - input.tilt) * 0.12;
  let ax = 0;
  if (input.left) ax -= MOVE_ACC;
  if (input.right) ax += MOVE_ACC;
  ax += input.tilt * MOVE_ACC * 1.05;
  ax *= rev;
  // 바람 지대: 옆에서 밀어냄
  if (windState && windState.warnT <= 0 && !holdCannon) {
    player.vx += windState.dir * 0.055;
  }
  // 기울이기 모드는 최고 속도도 살짝 낮게
  const maxV = controlMode === 'tilt' ? MOVE_MAX * 0.8 : MOVE_MAX;
  // 얼음 위를 밟은 직후엔 잘 안 멈춤
  if (slipT > 0) slipT--;
  const friction = slipT > 0 ? 0.995 : MOVE_FRICTION;
  if (!holdCannon) {
    player.vx = clamp((player.vx + ax) * (ax === 0 ? friction : 1), -maxV, maxV);
    player.x += player.vx;
  }
  if (Math.abs(player.vx) > 0.3) player.facing = player.vx < 0 ? 'left' : 'right';

  // 화면 좌우 랩어라운드
  if (player.x < -player.w / 2) player.x = W + player.w / 2;
  if (player.x > W + player.w / 2) player.x = -player.w / 2;

  // --- 보스전 서기: 발판 위에 고정, 가장자리 벗어나면 낙하 ---
  if (standPlat) {
    if (!boss || standPlat.broken ||
        player.x < standPlat.x - 8 || player.x > standPlat.x + standPlat.w + 8) {
      standPlat = null; // 발판을 벗어남 → 자유낙하
    } else {
      player.y = standPlat.y - player.h / 2;
      player.vy = 0;
    }
  }

  // --- 중력/제트팩 (우주에선 무중력에 가깝게 둥실둥실) ---
  const gravity = score > 13500 ? GRAVITY * 0.55 : GRAVITY;
  if (score > 13500 && !spaceAnnounced) {
    spaceAnnounced = true;
    addFloat('🌌 무중력 구간! 둥실둥실~', W / 2, 190, '#dfe6e9', 17, true);
  }
  if (holdCannon || standPlat) {
    // 대포 안/보스전 서기: 중력 없음
  } else if (jetpackTimer > 0) {
    jetpackTimer--;
    player.vy = JETPACK_VY * (jetpackSlow ? 0.65 : 1);
    if (frame % 3 === 0) {
      particles.push({
        x: player.x + rand(-6, 6), y: player.y + player.h / 2,
        vx: rand(-1, 1), vy: rand(2, 4), life: 20, color: '#e67e22',
      });
    }
  } else {
    player.vy += gravity;
  }
  if (!holdCannon && !standPlat) player.y += player.vy;

  // --- 발판 충돌 (하강 중일 때만) ---
  if (player.vy > 0 && jetpackTimer <= 0 && !standPlat) {
    for (const p of platforms) {
      if (p.broken) continue;
      if (boss && !p.arena) continue; // 보스전: 일반 발판은 잠시 사라짐
      const px = player.x, pb = player.y + player.h / 2;
      if (px > p.x - 8 && px < p.x + p.w + 8 &&
          pb > p.y && pb < p.y + p.h + player.vy + 1) {
        if (p.type === PlatType.BREAKING) {
          p.broken = true;
          p.breakAnim = 1;
          sfx.break();
          continue; // 튕기지 않고 통과
        }
        player.y = p.y - player.h / 2;
        // 보스전: 튕기지 않고 발판 위에 선다 — 회피와 공격에 집중!
        if (boss) {
          standPlat = p;
          player.vy = 0;
          const freshB = !landedSet.has(p);
          landedSet.add(p);
          missionEvent('Land', p, { fresh: freshB, spring: false });
          break;
        }
        const usedSpring = !p.jetpack && p.spring;
        if (p.jetpack) {
          p.jetpack = false;
          jetpackTimer = JETPACK_TIME;
          jetpackSlow = false;
          sfx.jetpack();
        } else if (p.spring) {
          player.vy = SPRING_VY;
          sfx.spring();
        } else {
          player.vy = jumpV();
          sfx.jump();
        }
        // 얼음 발판: 잠시 미끄러움 (펭귄은 면역!)
        if (p.type === PlatType.ICE && curChar !== 'penguin') {
          slipT = 55;
          beep(1500, 0.08, 'triangle', 0.1);
          if (frame - lastCloseCall > 120) addFloat('미끌미끌~', player.x, player.y - 40, '#48c9e5', 14);
        }
        if (p.type === PlatType.ONESHOT) p.broken = true;
        // 미션 훅: 처음 밟는 발판인지 + 스프링 여부
        const fresh = !landedSet.has(p);
        landedSet.add(p);
        missionEvent('Land', p, { fresh, spring: usedSpring });

        // 콤보: 새 발판 연속 밟기
        if (fresh) {
          combo++;
          if (combo > stats.maxCombo) { stats.maxCombo = combo; saveStats(); checkAchievements(); }
          if (combo >= 5) score += Math.min(combo, 30); // 콤보 보너스 점수
          if (combo % 10 === 0) {
            runCoins += 3;
            wallet += 3;
            saveWallet();
            addFloat(`x${combo} 콤보! +3🪙`, player.x, player.y - 40, '#e056fd', 18);
            sfx.buy();
          }
        } else {
          combo = 0;
        }

        // 아슬아슬: 발판 가장자리에 겨우 착지
        if (Math.abs(player.x - (p.x + p.w / 2)) > p.w / 2 - 3) {
          closeStreak++;
          if (frame - lastCloseCall > 90) {
            lastCloseCall = frame;
            addFloat('아슬아슬!', player.x, player.y - 42, '#ff6b6b', 15);
          }
          // 이스터에그: 아슬아슬 5연속
          if (closeStreak >= 5 && !closeRewarded) {
            closeRewarded = true;
            runCoins += 50;
            wallet += 50;
            stats.coins += 50;
            saveWallet();
            addFloat('🏵️ 간발의 승부사! +50🪙', W / 2, 230, '#e056fd', 18, true);
            sfx.bonus();
          }
        } else {
          closeStreak = 0;
        }

        // 튜토리얼: 첫 스프링
        if (tut && usedSpring && !tut.spring) {
          tut.spring = true;
          addFloat('스프링! 아주 높이 점프! 🔴', W / 2, 190, '#e74c3c', 16, true);
        }
        break;
      }
    }
  }

  // --- 발판 이동/맥동/정리 ---
  for (const p of platforms) {
    if (p.vx) {
      p.x += p.vx;
      if (p.x < 0 || p.x + p.w > W) p.vx *= -1;
    }
    if (p.pulse) {
      // 중심을 유지하며 늘었다 줄었다 (0.72x ~ 1.08x)
      const newW = p.baseW * (0.9 + 0.18 * Math.sin(frame * 0.045 + p.pulsePhase));
      p.x -= (newW - p.w) / 2;
      p.w = newW;
    }
    if (p.breakAnim > 0) p.breakAnim++;
  }

  // --- 하늘에서 떨어지는 코인/별 ---
  if (--pickupTimer <= 0) {
    pickupTimer = Math.round(rand(35, 75));
    const roll = Math.random();
    const type = roll < 0.16 ? 'star' : roll < 0.23 ? 'rainbow' : 'coin';
    coinsArr.push({
      x: rand(20, W - 20), y: cameraY - 30,
      vy: rand(1.0, 2.1),
      swayPhase: rand(0, Math.PI * 2),
      spin: rand(0, Math.PI * 2),
      type,
    });
  }
  for (const c of coinsArr) {
    c.spin += 0.15;
    c.y += c.vy;                                     // 아래로 낙하
    c.x += Math.sin(frame * 0.05 + c.swayPhase) * 0.6; // 하늘하늘
    // 자석: 범위 내 코인을 끌어당김 (기본 자석 강화 포함)
    const mr = magnetRangeNow();
    if (mr > 0) {
      const dx = player.x - c.x, dy = player.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < mr && dist > 1) {
        c.x += (dx / dist) * 4.5;
        c.y += (dy / dist) * 4.5;
      }
    }
    // 획득
    if (Math.hypot(player.x - c.x, player.y - c.y) < COIN_R + player.w / 2 - 4) {
      c.taken = true;
      if (c.type === 'star') {
        starCount++;
        sfx.spring();
        addBurst(c.x, c.y, '#ffd832');
        if (tut && !tut.star) {
          tut.star = true;
          addFloat('별 10개를 모으면 스타 파워! ⭐', W / 2, 190, '#c78a00', 16, true);
        }
        if (starCount >= starGoalNow()) starPower();
      } else if (c.type === 'rainbow') {
        runCoins += 5;
        wallet += 5;
        stats.coins += 5;
        saveWallet();
        sfx.buy();
        addFloat('+5🪙', c.x, c.y - 14, '#e056fd', 15);
        addBurst(c.x, c.y, '#e056fd');
        missionEvent('Coin');
      } else {
        runCoins++;
        wallet++;
        stats.coins++;
        if (curChar === 'penguin') { // 코인 +10%
          coinFrac += 0.1;
          if (coinFrac >= 1) { coinFrac -= 1; runCoins++; wallet++; stats.coins++; }
        }
        saveWallet();
        sfx.coin();
        particles.push({ x: c.x, y: c.y, vx: 0, vy: -1.5, life: 18, color: '#f1c40f' });
        missionEvent('Coin');
        if (tut && !tut.coin) {
          tut.coin = true;
          addFloat('코인으로 상점에서 아이템을 사요! 🪙', W / 2, 190, '#b7791f', 16, true);
        }
        if (stats.coins % 25 === 0) { saveStats(); checkAchievements(); }
      }
    }
  }
  coinsArr = coinsArr.filter((c) => !c.taken && c.y < cameraY + H + 40);

  // --- 날씨 (비/눈) ---
  updateWeather();

  // --- 블랙홀: 근처에 가면 빨려들어감 (보스전 중 비활성) ---
  for (const bh of blackholes) {
    if (boss) break;
    bh.spin += 0.06;
    const dx = bh.x - player.x, dy = bh.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (invincible <= 0 && jetpackTimer <= 0 && dist < 120) {
      const pull = (1 - dist / 120) * 1.15;
      player.vx += (dx / dist) * pull;
      player.vy += (dy / dist) * pull * 0.8;
      if (dist < bh.r * 0.7) {
        shakeT = 18;
        addBurst(player.x, player.y, '#6c5ce7');
        if (!tryRevive()) return;
      }
    }
  }
  blackholes = blackholes.filter((b) => b.y < cameraY + H + 80);

  // --- 어지러움 구름 (보스전 중 비활성) ---
  for (const dc of dizzyClouds) {
    if (boss) break;
    if (dc.used) continue;
    if (Math.abs(player.x - dc.x) < dc.w / 2 + 10 && Math.abs(player.y - dc.y) < dc.h / 2 + 14) {
      dc.used = true;
      reversedT = 190;
      addFloat('어지러워~! 조작 반전!', player.x, player.y - 44, '#a55eea', 16);
      sfx.break();
      vib(60);
    }
  }
  dizzyClouds = dizzyClouds.filter((d) => d.y < cameraY + H + 60);

  // --- 대포: 떨어지다 닿으면 들어감 ---
  for (const cn of cannons) {
    if (!cn.fired && holdCannon !== cn) cn.osc += 0.02; // 대기 중에도 살짝 흔들
  }
  if (!holdCannon && !boss) {
    for (const cn of cannons) {
      if (cn.fired) continue;
      if (player.vy > 0 && Math.hypot(player.x - cn.x, player.y - cn.y) < 28) {
        holdCannon = cn;
        cn.timer = 130; // 약 2초 뒤 자동 발사
        combo = 0;
        sfx.break();
        vib(40);
        addFloat('탭해서 발사! 🎯', cn.x, cn.y - 46, '#e67e22', 16);
        break;
      }
    }
  }
  cannons = cannons.filter((c) => c.y < cameraY + H + 60);

  // --- 바람 지대 (2500~13500점 구간) ---
  if (windState) {
    if (windState.warnT > 0) windState.warnT--;
    else windState.t--;
    if (windState.t <= 0) {
      windState = null;
      windWait = Math.round(rand(900, 2000));
    }
  } else if (score > 2500 && score < 13500) {
    if (--windWait <= 0) {
      windState = { dir: Math.random() < 0.5 ? -1 : 1, warnT: 90, t: 430 };
      sfx.break();
    }
  }

  // --- 배경 오브젝트 (비행기/열기구/위성/별똥별) ---
  if (--ambientTimer <= 0 && ambients.length < 2) {
    ambientTimer = Math.round(rand(500, 1100));
    const opts = [];
    if (score < 5000) opts.push('balloon');
    if (score > 1500 && score < 9500) opts.push('plane');
    if (score > 9500) opts.push('satellite');
    if (score > 7000) opts.push('shootingstar', 'shootingstar'); // 별똥별은 확률 높게
    if (opts.length) {
      const type = opts[Math.floor(Math.random() * opts.length)];
      const fromLeft = Math.random() < 0.5;
      if (type === 'shootingstar') {
        ambients.push({ type, x: rand(-20, W * 0.5), y: cameraY - 20, vx: rand(3.5, 5), vy: rand(2.5, 3.5) });
      } else {
        ambients.push({
          type,
          x: fromLeft ? -50 : W + 50,
          y: cameraY + rand(80, 360),
          vx: (fromLeft ? 1 : -1) * (type === 'plane' ? rand(1.6, 2.4) : rand(0.35, 0.7)),
          vy: type === 'balloon' ? -0.15 : 0,
        });
      }
    }
  }
  for (const a of ambients) {
    a.x += a.vx;
    a.y += a.vy;
    // 별똥별은 잡으면 보너스 코인!
    if (a.type === 'shootingstar' && Math.hypot(player.x - a.x, player.y - a.y) < 30) {
      a.gone = true;
      runCoins += 5;
      wallet += 5;
      stats.coins += 5;
      saveWallet();
      addFloat('별똥별! +5🪙', a.x, a.y, '#f6e58d', 17);
      addBurst(a.x, a.y, '#f6e58d');
      sfx.buy();
    }
  }
  ambients = ambients.filter((a) => !a.gone && a.x > -80 && a.x < W + 80 && a.y < cameraY + H + 120);

  // --- 미니보스: 5000점마다 등장 ---
  if (!boss && score >= nextBossAt) {
    const tier = Math.round(nextBossAt / 5000);
    boss = {
      tier,
      hp: 5 + tier * 2,
      maxHp: 5 + tier * 2,
      x: W / 2,
      y: cameraY + 95,
      vx: (1.1 + tier * 0.25) * (Math.random() < 0.5 ? -1 : 1),
      t: 1500, // 25초 후 떠남
      shot: 90,
      pattern: 0,
      wobble: 0,
    };
    nextBossAt += 5000;
    // 보스 아레나: 일반 발판은 잠시 사라지고, 화면 전체를 덮는 일자 땅이 생긴다
    const floor = makePlatform(0, cameraY + 568, PlatType.NORMAL);
    floor.x = 0;
    floor.w = W;
    floor.baseW = W;
    floor.pulse = false;
    floor.spring = false;
    floor.jetpack = false;
    floor.arena = true;
    platforms.push(floor);
    monsters = []; // 아레나에선 보스에게 집중
    bossShots = [];
    addFloat('👹 보스전! 좌우로 피하고 🔫 버튼으로 공격!', W / 2, 190, '#c0392b', 16, true);
    beep(70, 0.6, 'sawtooth', 0.22);
    setTimeout(() => beep(55, 0.5, 'sawtooth', 0.2), 350);
    vib([220, 80, 220, 80, 450]); // 드르륵 드르륵 드르르륵!
    shakeT = 26; // 화면도 함께 흔들림 (진동 미지원 기기용)
  }
  if (boss) {
    boss.t--;
    boss.wobble += 0.08;
    boss.x += boss.vx;
    if (boss.x < 45 || boss.x > W - 45) boss.vx *= -1;
    boss.y += ((cameraY + 95) - boss.y) * 0.08; // 카메라 상단을 따라옴
    if (--boss.shot <= 0) {
      boss.shot = Math.max(55, 105 - boss.tier * 8);
      boss.pattern = (boss.pattern + 1) % 3;
      const spd = 3.1 + boss.tier * 0.25;
      if (boss.pattern === 0) {
        // 조준탄: 플레이어 방향으로
        const dx = clamp((player.x - boss.x) / 65, -2.2, 2.2);
        bossShots.push({ x: boss.x, y: boss.y + 28, vx: dx, vy: spd });
      } else if (boss.pattern === 1) {
        // 3갈래 부채꼴
        for (const vx of [-1.7, 0, 1.7]) {
          bossShots.push({ x: boss.x, y: boss.y + 28, vx, vy: spd * 0.95 });
        }
      } else {
        // 양옆 낙하탄
        bossShots.push({ x: boss.x - 34, y: boss.y + 22, vx: 0, vy: spd });
        bossShots.push({ x: boss.x + 34, y: boss.y + 22, vx: 0, vy: spd });
      }
      beep(200, 0.08, 'square', 0.1);
    }
    if (boss.t <= 0) {
      endBossArena();
      addFloat('보스가 물러갔다...', W / 2, 190, '#57606f', 15, true);
    }
    // 아레나 천장: 보스 위로는 못 올라감
    if (player.y < cameraY + 55) {
      player.y = cameraY + 55;
      if (player.vy < 0) player.vy = 0;
    }
  }
  for (const bs of bossShots) {
    bs.y += bs.vy;
    bs.x += bs.vx || 0;
    if (invincible <= 0 && !holdCannon &&
        Math.hypot(player.x - bs.x, player.y - bs.y) < 18) {
      bs.y = cameraY + H + 999;
      shakeT = 16;
      addBurst(player.x, player.y, '#c0392b');
      if (!tryRevive()) return;
    }
  }
  bossShots = bossShots.filter((bs) => bs.y < cameraY + H + 40);

  // --- 고스트 기록 (내 최고 기록 궤적) ---
  if (frame % GHOST_STEP === 0 && ghostRec.length < 24000) {
    ghostRec.push([Math.round(player.x), Math.round(player.y)]);
  }

  // --- 연출 타이머 ---
  if (shakeT > 0) shakeT--;
  for (const f of floatTexts) { f.life--; if (!f.screen) f.y -= 0.4; }
  floatTexts = floatTexts.filter((f) => f.life > 0);

  // --- 튜토리얼: 첫 미션 안내 ---
  if (tut && mission && !tut.mission) {
    tut.mission = true;
    addFloat('미션을 완수하면 보너스 타임! 🎯', W / 2, 190, '#6c3fb5', 16, true);
  }

  // --- 몬스터 ---
  for (const m of monsters) {
    if (m.dead) continue;
    m.x += m.vx;
    m.wobble += 0.1;
    if (m.kind === 'ufo') m.y = m.baseY + Math.sin(m.wobble * 0.8) * 18; // UFO는 위아래로 흔들림
    if (m.x < 20 || m.x > W - 20) m.vx *= -1;

    // 플레이어 충돌 (무적 중엔 통과)
    if (invincible > 0) continue;
    const dx = Math.abs(player.x - m.x);
    const dy = player.y - m.y;
    if (dx < (player.w + m.w) / 2 - 8 && Math.abs(dy) < (player.h + m.h) / 2 - 6) {
      if (player.vy > 0 && dy < -4) {
        // 위에서 밟으면: 벌레는 처치, UFO는 밟고 튕기기만
        if (m.kind === 'ufo') {
          player.vy = jumpV();
          sfx.jump();
          addBurst(m.x, m.y - m.h / 2, '#95afc0');
        } else {
          m.dead = true;
          player.vy = jumpV();
          sfx.hit();
          vib(40);
          addBurst(m.x, m.y, '#9b59b6');
          missionEvent('Kill');
          stats.kills++;
          saveStats();
          checkAchievements();
        }
      } else {
        m.dead = true; // 부활 직후 같은 몬스터에 또 죽지 않게 제거
        shakeT = 16;
        addBurst(m.x, m.y, '#9b59b6');
        if (!tryRevive()) return;
      }
    }
  }

  // --- 총알 ---
  for (const b of bullets) {
    b.y += b.vy;
    // 보스 피격
    if (boss && Math.abs(b.x - boss.x) < 36 && Math.abs(b.y - boss.y) < 30) {
      b.y = -9999;
      boss.hp--;
      addBurst(boss.x, boss.y, '#c0392b');
      sfx.hit();
      if (boss.hp <= 0) {
        const reward = 20 + boss.tier * 10;
        runCoins += reward;
        wallet += reward;
        stats.coins += reward;
        saveWallet();
        score += 300; // 격파 보너스 점수
        missionFlash = 140;
        flashMain = '👹 보스 격파!';
        flashSub = `+${reward}🪙 +300점`;
        addBurst(boss.x, boss.y, '#c0392b');
        addBurst(boss.x, boss.y, '#f6e58d');
        shakeT = 14;
        sfx.bonus();
        vib(120);
        endBossArena();
      }
      continue;
    }
    for (const m of monsters) {
      if (m.dead) continue;
      if (Math.abs(b.x - m.x) < m.w / 2 && Math.abs(b.y - m.y) < m.h / 2) {
        b.y = -9999;
        m.hp = (m.hp || 1) - 1;
        if (m.hp <= 0) {
          m.dead = true;
          sfx.hit();
          addBurst(m.x, m.y, m.kind === 'ufo' ? '#95afc0' : '#9b59b6');
          missionEvent('Kill');
          stats.kills++;
          saveStats();
          checkAchievements();
        } else {
          sfx.break();
          addBurst(b.x, b.y, '#f5b70d');
        }
      }
    }
  }
  bullets = bullets.filter((b) => b.y > cameraY - 50);
  if (shootPose > 0) shootPose--;

  // --- 파티클 ---
  for (const pt of particles) {
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life--;
  }
  particles = particles.filter((pt) => pt.life > 0);

  // --- 카메라 스크롤 & 점수 (보스전에는 카메라 고정) ---
  const threshold = cameraY + H * 0.4;
  if (!boss && player.y < threshold) {
    const diff = threshold - player.y;
    cameraY -= diff;
    score += Math.round(diff);
  }

  // --- 새 발판 생성 / 화면 아래 정리 ---
  while (highestPlatY > cameraY - 100) spawnPlatformRow();
  platforms = platforms.filter((p) => p.y < cameraY + H + 60 && !(p.broken && p.breakAnim > 30));
  monsters = monsters.filter((m) => m.y < cameraY + H + 80 && !m.dead);

  // --- 재장전 ---
  if (reloading > 0) {
    reloading--;
    if (reloading === 0) {
      ammo = AMMO_MAX;
      beep(650, 0.09, 'square', 0.12); // 철컥!
      updateFireBtn();
    } else if (frame % 6 === 0) {
      updateFireBtn();
    }
  }

  // --- 미션 진행 ---
  if (missionFlash > 0) missionFlash--;
  if (!mission) {
    if (missionCooldown > 0) missionCooldown--;
    else pickMission();
  } else if (mission.def.tick) {
    mission.def.tick(mission.s);
    if (mission.def.done(mission.s)) completeMission();
  }

  // --- 도전과제 달성 알림 (배너가 비었을 때 순서대로) ---
  if (achToast.length && missionFlash <= 0) {
    const a = achToast.shift();
    missionFlash = 140;
    flashMain = '🏆 도전과제 달성!';
    flashSub = `${a.name} (+${a.reward}🪙)`;
  }

  // --- 낙사 (보스전에는 죽지 않고 바닥 발판으로 복귀) ---
  if (player.y > cameraY + H + player.h) {
    if (boss) {
      const floor = platforms.filter((p) => p.arena)
        .sort((a, b) => b.y - a.y)
        .find((p) => true);
      if (floor) {
        player.x = floor.x + floor.w / 2;
        player.y = floor.y - player.h / 2;
        player.vy = 0;
        standPlat = floor;
        invincible = Math.max(invincible, 60);
        addFloat('휴~ 다시 올라왔다!', player.x, player.y - 40, '#57606f', 14);
        sfx.revive();
      } else {
        tryRevive();
      }
    } else {
      tryRevive();
    }
  }
}

function addBurst(x, y, color) {
  for (let i = 0; i < 12; i++) {
    particles.push({
      x, y,
      vx: rand(-3, 3), vy: rand(-3, 3),
      life: rand(15, 30), color,
    });
  }
}

// ---------- 그리기 ----------
// 고도별 배경 색 구간: 지상 → 하늘 → 성층권 → 우주
const BG_STOPS = [
  [0,     [150, 214, 236], [196, 232, 200]], // 지상: 하늘 + 풀빛 지평선
  [3500,  [125, 200, 235], [176, 224, 230]], // 하늘
  [8500,  [66, 114, 190],  [120, 168, 220]], // 성층권
  [14000, [10, 10, 40],    [40, 30, 80]],    // 우주
];

function bgColors() {
  let a = BG_STOPS[0], b = BG_STOPS[BG_STOPS.length - 1];
  for (let i = 0; i < BG_STOPS.length - 1; i++) {
    if (score >= BG_STOPS[i][0] && score < BG_STOPS[i + 1][0]) {
      a = BG_STOPS[i];
      b = BG_STOPS[i + 1];
      break;
    }
  }
  const t = a === b ? 0 : clamp((score - a[0]) / (b[0] - a[0]), 0, 1);
  return [lerpColor(a[1], b[1], t), lerpColor(a[2], b[2], t)];
}

function drawBackground() {
  const [top, bot] = bgColors();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgb(${top.join(',')})`);
  g.addColorStop(1, `rgb(${bot.join(',')})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 구름은 성층권에서 옅어지고, 별은 우주에 가까울수록 나타남
  const cloudA = clamp(1 - (score - 7000) / 4000, 0, 1);
  const starA = clamp((score - 10500) / 3500, 0, 1);
  ctx.save();
  const par = cameraY * 0.3;
  for (let i = 0; i < 8; i++) {
    const cy = ((i * 217 - par) % (H + 80) + H + 80) % (H + 80) - 40;
    const cx = (i * 137) % W;
    if (cloudA > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * cloudA})`;
      drawCloud(cx, cy);
    }
    if (starA > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * starA})`;
      ctx.fillRect((cx * 1.7 + 40) % W, (cy * 1.3) % H, 3, 3);
      ctx.fillRect((cx * 0.6 + 150) % W, (cy * 0.8 + 90) % H, 2, 2);
    }
  }
  ctx.restore();

  // 지상 (게임 시작 지점 근처에서만 보임)
  const groundScreenY = (H - 26) - cameraY;
  if (groundScreenY < H + 30) {
    ctx.fillStyle = '#5cb168';
    ctx.fillRect(0, groundScreenY, W, H - groundScreenY + 30);
    ctx.fillStyle = '#4c9c58';
    for (let i = 0; i < 9; i++) {
      const bx = (i * 47 + 12) % W;
      ctx.beginPath();
      ctx.arc(bx, groundScreenY + 2, 7 + (i % 3) * 3, Math.PI, 0);
      ctx.fill();
    }
    // 수풀
    ctx.fillStyle = '#3f8a4b';
    ctx.beginPath();
    ctx.arc(50, groundScreenY, 14, Math.PI, 0);
    ctx.arc(72, groundScreenY, 18, Math.PI, 0);
    ctx.arc(300, groundScreenY, 16, Math.PI, 0);
    ctx.fill();
  }
}

function drawSeason() {
  // 여름: 낮은 고도에서 태양
  if (SEASON === 'summer' && score < 3500) {
    ctx.save();
    const sx = W - 62, sy = 96;
    ctx.globalAlpha = clamp(1 - score / 3500, 0, 1) * 0.9;
    ctx.fillStyle = '#ffe28a';
    ctx.shadowColor = 'rgba(255, 214, 90, 0.9)';
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 220, 110, 0.7)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 + frame * 0.003;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * 33, sy + Math.sin(a) * 33);
      ctx.lineTo(sx + Math.cos(a) * 42, sy + Math.sin(a) * 42);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 봄 꽃잎 / 가을 낙엽
  for (const p of seasonParts) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (SEASON === 'spring') {
      ctx.fillStyle = 'rgba(255, 183, 197, 0.9)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(224, 130, 60, 0.9)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawWeather() {
  if (!weatherDrops.length) return;
  ctx.save();
  for (const w of weatherDrops) {
    if (w.rain) {
      ctx.strokeStyle = 'rgba(175,200,235,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(w.x + w.vx * 1.4, w.y - 14);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCloud(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.arc(x + 18, y + 4, 12, 0, Math.PI * 2);
  ctx.arc(x - 18, y + 5, 11, 0, Math.PI * 2);
  ctx.fill();
}

function lerpColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function drawPlatform(p) {
  if (boss && !p.arena) return; // 보스전 중 일반 발판 숨김
  const y = p.y - cameraY;
  ctx.save();
  if (p.broken && p.type === PlatType.BREAKING) {
    // 부서지는 애니메이션: 두 조각으로 갈라져 떨어짐
    const fall = p.breakAnim * p.breakAnim * 0.15;
    ctx.fillStyle = '#8B5A2B';
    ctx.save();
    ctx.translate(p.x + p.w / 4, y + fall);
    ctx.rotate(-0.3 - p.breakAnim * 0.02);
    roundRect(-p.w / 4, 0, p.w / 2, p.h, 6);
    ctx.restore();
    ctx.save();
    ctx.translate(p.x + p.w * 0.75, y + fall);
    ctx.rotate(0.3 + p.breakAnim * 0.02);
    roundRect(-p.w / 4, 0, p.w / 2, p.h, 6);
    ctx.restore();
    ctx.restore();
    return;
  }
  if (p.broken) { ctx.restore(); return; }

  // 부드러운 그림자
  ctx.fillStyle = 'rgba(30, 50, 70, 0.13)';
  roundRect(p.x + 2, y + 4, p.w, p.h, 7);

  if (p.type === PlatType.ONESHOT) {
    // 흰 발판: 뭉게구름 모양 (한 번 밟으면 사라지는 느낌)
    ctx.fillStyle = 'rgba(210, 218, 226, 0.9)';
    cloudPuffs(p.x, y + 3, p.w, p.h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    cloudPuffs(p.x, y, p.w, p.h);
  } else if (p.type === PlatType.BREAKING) {
    // 갈색 발판: 나무 판자 + 갈라진 금
    const g = ctx.createLinearGradient(0, y, 0, y + p.h);
    g.addColorStop(0, '#c08a52');
    g.addColorStop(0.5, '#a06a3c');
    g.addColorStop(1, '#7e4f28');
    ctx.fillStyle = g;
    roundRect(p.x, y, p.w, p.h, 6);
    // 나뭇결
    ctx.strokeStyle = 'rgba(90, 55, 25, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x + 6, y + 5);
    ctx.lineTo(p.x + p.w - 8, y + 5);
    ctx.moveTo(p.x + 9, y + 9.5);
    ctx.lineTo(p.x + p.w - 5, y + 9.5);
    ctx.stroke();
    // 가운데 금
    ctx.strokeStyle = 'rgba(60, 35, 15, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x + p.w / 2 - 4, y);
    ctx.lineTo(p.x + p.w / 2 + 2, y + 5);
    ctx.lineTo(p.x + p.w / 2 - 3, y + 9);
    ctx.lineTo(p.x + p.w / 2 + 3, y + p.h);
    ctx.stroke();
  } else if (p.type === PlatType.MOVING) {
    // 파란 발판: 유리 광택 + 이동 표시 화살표
    const g = ctx.createLinearGradient(0, y, 0, y + p.h);
    g.addColorStop(0, '#6cc4f5');
    g.addColorStop(0.55, '#3498db');
    g.addColorStop(1, '#21689b');
    ctx.fillStyle = g;
    roundRect(p.x, y, p.w, p.h, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    roundRect(p.x + 3, y + 2, p.w - 6, 4.5, 3);
    // 진행 방향 화살표
    const dir = p.vx >= 0 ? 1 : -1;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    const ax = p.x + p.w / 2 + dir * (p.w / 2 - 9);
    ctx.beginPath();
    ctx.moveTo(ax - dir * 4, y + 4);
    ctx.lineTo(ax, y + 7);
    ctx.lineTo(ax - dir * 4, y + 10);
    ctx.stroke();
  } else if (p.type === PlatType.ICE) {
    // 얼음 발판: 반투명 하늘색 + 광택 + 고드름
    const g = ctx.createLinearGradient(0, y, 0, y + p.h);
    g.addColorStop(0, '#eafafd');
    g.addColorStop(0.5, '#aee6f2');
    g.addColorStop(1, '#6fc7de');
    ctx.fillStyle = g;
    roundRect(p.x, y, p.w, p.h, 7);
    // 광택 줄
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x + 6, y + 4);
    ctx.lineTo(p.x + p.w * 0.4, y + 4);
    ctx.moveTo(p.x + p.w * 0.55, y + 8);
    ctx.lineTo(p.x + p.w * 0.75, y + 8);
    ctx.stroke();
    // 고드름
    ctx.fillStyle = 'rgba(174, 230, 242, 0.95)';
    ctx.beginPath();
    ctx.moveTo(p.x + p.w * 0.25 - 4, y + p.h);
    ctx.lineTo(p.x + p.w * 0.25, y + p.h + 8);
    ctx.lineTo(p.x + p.w * 0.25 + 4, y + p.h);
    ctx.moveTo(p.x + p.w * 0.7 - 3, y + p.h);
    ctx.lineTo(p.x + p.w * 0.7, y + p.h + 6);
    ctx.lineTo(p.x + p.w * 0.7 + 3, y + p.h);
    ctx.fill();
  } else {
    // 초록 발판: 잔디 질감
    const g = ctx.createLinearGradient(0, y, 0, y + p.h);
    g.addColorStop(0, '#48dd8b');
    g.addColorStop(0.5, '#2ecc71');
    g.addColorStop(1, '#1f9c55');
    ctx.fillStyle = g;
    roundRect(p.x, y, p.w, p.h, 7);
    // 겨울엔 눈 덮개
    if (SEASON === 'winter') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      roundRect(p.x + 1, y - 2, p.w - 2, 6, 4);
    }
    // 잔디 잎
    ctx.fillStyle = '#5fe89d';
    for (let gx = p.x + 6; gx < p.x + p.w - 4; gx += 8) {
      const hgt = 3 + ((gx * 7) % 3);
      ctx.beginPath();
      ctx.moveTo(gx, y + 1);
      ctx.lineTo(gx + 2.6, y - hgt);
      ctx.lineTo(gx + 5.2, y + 1);
      ctx.fill();
    }
    // 아래 어두운 흙 라인
    ctx.fillStyle = 'rgba(20, 90, 50, 0.35)';
    roundRect(p.x + 2, y + p.h - 4, p.w - 4, 3, 2);
    // 보스 아레나 발판: 금빛 테두리
    if (p.arena) {
      ctx.strokeStyle = `rgba(246, 185, 59, ${0.6 + 0.4 * Math.sin(frame * 0.12)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x + 7, y);
      ctx.arcTo(p.x + p.w, y, p.x + p.w, y + p.h, 7);
      ctx.arcTo(p.x + p.w, y + p.h, p.x, y + p.h, 7);
      ctx.arcTo(p.x, y + p.h, p.x, y, 7);
      ctx.arcTo(p.x, y, p.x + p.w, y, 7);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 스프링: 코일 + 빨간 캡
  if (p.spring) {
    const sx = p.x + p.w / 2;
    ctx.strokeStyle = '#95a5a6';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const yy = y - 2 - i * 3.4;
      ctx.moveTo(sx - 7, yy);
      ctx.lineTo(sx + 7, yy - 1.6);
    }
    ctx.stroke();
    const capG = ctx.createLinearGradient(0, y - 17, 0, y - 10);
    capG.addColorStop(0, '#ff7961');
    capG.addColorStop(1, '#c0392b');
    ctx.fillStyle = capG;
    roundRect(sx - 11, y - 17, 22, 6.5, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRect(sx - 8, y - 16, 9, 2.2, 1);
  }
  // 제트팩: 미니 로켓
  if (p.jetpack) {
    const jx = p.x + p.w / 2;
    const bodyG = ctx.createLinearGradient(jx - 8, 0, jx + 8, 0);
    bodyG.addColorStop(0, '#ffb74d');
    bodyG.addColorStop(0.5, '#f39c12');
    bodyG.addColorStop(1, '#c87f0a');
    ctx.fillStyle = bodyG;
    roundRect(jx - 8, y - 24, 16, 22, 6);
    // 노즈콘
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(jx - 8, y - 22);
    ctx.quadraticCurveTo(jx, y - 34, jx + 8, y - 22);
    ctx.fill();
    // 창문
    ctx.fillStyle = '#aee3ff';
    ctx.strokeStyle = '#7fb2cc';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(jx, y - 15, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 날개
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(jx - 8, y - 8);
    ctx.lineTo(jx - 13, y - 2);
    ctx.lineTo(jx - 8, y - 3);
    ctx.moveTo(jx + 8, y - 8);
    ctx.lineTo(jx + 13, y - 2);
    ctx.lineTo(jx + 8, y - 3);
    ctx.fill();
  }
  ctx.restore();
}

// 뭉게구름형 발판 퍼프
function cloudPuffs(x, y, w, h) {
  ctx.beginPath();
  const r = h * 0.72;
  const n = Math.max(3, Math.round(w / 18));
  for (let i = 0; i < n; i++) {
    const cx = x + r + (w - r * 2) * (i / (n - 1));
    const rr = r * (i % 2 === 0 ? 1.05 : 0.85);
    ctx.arc(cx, y + h / 2, rr, 0, Math.PI * 2);
  }
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

function drawCoin(c) {
  const y = c.y - cameraY;
  ctx.save();
  ctx.translate(c.x, y);
  if (c.type === 'star') {
    // 반짝이는 별: 금빛 발광 + 회전
    ctx.shadowColor = 'rgba(255, 210, 60, 0.9)';
    ctx.shadowBlur = 12;
    ctx.rotate(c.spin * 0.35);
    const R = 13, r = 5.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    const sg = ctx.createRadialGradient(0, 0, 1, 0, 0, R);
    sg.addColorStop(0, '#fff3b8');
    sg.addColorStop(0.55, '#ffd832');
    sg.addColorStop(1, '#f0a800');
    ctx.fillStyle = sg;
    ctx.strokeStyle = '#d99700';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(-3, -4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (c.type === 'rainbow') {
    // 무지개 코인 (5코인 가치): 색이 변하는 링
    const hue = (frame * 6) % 360;
    ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.8)`;
    ctx.shadowBlur = 10;
    const squeeze2 = Math.max(Math.abs(Math.sin(c.spin)), 0.3);
    ctx.scale(squeeze2, 1);
    const rg = ctx.createRadialGradient(-3, -4, 1, 0, 0, COIN_R + 3);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.55, `hsl(${hue}, 90%, 68%)`);
    rg.addColorStop(1, `hsl(${(hue + 60) % 360}, 90%, 52%)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `hsl(${(hue + 120) % 360}, 80%, 45%)`;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '900 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('5', 0, 1);
  } else {
    // 금화: 방사형 광택 + 회전 + 은은한 발광
    ctx.shadowColor = 'rgba(255, 200, 60, 0.55)';
    ctx.shadowBlur = 7;
    const squeeze = Math.max(Math.abs(Math.sin(c.spin)), 0.25);
    ctx.scale(squeeze, 1);
    const cg = ctx.createRadialGradient(-3, -4, 1, 0, 0, COIN_R + 1);
    cg.addColorStop(0, '#fff0a8');
    cg.addColorStop(0.5, '#f7ce2b');
    cg.addColorStop(1, '#d09a10');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 안쪽 테두리
    ctx.strokeStyle = 'rgba(180, 130, 15, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#a97c0a';
    ctx.font = '900 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₩', 0, 1);
    // 반짝임
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(-3.5, -4.5, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawAmbients() {
  for (const a of ambients) {
    const y = a.y - cameraY;
    if (y < -60 || y > H + 60) continue;
    ctx.save();
    ctx.translate(a.x, y);
    if (a.type === 'balloon') {
      ctx.fillStyle = '#ff7979';
      ctx.beginPath();
      ctx.ellipse(0, -14, 15, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f6e58d';
      ctx.beginPath();
      ctx.ellipse(0, -14, 6, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8d6e63';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(-5, 12);
      ctx.moveTo(8, 0); ctx.lineTo(5, 12);
      ctx.stroke();
      ctx.fillStyle = '#a0785a';
      ctx.fillRect(-7, 12, 14, 9);
    } else if (a.type === 'plane') {
      const dir = a.vx > 0 ? 1 : -1;
      ctx.scale(dir, 1);
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(-20, -2); ctx.lineTo(-30, -12); ctx.lineTo(-22, -1);
      ctx.fill();
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.moveTo(-2, 0); ctx.lineTo(-12, 12); ctx.lineTo(4, 3);
      ctx.moveTo(0, -2); ctx.lineTo(-8, -12); ctx.lineTo(6, -3);
      ctx.fill();
      ctx.fillStyle = '#74b9ff';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(4 + i * 5, -1.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (a.type === 'satellite') {
      ctx.rotate(0.3);
      ctx.fillStyle = '#576574';
      ctx.fillRect(-7, -9, 14, 18);
      ctx.fillStyle = '#3867d6';
      ctx.fillRect(-30, -6, 19, 12);
      ctx.fillRect(11, -6, 19, 12);
      ctx.strokeStyle = '#8395a7';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-30, -6, 19, 12);
      ctx.strokeRect(11, -6, 19, 12);
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, -16);
      ctx.stroke();
    } else if (a.type === 'shootingstar') {
      // 꼬리
      ctx.strokeStyle = 'rgba(246, 229, 141, 0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-a.vx * 8, -a.vy * 8);
      ctx.stroke();
      ctx.shadowColor = 'rgba(255, 230, 100, 0.95)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fff7cf';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawBlackhole(bh) {
  const y = bh.y - cameraY;
  if (y < -60 || y > H + 60) return;
  ctx.save();
  ctx.translate(bh.x, y);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, bh.r * 2);
  g.addColorStop(0, 'rgba(10, 5, 25, 1)');
  g.addColorStop(0.45, 'rgba(50, 25, 95, 0.85)');
  g.addColorStop(0.8, 'rgba(108, 92, 231, 0.25)');
  g.addColorStop(1, 'rgba(108, 92, 231, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, bh.r * 2, 0, Math.PI * 2);
  ctx.fill();
  // 소용돌이 팔
  ctx.rotate(bh.spin);
  ctx.strokeStyle = 'rgba(190, 170, 255, 0.55)';
  ctx.lineWidth = 2;
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.08) {
      const a2 = arm * (Math.PI * 2 / 3) + t * 3.2;
      const r2 = 4 + t * bh.r * 1.4;
      const px2 = Math.cos(a2) * r2, py2 = Math.sin(a2) * r2;
      if (t === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawDizzyCloud(dc) {
  const y = dc.y - cameraY;
  if (y < -50 || y > H + 50) return;
  ctx.save();
  ctx.translate(dc.x, y);
  ctx.globalAlpha = dc.used ? 0.35 : 0.9;
  ctx.fillStyle = '#b39ddb';
  ctx.beginPath();
  ctx.arc(-22, 2, 13, 0, Math.PI * 2);
  ctx.arc(0, -4, 17, 0, Math.PI * 2);
  ctx.arc(22, 2, 13, 0, Math.PI * 2);
  ctx.arc(0, 6, 15, 0, Math.PI * 2);
  ctx.fill();
  if (!dc.used) {
    ctx.fillStyle = '#5f3dc4';
    ctx.font = '900 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('@', 0, 0);
  }
  ctx.restore();
}

function drawCannon(cn) {
  const y = cn.y - cameraY;
  if (y < -60 || y > H + 60) return;
  ctx.save();
  ctx.translate(cn.x, y);
  const holding = holdCannon === cn;
  // 조준선 (들어가 있을 때)
  if (holding) {
    ctx.save();
    ctx.rotate(cn.ang);
    ctx.strokeStyle = 'rgba(230, 126, 34, 0.7)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(0, -95);
    ctx.stroke();
    ctx.setLineDash([]);
    // 화살촉
    ctx.fillStyle = 'rgba(230, 126, 34, 0.85)';
    ctx.beginPath();
    ctx.moveTo(0, -102);
    ctx.lineTo(-6, -90);
    ctx.lineTo(6, -90);
    ctx.fill();
    ctx.restore();
  }
  // 포신
  ctx.save();
  ctx.rotate(holding ? cn.ang : Math.sin(cn.osc) * 0.9 * 0.35);
  const bg2 = ctx.createLinearGradient(-9, 0, 9, 0);
  bg2.addColorStop(0, '#57606f');
  bg2.addColorStop(0.5, '#2f3542');
  bg2.addColorStop(1, '#1e232d');
  ctx.fillStyle = bg2;
  roundRect(-9, -30, 18, 32, 6);
  ctx.fillStyle = '#e67e22';
  roundRect(-9, -14, 18, 4, 2); // 주황 띠
  ctx.restore();
  // 받침대
  ctx.fillStyle = cn.fired ? '#95a5a6' : '#e74c3c';
  ctx.beginPath();
  ctx.arc(0, 6, 13, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#7f4d1e';
  roundRect(-16, 6, 32, 7, 3);
  ctx.restore();
}

function drawWindOverlay() {
  if (!windState) return;
  const dir = windState.dir;
  if (windState.warnT > 0) {
    // 예고
    if (Math.floor(windState.warnT / 8) % 2 === 0) {
      ctx.font = '900 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 5;
      const msg = dir > 0 ? '💨 강풍 주의! →' : '← 강풍 주의! 💨';
      ctx.strokeText(msg, W / 2, 170);
      ctx.fillStyle = '#0984e3';
      ctx.fillText(msg, W / 2, 170);
    }
    return;
  }
  // 바람 줄무늬
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const yy = (i * 61 + 30) % H;
    const xx = ((i * 97 + frame * 5 * dir) % (W + 60) + W + 60) % (W + 60) - 30;
    ctx.beginPath();
    ctx.moveTo(xx, yy);
    ctx.lineTo(xx + 22 * dir, yy);
    ctx.lineTo(xx + 16 * dir, yy - 3);
    ctx.stroke();
  }
}

function drawBoss() {
  if (!boss) return;
  const y = boss.y - cameraY + Math.sin(boss.wobble) * 4;
  ctx.save();
  ctx.translate(boss.x, y);
  // 뿔
  ctx.fillStyle = '#8e2f2f';
  ctx.beginPath();
  ctx.moveTo(-24, -22); ctx.lineTo(-36, -44); ctx.lineTo(-14, -30);
  ctx.moveTo(24, -22); ctx.lineTo(36, -44); ctx.lineTo(14, -30);
  ctx.fill();
  // 몸통 (크고 진한 보라)
  const g = ctx.createRadialGradient(-10, -12, 5, 0, 0, 46);
  g.addColorStop(0, '#a06bc4');
  g.addColorStop(0.6, '#6c3483');
  g.addColorStop(1, '#4a235a');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#341c42';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 화난 눈
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffdd59';
    ctx.beginPath();
    ctx.ellipse(side * 14, -8, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(side * 12, -7, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#341c42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(side * 5, -20);
    ctx.lineTo(side * 22, -14);
    ctx.stroke();
  }
  // 이빨 입
  ctx.fillStyle = '#341c42';
  ctx.beginPath();
  ctx.ellipse(0, 13, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-12, 8); ctx.lineTo(-8, 15); ctx.lineTo(-4, 8);
  ctx.moveTo(12, 8); ctx.lineTo(8, 15); ctx.lineTo(4, 8);
  ctx.fill();
  // HP 바
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(-34, -52, 68, 8, 4);
  ctx.fillStyle = '#e74c3c';
  roundRect(-33, -51, 66 * (boss.hp / boss.maxHp), 6, 3);
  ctx.restore();

  // 보스 투사체
  for (const bs of bossShots) {
    const sy = bs.y - cameraY;
    ctx.save();
    ctx.shadowColor = 'rgba(192, 57, 43, 0.8)';
    ctx.shadowBlur = 8;
    const pg = ctx.createRadialGradient(bs.x - 1, sy - 1, 0.5, bs.x, sy, 7);
    pg.addColorStop(0, '#ff9f8a');
    pg.addColorStop(1, '#c0392b');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(bs.x, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGhost() {
  if (!ghostPts || state !== State.PLAYING) return;
  const i = Math.floor(frame / GHOST_STEP);
  if (i >= ghostPts.length) return;
  const [gx, gy] = ghostPts[i];
  const sy = gy - cameraY;
  if (sy < -40 || sy > H + 40) return;
  const img = charImgs.left;
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.drawImage(img, gx - 23, sy - 23, 46, 46);
  ctx.globalAlpha = 0.5;
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2c3e50';
  ctx.fillText('👻 최고기록', gx, sy - 30);
  ctx.restore();
}

function drawPlayer() {
  if (holdCannon) return; // 대포 안에 있을 때는 안 보임
  const hop = menuHop > 0 ? Math.sin((menuHop / 28) * Math.PI) * 22 : 0;
  const x = player.x, y = player.y - cameraY - hop;
  ctx.save();
  ctx.translate(x, y);

  // 부활 무적: 깜빡임 (보너스 비행 중에는 깜빡이지 않음)
  if (invincible > 0 && jetpackTimer <= 0 && Math.floor(invincible / 6) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }

  // 제트팩 장착 표시
  if (jetpackTimer > 0) {
    ctx.fillStyle = '#f39c12';
    roundRect(-player.w / 2 - 10, -14, 12, 26, 4);
  }

  // 포즈 선택: 발사 > 상승(뛰는 모습) > 기본
  let img = null;
  let flip = false;
  const rising = player.vy < -1 || jetpackTimer > 0;
  if (shootPose > 0 && charImgs.shoot) {
    img = charImgs.shoot;
  } else if (rising && charImgs.fly) {
    img = charImgs.fly;
    flip = player.facing === 'right';
  } else if (player.facing === 'right' && charImgs.right) {
    img = charImgs.right;
  } else {
    img = charImgs.left;
    flip = player.facing === 'right' && !charImgs.right;
  }

  if (img) {
    if (flip) ctx.scale(-1, 1);
    drawAccessoriesBack();
    ctx.drawImage(img, -player.w / 2, -player.h / 2, player.w, player.h);
    drawAccessoriesFront();
  } else {
    drawDefaultCharacter();
  }
  ctx.restore();
}

const wearing = (item) => equip[item] && inv[item];

// 등 뒤 아이템 (캐릭터보다 먼저 그림)
function drawAccessoriesBack() {
  if (wearing('wings')) {
    // 천사 날개: 위아래로 팔랑
    const f = Math.sin(frame * 0.25) * 3;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(180, 190, 210, 0.9)';
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 15, -6 + f * 0.4, 12, 5.5, side * -0.7, 0, Math.PI * 2);
      ctx.ellipse(side * 19, -1 + f * 0.7, 10, 4.5, side * -0.85, 0, Math.PI * 2);
      ctx.ellipse(side * 21, 4 + f, 8, 3.6, side * -1.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  if (wearing('cape')) {
    // 망토: 뒤로 휘날림 (기본 왼쪽을 보므로 오른쪽 뒤로)
    const wave = Math.sin(frame * 0.18) * 4;
    ctx.save();
    const g = ctx.createLinearGradient(2, -8, 22, 16);
    g.addColorStop(0, '#e74c3c');
    g.addColorStop(1, '#a93226');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(16, -4 + wave * 0.4, 22, 8 + wave);
    ctx.quadraticCurveTo(17, 15 + wave * 0.6, 12, 12 + wave * 0.5);
    ctx.quadraticCurveTo(9, 16 + wave * 0.3, 5, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// 앞쪽 아이템 (캐릭터 위에 그림 · 사이드뷰 머리 기준, 좌우반전은 ctx가 처리)
function drawAccessoriesFront() {
  const hx = -9, hy = -14; // 머리 대략 위치

  if (wearing('hat')) {
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(hx, hy - 5, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - 8, hy - 6, 16, 3);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(hx - 15, hy - 5, 9, 2.6); // 챙 (보는 방향 쪽)
  }
  if (wearing('crown')) {
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#c29d0b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx - 8, hy - 4);
    ctx.lineTo(hx - 8, hy - 12);
    ctx.lineTo(hx - 4, hy - 7);
    ctx.lineTo(hx, hy - 14);
    ctx.lineTo(hx + 4, hy - 7);
    ctx.lineTo(hx + 8, hy - 12);
    ctx.lineTo(hx + 8, hy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(hx, hy - 8, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(hx - 5, hy - 6.5, 1.2, 0, Math.PI * 2);
    ctx.arc(hx + 5, hy - 6.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('tophat')) {
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(hx - 7, hy - 18, 14, 12);
    ctx.fillRect(hx - 11, hy - 7, 22, 3);
    ctx.fillStyle = '#6c5ce7';
    ctx.fillRect(hx - 7, hy - 9, 14, 3); // 보라 띠
  }
  if (wearing('bow')) {
    ctx.fillStyle = '#fd79a8';
    ctx.strokeStyle = '#e84393';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, hy - 8);
    ctx.lineTo(hx - 8, hy - 13);
    ctx.lineTo(hx - 8, hy - 3);
    ctx.closePath();
    ctx.moveTo(hx, hy - 8);
    ctx.lineTo(hx + 8, hy - 13);
    ctx.lineTo(hx + 8, hy - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e84393';
    ctx.beginPath();
    ctx.arc(hx, hy - 8, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('headphones')) {
    ctx.strokeStyle = '#e17055';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(hx, hy - 1, 10, Math.PI * 1.05, Math.PI * 1.95); // 머리띠
    ctx.stroke();
    ctx.fillStyle = '#d63031';
    ctx.beginPath();
    ctx.ellipse(hx - 10, hy + 3, 3.4, 4.6, 0.2, 0, Math.PI * 2);
    ctx.ellipse(hx + 10, hy + 3, 3.4, 4.6, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(hx - 11, hy + 2, 1.2, 1.8, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('glasses')) {
    ctx.fillStyle = 'rgba(30,30,40,0.9)';
    ctx.beginPath();
    ctx.arc(hx - 7, hy + 6, 4, 0, Math.PI * 2);
    ctx.arc(hx + 3, hy + 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,40,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy + 6);
    ctx.lineTo(hx - 1, hy + 6);
    ctx.moveTo(hx + 7, hy + 5);
    ctx.lineTo(hx + 13, hy + 3);
    ctx.stroke();
  }
  if (wearing('scarf')) {
    ctx.fillStyle = '#e67e22';
    roundRect(-8, 1, 13, 5, 2.5);
    ctx.fillStyle = '#d35400';
    roundRect(-3, 5, 5, 9, 2.5); // 늘어진 자락
  }
}

// 내장 임시 캐릭터: 동글동글한 초록 캐릭터
function drawDefaultCharacter() {
  const dir = player.facing === 'right' ? 1 : -1;
  // 몸통
  ctx.fillStyle = '#a3d977';
  ctx.strokeStyle = '#6ab04c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, 2, 20, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 발 (점프 자세)
  ctx.fillStyle = '#6ab04c';
  ctx.beginPath();
  ctx.ellipse(-9, 18, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(9, 18, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 눈
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(dir * 6, -4, 6, 0, Math.PI * 2);
  ctx.arc(dir * 14, -4, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(dir * 8, -4, 2.5, 0, Math.PI * 2);
  ctx.arc(dir * 15, -4, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // 코(발사 포즈면 위로 향한 입)
  if (shootPose > 0) {
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.ellipse(dir * 10, -12, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMonster(m) {
  const y = m.y - cameraY + Math.sin(m.wobble) * 3;
  if (m.kind === 'ufo') {
    drawUfo(m, y);
    return;
  }
  ctx.save();
  ctx.translate(m.x, y);

  // 날개 (몸 뒤, 팔랑팔랑 + 잔상 느낌)
  const flap = Math.sin(m.wobble * 3) * 7;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * (m.w / 2 + 2), -4);
    ctx.rotate(side * (0.35 + flap * 0.03));
    const wg = ctx.createLinearGradient(0, -8, 0, 8);
    wg.addColorStop(0, 'rgba(230, 205, 245, 0.95)');
    wg.addColorStop(1, 'rgba(190, 144, 212, 0.8)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.ellipse(side * 6, flap * 0.6, 10, 5.5, side * 0.35, 0, Math.PI * 2);
    ctx.ellipse(side * 9, flap * 0.6 - 6, 7, 4, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 몸통: 방사형 그라데이션
  const bg = ctx.createRadialGradient(-m.w * 0.15, -m.h * 0.2, 3, 0, 0, m.w * 0.62);
  bg.addColorStop(0, '#c99bdf');
  bg.addColorStop(0.6, '#9b59b6');
  bg.addColorStop(1, '#7a3f96');
  ctx.fillStyle = bg;
  ctx.strokeStyle = '#61307d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 배 무늬
  ctx.fillStyle = 'rgba(230, 210, 245, 0.5)';
  ctx.beginPath();
  ctx.ellipse(0, m.h * 0.18, m.w * 0.3, m.h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // 더듬이
  ctx.strokeStyle = '#61307d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -m.h / 2 + 2);
  ctx.quadraticCurveTo(-10, -m.h / 2 - 8, -13, -m.h / 2 - 9);
  ctx.moveTo(6, -m.h / 2 + 2);
  ctx.quadraticCurveTo(10, -m.h / 2 - 8, 13, -m.h / 2 - 9);
  ctx.stroke();
  ctx.fillStyle = '#e67ee6';
  ctx.beginPath();
  ctx.arc(-13, -m.h / 2 - 9, 3, 0, Math.PI * 2);
  ctx.arc(13, -m.h / 2 - 9, 3, 0, Math.PI * 2);
  ctx.fill();

  // 눈: 주기적으로 깜빡임
  const blinkT = (m.wobble * 0.5) % 6;
  const blink = blinkT > 5.75 ? clamp(1 - (blinkT - 5.75) * 8, 0.08, 1) : 1;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 8, -5);
    ctx.scale(1, blink);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(side * 1.2, 1, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(side * 0.2, -0.5, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 입 + 송곳니
  ctx.strokeStyle = '#4a2560';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 4, 6, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-5, 8.2);
  ctx.lineTo(-3.4, 12);
  ctx.lineTo(-1.8, 8.6);
  ctx.moveTo(5, 8.2);
  ctx.lineTo(3.4, 12);
  ctx.lineTo(1.8, 8.6);
  ctx.fill();

  ctx.restore();
}

function drawUfo(m, y) {
  ctx.save();
  ctx.translate(m.x, y);
  // 아래 광선 힌트
  ctx.fillStyle = 'rgba(130, 220, 170, 0.14)';
  ctx.beginPath();
  ctx.moveTo(-10, 6);
  ctx.lineTo(10, 6);
  ctx.lineTo(20, 34);
  ctx.lineTo(-20, 34);
  ctx.fill();
  // 유리 돔
  const domeG = ctx.createLinearGradient(0, -18, 0, 0);
  domeG.addColorStop(0, 'rgba(190, 235, 255, 0.95)');
  domeG.addColorStop(1, 'rgba(120, 180, 220, 0.75)');
  ctx.fillStyle = domeG;
  ctx.beginPath();
  ctx.arc(0, -3, 12, Math.PI, 0);
  ctx.fill();
  // 외계인 눈
  ctx.fillStyle = '#2ecc71';
  ctx.beginPath();
  ctx.ellipse(0, -8, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#145a32';
  ctx.beginPath();
  ctx.ellipse(-2, -9, 1.7, 2.4, 0, 0, Math.PI * 2);
  ctx.ellipse(2, -9, 1.7, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 접시 본체
  const saucerG = ctx.createLinearGradient(0, -6, 0, 10);
  saucerG.addColorStop(0, '#c8d6e5');
  saucerG.addColorStop(0.5, '#8395a7');
  saucerG.addColorStop(1, '#576574');
  ctx.fillStyle = saucerG;
  ctx.beginPath();
  ctx.ellipse(0, 2, m.w / 2, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3d4a56';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // 반짝이는 라이트
  for (let i = -1; i <= 1; i++) {
    const on = Math.floor(m.wobble * 2 + i) % 3 === 0;
    ctx.fillStyle = on ? '#f9ca24' : '#7f6a1e';
    ctx.beginPath();
    ctx.arc(i * 13, 4.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 피격 표시 (HP 1 남음)
  if (m.hp === 1) {
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, -2);
    ctx.lineTo(12, 3);
    ctx.lineTo(8, 6);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.save();
  ctx.scale(scale, scale);
  if (shakeT > 0) {
    ctx.translate(rand(-1, 1) * Math.min(shakeT, 7), rand(-1, 1) * Math.min(shakeT, 7));
  }

  drawBackground();
  drawAmbients();

  // 최고 기록 깃발 라인
  if (best > 0) {
    const lineY = (H * 0.4) - best - cameraY;
    if (lineY > -20 && lineY < H + 20) {
      ctx.save();
      ctx.strokeStyle = 'rgba(231, 76, 60, 0.65)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(W, lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e74c3c';
      ctx.fillText('🚩 최고 기록', W - 10, lineY - 8);
      ctx.restore();
    }
  }

  drawGhost();
  if (!boss) {
    for (const bh of blackholes) drawBlackhole(bh);
    for (const dc of dizzyClouds) drawDizzyCloud(dc);
    for (const cn of cannons) drawCannon(cn);
  }
  for (const p of platforms) drawPlatform(p);
  for (const c of coinsArr) drawCoin(c);
  for (const m of monsters) drawMonster(m);
  drawBoss();

  // 총알: 발광 구슬 + 꼬리
  for (const b of bullets) {
    const by = b.y - cameraY;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 220, 90, 0.35)';
    ctx.beginPath();
    ctx.ellipse(b.x, by + 9, 3, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'rgba(255, 210, 60, 0.9)';
    ctx.shadowBlur = 9;
    const bgrad = ctx.createRadialGradient(b.x - 1, by - 1, 0.5, b.x, by, 5.5);
    bgrad.addColorStop(0, '#fff7cf');
    bgrad.addColorStop(1, '#f5b70d');
    ctx.fillStyle = bgrad;
    ctx.beginPath();
    ctx.arc(b.x, by, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 파티클
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life / 20, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 2, pt.y - cameraY - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawPlayer();
  drawSeason();
  drawWeather();
  drawWindOverlay();

  // 떠오르는 텍스트 (콤보/아슬아슬/튜토리얼)
  for (const f of floatTexts) {
    const fy = f.screen ? f.y : f.y - cameraY;
    ctx.save();
    ctx.globalAlpha = clamp(f.life / 40, 0, 1);
    ctx.font = `900 ${f.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, fy);
    ctx.restore();
  }

  // 조작 반전 상태: 보라 틴트
  if (reversedT > 0 && state === State.PLAYING) {
    ctx.fillStyle = `rgba(155, 89, 182, ${0.10 + 0.05 * Math.sin(frame * 0.3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 카운트다운: 큰 숫자 표시
  if (state === State.COUNTDOWN) {
    const remain = countdownUntil - performance.now();
    const n = Math.max(1, Math.ceil(remain / 1000));
    const frac = (remain % 1000) / 1000; // 1 → 0
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 40);
    ctx.scale(1 + (1 - frac) * 0.4, 1 + (1 - frac) * 0.4);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.font = '900 90px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.4 + frac * 0.6;
    ctx.strokeText(String(n), 0, 0);
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
    ctx.font = '800 22px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('준비하세요!', W / 2, H / 2 + 40);
  }

  // HUD: 점수 / 코인 / 별 / 생명 (사진 모드에선 숨김)
  if (!photoMode && (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN)) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(8, 8, 110, 34, 17);
    roundRect(8, 48, 86, 28, 14);
    roundRect(100, 48, 92, 28, 14);
    ctx.fillStyle = '#2c3e50';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(score), 24, 26);
    if (dailyMode) ctx.fillText('🗓️', 92, 26);
    ctx.font = '800 15px sans-serif';
    ctx.fillStyle = '#b7791f';
    ctx.fillText('🪙 ' + runCoins, 18, 63);
    ctx.fillStyle = '#c78a00';
    ctx.fillText(`⭐ ${starCount}/${starGoalNow()}`, 110, 63);

    // 콤보 표시 (5 이상일 때 오른쪽에)
    if (combo >= 5) {
      const cSize = Math.min(18 + combo * 0.3, 30);
      ctx.save();
      ctx.font = `900 ${cSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.strokeText(`x${combo}`, W - 14, 74);
      ctx.fillStyle = combo >= 20 ? '#e056fd' : combo >= 10 ? '#e67e22' : '#2c3e50';
      ctx.fillText(`x${combo}`, W - 14, 74);
      ctx.restore();
    }

    // 미션 바 (상단 전체 폭)
    if (mission) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      roundRect(8, 84, W - 16, 28, 14);
      ctx.fillStyle = '#6c3fb5';
      ctx.font = '800 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('🎯 ' + mission.def.text, 20, 98);
      ctx.textAlign = 'right';
      ctx.fillText(mission.def.prog(mission.s), W - 20, 98);
      ctx.textAlign = 'left';
    }

    if (lives > 0) {
      ctx.font = '15px sans-serif';
      ctx.fillStyle = '#b7791f';
      ctx.fillText('❤️'.repeat(lives), 10, mission ? 130 : 92);
    }

    // 미션 성공 배너
    if (missionFlash > 0) {
      const t = missionFlash / 140; // 1 → 0
      const pop = 1 + Math.max(0, t - 0.85) * 3;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 3);
      ctx.translate(W / 2, 210);
      ctx.scale(pop, pop);
      ctx.font = '900 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.strokeText(flashMain, 0, 0);
      ctx.fillStyle = '#e67e22';
      ctx.fillText(flashMain, 0, 0);
      ctx.font = '900 20px sans-serif';
      ctx.strokeText(flashSub, 0, 34);
      ctx.fillStyle = '#8e44ad';
      ctx.fillText(flashSub, 0, 34);
      ctx.restore();
    }
  }

  ctx.restore();
}

// ---------- 루프 ----------
// 고정 타임스텝: 화면 주사율(60/90/120Hz)과 무관하게 물리는 항상 초당 60회.
// 120Hz 폰에서 게임이 2배 빨라지던 문제를 해결한다.
const PHYSICS_STEP = 1000 / 60;
let rafId = null;
let lastTime = 0;
let physicsAcc = 0;

function loop(now) {
  if (now === undefined) now = performance.now();
  if (!lastTime) lastTime = now;
  let dt = now - lastTime;
  lastTime = now;
  if (dt > 250) dt = 250; // 탭 전환 복귀 등 긴 공백은 무시

  if (state === State.COUNTDOWN && now >= countdownUntil) {
    state = State.PLAYING;
    physicsAcc = 0;
  }
  if (state === State.PLAYING) {
    physicsAcc += dt;
    let steps = 0;
    while (physicsAcc >= PHYSICS_STEP && steps < 5) { // 한 번에 최대 5스텝 (렉 스파이럴 방지)
      update();
      physicsAcc -= PHYSICS_STEP;
      steps++;
      if (state !== State.PLAYING) break; // 게임오버 등 상태 변화 시 중단
    }
    if (steps === 5) physicsAcc = 0;
  } else {
    physicsAcc = 0;
    // 메뉴에서도 가벼운 연출은 진행
    if (menuHop > 0) menuHop--;
    for (const f of floatTexts) f.life--;
    floatTexts = floatTexts.filter((f) => f.life > 0);
  }
  draw();
  rafId = requestAnimationFrame(loop);
}

// ---------- 화면 전환 / 상점 ----------
const $ = (id) => document.getElementById(id);
const startScreen = $('start-screen');
const overScreen = $('gameover-screen');
const pauseScreen = $('pause-screen');
const shopScreen = $('shop-screen');
const helpScreen = $('help-screen');
const pauseBtn = $('btn-pause');
const fireBtn = $('btn-fire');
function updateFireBtn() {
  if (reloading > 0) {
    fireBtn.innerHTML = `⏳<span class="ammo">${Math.ceil((reloading / RELOAD_TIME) * 100)}%</span>`;
    fireBtn.classList.add('reloading');
  } else {
    fireBtn.innerHTML = `🔫<span class="ammo">${ammo}</span>`;
    fireBtn.classList.remove('reloading');
  }
}
fireBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (state === State.PLAYING) shoot();
}, { passive: false });
fireBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (state === State.PLAYING) shoot();
});

function refreshMenu() {
  $('best-score-label').textContent = best > 0 ? `최고 기록 ${best}` : '';
  $('wallet-label').textContent = `🪙 ${wallet}`;
  refreshControlUI();
}

function refreshControlUI() {
  $('ctrl-touch').classList.toggle('active', controlMode === 'touch');
  $('ctrl-tilt').classList.toggle('active', controlMode === 'tilt');
  $('control-desc').innerHTML = controlMode === 'touch'
    ? '화면 좌/우 터치(또는 ← → 방향키)로 이동<br>🔫 오른쪽 아래 버튼(또는 스페이스바)으로 발사'
    : '핸드폰을 좌우로 기울여 이동<br>🔫 오른쪽 아래 버튼으로 발사';
}

function setControlMode(mode) {
  controlMode = mode;
  localStorage.setItem('jump-control', mode);
  input.tilt = 0;
  refreshControlUI();
}

function refreshShop() {
  $('shop-balance').textContent = String(wallet);
  $('own-life').textContent = String(inv.life);
  $('own-rocket').textContent = String(inv.rocket);
  $('own-magnet').textContent = String(inv.magnet);
  document.querySelectorAll('.btn-buy').forEach((btn) => {
    const item = btn.dataset.item;
    btn.classList.remove('equipped');
    if (COSMETICS.includes(item)) {
      // 꾸미기: 사면 착용/해제 토글로 변경
      if (inv[item]) {
        btn.disabled = false;
        btn.textContent = equip[item] ? '착용 중 ✓' : '착용하기';
        btn.classList.toggle('equipped', equip[item]);
      } else {
        btn.disabled = wallet < PRICES[item];
        btn.textContent = `🪙 ${PRICES[item]}`;
      }
      return;
    }
    btn.disabled = wallet < PRICES[item] || inv[item] >= MAX_OWN[item];
    btn.textContent = inv[item] >= MAX_OWN[item] ? '최대 보유' : `🪙 ${PRICES[item]}`;
  });
}

function wearCosmetic(item, on) {
  if (on) {
    // 같은 슬롯의 다른 아이템은 자동 해제
    const slot = COSMETIC_SLOTS[item];
    for (const k of COSMETICS) {
      if (COSMETIC_SLOTS[k] === slot) equip[k] = false;
    }
  }
  equip[item] = on;
  saveEquip();
}

function buyItem(item) {
  if (COSMETICS.includes(item) && inv[item]) {
    // 이미 보유: 착용 토글
    wearCosmetic(item, !equip[item]);
    sfx.buy();
    refreshShop();
    return;
  }
  if (wallet < PRICES[item] || inv[item] >= MAX_OWN[item]) return;
  wallet -= PRICES[item];
  inv[item]++;
  if (COSMETICS.includes(item)) wearCosmetic(item, true);
  saveWallet();
  saveInv();
  sfx.buy();
  refreshShop();
}

// ---------- 강화 화면 ----------
function renderUpgrades() {
  $('upg-balance').textContent = String(wallet);
  const list = $('upg-list');
  list.innerHTML = '';
  for (const [key, def] of Object.entries(UPGRADES)) {
    const lv = upg[key];
    const maxed = lv >= def.max;
    const cost = maxed ? 0 : def.costs[lv];
    const el = document.createElement('div');
    el.className = 'shop-item';
    el.innerHTML = `
      <div class="shop-info">
        <span class="shop-name">${def.icon} ${def.name} <small>Lv.${lv}</small></span>
        <span class="shop-desc">${def.desc}</span>
        <div class="upg-pips">${Array.from({ length: def.max }, (_, i) => `<span class="upg-pip${i < lv ? ' on' : ''}"></span>`).join('')}</div>
      </div>
      <button class="btn-buy" ${maxed || wallet < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `🪙 ${cost.toLocaleString()}`}</button>`;
    el.querySelector('button').addEventListener('click', () => {
      if (maxed || wallet < cost) return;
      wallet -= cost;
      upg[key]++;
      saveWallet();
      saveUpg();
      sfx.buy();
      renderUpgrades();
    });
    list.appendChild(el);
  }
}

// ---------- 캐릭터 화면 ----------
function renderChars() {
  $('char-balance').textContent = String(wallet);
  const list = $('char-list');
  list.innerHTML = '';
  for (const [id, def] of Object.entries(CHARACTERS)) {
    const owned = ownedChars.has(id);
    const selected = curChar === id;
    const el = document.createElement('div');
    el.className = 'shop-item' + (selected ? ' char-cur' : '');
    el.innerHTML = `
      <img class="char-img" src="assets/character/${def.dir}jump-left.png" alt="">
      <div class="shop-info">
        <span class="shop-name">${def.emoji} ${def.name}</span>
        <span class="shop-desc">${def.desc}</span>
      </div>
      <button class="btn-buy${selected ? ' equipped' : ''}" ${!owned && wallet < def.price ? 'disabled' : ''}>
        ${selected ? '선택됨 ✓' : owned ? '선택' : `🪙 ${def.price.toLocaleString()}`}</button>`;
    el.querySelector('button').addEventListener('click', () => {
      if (!owned) {
        if (wallet < def.price) return;
        wallet -= def.price;
        ownedChars.add(id);
        saveWallet();
      }
      curChar = id;
      saveChars();
      loadCharImages();
      sfx.buy();
      renderChars();
    });
    list.appendChild(el);
  }
}

// ---------- 도전과제 화면 ----------
function renderAchievements() {
  const list = $('ach-list');
  list.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const done = unlockedAch.has(a.id);
    const cur = Math.min(a.get(stats), a.target);
    const el = document.createElement('div');
    el.className = 'ach-item' + (done ? ' done' : '');
    el.innerHTML = `
      <div class="ach-top">
        <span class="ach-name">${done ? '✅ ' : ''}${a.name}</span>
        <span class="ach-reward">🪙 ${a.reward}</span>
      </div>
      <div class="ach-desc">${a.desc}</div>
      <div class="ach-bar"><div style="width:${Math.round((cur / a.target) * 100)}%"></div></div>
      <div class="ach-prog">${cur.toLocaleString()} / ${a.target.toLocaleString()}</div>`;
    list.appendChild(el);
  }
}

// ---------- 기록 공유 ----------
async function shareResult() {
  const c = document.createElement('canvas');
  c.width = 540;
  c.height = 720;
  const sc = c.getContext('2d');
  const g = sc.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, '#87CEEB');
  g.addColorStop(1, '#b0e0c6');
  sc.fillStyle = g;
  sc.fillRect(0, 0, 540, 720);
  sc.fillStyle = 'rgba(255,255,255,0.85)';
  sc.beginPath();
  sc.roundRect(40, 60, 460, 600, 28);
  sc.fill();
  sc.textAlign = 'center';
  sc.fillStyle = '#2c3e50';
  sc.font = '900 52px sans-serif';
  sc.fillText('점프! 점프!', 270, 150);
  if (charImgs.left) sc.drawImage(charImgs.left, 190, 190, 160, 160);
  sc.font = '800 26px sans-serif';
  sc.fillStyle = '#57606f';
  sc.fillText('둥이의 기록', 270, 410);
  sc.font = '900 72px sans-serif';
  sc.fillStyle = '#e67e22';
  sc.fillText(String(score), 270, 490);
  sc.font = '700 22px sans-serif';
  sc.fillStyle = '#8e44ad';
  sc.fillText(`최고 기록 ${best}`, 270, 535);
  sc.font = '700 18px sans-serif';
  sc.fillStyle = '#57606f';
  sc.fillText('jiuk96.github.io/jump-jump', 270, 620);

  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'jump-jump-score.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '점프! 점프!', text: `둥이와 함께 ${score}점 달성! 🐶` });
      return;
    } catch (e) { /* 사용자가 취소하면 다운로드로 대체하지 않음 */ return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jump-jump-score.png';
  a.click();
  URL.revokeObjectURL(a.href);
}

function startGame() {
  // 처음 하는 사람에게는 게임 방법을 먼저 보여줌
  if (!localStorage.getItem('jump-help-seen')) {
    showHelp();
    return;
  }
  beginCountdown();
}

function beginCountdown() {
  if (controlMode === 'tilt') requestTilt(); // iOS 센서 권한은 기울이기 모드에서만 요청
  state = State.COUNTDOWN; // newGame이 아이템을 소비하도록 먼저 상태 변경
  newGame();
  countdownUntil = performance.now() + 3000;
  startScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  shopScreen.classList.add('hidden');
  helpScreen.classList.add('hidden');
  $('ach-screen').classList.add('hidden');
  $('upg-screen').classList.add('hidden');
  $('char-screen').classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  fireBtn.classList.remove('hidden');
  updateFireBtn();
  photoMode = false;
  bgm.start();
  if (tut) addFloat('좌우로 움직여 발판을 밟아요!', W / 2, 190, '#2c3e50', 16, true);
}

function showHelp() {
  startScreen.classList.add('hidden');
  helpScreen.classList.remove('hidden');
}

function pauseGame() {
  if (state !== State.PLAYING) return;
  state = State.PAUSED;
  bgm.stop();
  pauseScreen.classList.remove('hidden');
}

function resumeGame() {
  state = State.PLAYING;
  bgm.start();
  pauseScreen.classList.add('hidden');
}

function gameOver() {
  if (state !== State.PLAYING) return;
  state = State.OVER;
  sfx.die();
  vib(160);
  bgm.stop();
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    localStorage.setItem('jump-best', String(best));
    // 최고 기록 고스트 저장
    try {
      localStorage.setItem('jump-ghost', JSON.stringify({ step: GHOST_STEP, pts: ghostRec }));
    } catch (e) { /* 저장 공간 부족 시 무시 */ }
  }
  if (tut) localStorage.setItem('jump-tut-done', '1');
  stats.runs++;
  stats.totalScore += score;
  if (score > stats.bestScore) stats.bestScore = score;
  if (score >= 14000) stats.space = true;
  saveStats();
  checkAchievements();
  $('final-score').textContent = String(score);
  $('final-coins').textContent = String(runCoins);
  $('final-best').textContent = `최고 기록 ${best}`;
  $('new-record').classList.toggle('hidden', !isRecord);
  overScreen.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
  autoSubmitScore();
}

function goHome() {
  state = State.MENU;
  bgm.stop();
  overScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  helpScreen.classList.add('hidden');
  $('ach-screen').classList.add('hidden');
  $('lb-screen').classList.add('hidden');
  $('upg-screen').classList.add('hidden');
  $('char-screen').classList.add('hidden');
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
  startScreen.classList.remove('hidden');
  refreshMenu();
}

$('btn-start').addEventListener('click', () => { dailyMode = false; startGame(); });
$('btn-daily').addEventListener('click', () => { dailyMode = true; startGame(); });
$('btn-retry').addEventListener('click', beginCountdown);
$('ctrl-touch').addEventListener('click', () => setControlMode('touch'));
$('ctrl-tilt').addEventListener('click', () => setControlMode('tilt'));
$('btn-help').addEventListener('click', showHelp);
$('btn-help-start').addEventListener('click', () => {
  localStorage.setItem('jump-help-seen', '1');
  beginCountdown();
});
$('btn-help-back').addEventListener('click', () => {
  localStorage.setItem('jump-help-seen', '1');
  goHome();
});
$('btn-home').addEventListener('click', goHome);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-quit').addEventListener('click', goHome);
pauseBtn.addEventListener('click', pauseGame);
$('btn-shop').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  refreshShop();
  shopScreen.classList.remove('hidden');
});
$('btn-shop-back').addEventListener('click', () => {
  shopScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  refreshMenu();
});
document.querySelectorAll('.btn-buy').forEach((btn) => {
  btn.addEventListener('click', () => buyItem(btn.dataset.item));
});
$('btn-ach').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  renderAchievements();
  $('ach-screen').classList.remove('hidden');
});
$('btn-ach-back').addEventListener('click', goHome);
$('btn-share').addEventListener('click', shareResult);
$('btn-lb').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  $('lb-screen').classList.remove('hidden');
  renderLeaderboard();
});
$('btn-lb-back').addEventListener('click', () => {
  $('lb-screen').classList.add('hidden');
  startScreen.classList.remove('hidden');
});
$('lb-tab-all').addEventListener('click', () => { lbTab = 'all'; renderLeaderboard(); });
$('lb-tab-week').addEventListener('click', () => { lbTab = 'week'; renderLeaderboard(); });
$('lb-tab-day').addEventListener('click', () => { lbTab = 'day'; renderLeaderboard(); });
$('btn-upg').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  renderUpgrades();
  $('upg-screen').classList.remove('hidden');
});
$('btn-upg-back').addEventListener('click', goHome);
$('btn-char').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  renderChars();
  $('char-screen').classList.remove('hidden');
});
$('btn-char-back').addEventListener('click', goHome);
$('btn-photo').addEventListener('click', () => {
  photoMode = true;
  pauseScreen.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
});
canvas.addEventListener('mousedown', () => {
  if (photoMode) exitPhotoMode();
});
function exitPhotoMode() {
  photoMode = false;
  pauseScreen.classList.remove('hidden');
  pauseBtn.classList.remove('hidden');
  fireBtn.classList.remove('hidden');
}
// 시작 화면 빈 곳을 탭하면 캐릭터가 멍멍! 하고 폴짝
startScreen.addEventListener('click', (e) => {
  if (e.target !== startScreen) return;
  menuHop = 28;
  beep(620, 0.07, 'square', 0.14);
  setTimeout(() => beep(520, 0.09, 'square', 0.14), 90);
  addFloat(curChar === 'cat' ? '야옹! 🐾' : curChar === 'penguin' ? '펭! 🐾' : curChar === 'rabbit' ? '깡총! 🐾' : '멍멍! 🐾', player.x, player.y - cameraY - 46, '#2c3e50', 16, true);
});
$('btn-register').addEventListener('click', () => {
  if (askNickname()) autoSubmitScore();
});

function refreshBgmBtn() {
  $('btn-bgm').textContent = bgm.on ? '🔊 음악 켜짐' : '🔇 음악 꺼짐';
}
$('btn-bgm').addEventListener('click', () => {
  bgm.toggle();
  refreshBgmBtn();
});
refreshBgmBtn();

// 탭 전환 시 자동 일시정지
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === State.PLAYING) pauseGame();
});

// ---------- 시작 ----------
newGame(); // 메뉴 뒤 배경용
refreshMenu();
loop();
