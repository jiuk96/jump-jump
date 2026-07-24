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
  bow: 800, scarf: 1000, hat: 1200, glasses: 1500, headphones: 1800,
  tophat: 2200, crown: 3000, cape: 3500, wings: 5000,
  bowtie: 1400, mustache: 1600, monocle: 1800, heartglasses: 2000,
  partyhat: 2000, bunnyears: 2400, beret: 2600, backpack: 2600,
  pearl: 2800, balloonpack: 3200, propeller: 3600, viking: 4200, halo: 4800,
  trail_bubble: 4500, trail_note: 5000, trail_spark: 5500,
};
const MAX_OWN = { life: 3, rocket: 9, magnet: 9 };
// 꾸미기 아이템은 모두 1개만 (아래에서 일괄 등록)

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

// ⏳ 남은 시간 바 (부스트·무적·파워업) — 우측 상단에 아이콘 + 줄어드는 바
function drawTimerBars(bars, topY, rightX) {
  let y = topY;
  for (const b of bars) {
    if (!(b.frac > 0)) continue;
    const bw = 112;
    const bx = rightX - bw;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    roundRect(bx - 24, y - 9, bw + 28, 18, 9);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.icon, bx - 19, y + 0.5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    roundRect(bx, y - 4.5, bw - 4, 9, 4.5);
    const fw = Math.max(2, (bw - 4) * clamp(b.frac, 0, 1));
    ctx.fillStyle = b.color;
    roundRect(bx, y - 4.5, fw, 9, 4.5);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRect(bx, y - 4.5, fw, 3.5, 1.7);
    ctx.restore();
    y += 22;
  }
}

// 노치(안전 영역) 상단 높이 → 논리 px (기기별 UI 보정)
function safeTopL() {
  const st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
  return st * (W / (canvas.clientWidth || W));
}

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

// ---------- 설정 ----------
let settings = { sfx: true, music: true, vib: true, tilt: 'mid', lefty: false };
// 🔑 운영자(치트) 상태 — 설정 화면 초기화보다 먼저 선언되어야 함
let masterMode = localStorage.getItem('jump-master') === '1';
let opMode = localStorage.getItem('jump-op-mode') === '1'; // 🕹️ 운영자 샌드박스 모드
let cheatGod = false;       // 무적 (세션 한정)
let cheatStartScore = 0;    // 시작 점수 (세션 한정)
try { Object.assign(settings, JSON.parse(localStorage.getItem('jump-settings') || '{}')); } catch (e) {}
function saveSettings() {
  localStorage.setItem('jump-settings', JSON.stringify(settings));
  applySettings();
}
function applySettings() {
  document.getElementById('game-container').classList.toggle('lefty', settings.lefty);
}

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');
let scale = 1;

function resize() {
  // clientWidth/Height는 CSS transform(가로 회전)의 영향을 받지 않는 레이아웃 크기
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
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
  fox: { name: '여울', emoji: '🦊', price: 3000, desc: '기본 자석 +40px', dir: 'fox/' },
  bear: { name: '모카', emoji: '🐻', price: 6000, desc: '보호막 +1회/판', dir: 'bear/' },
  owl: { name: '부기', emoji: '🦉', price: 10000, desc: '활공 — 낙하 속도 -18%', dir: 'owl/' },
  dragon: { name: '드래고', emoji: '🐲', price: 18000, desc: '탄창 +3발', dir: 'dragon/' },
  unicorn: { name: '루나', emoji: '🦄', price: 30000, desc: '스타 파워 지속 +30%', dir: 'unicorn/' },
};
// 기본 4종은 무료, 나머지 5종은 코인으로 해금
const FREE_CHARS = ['dungi', 'rabbit', 'penguin', 'cat'];
let ownedChars = new Set(FREE_CHARS);
try {
  JSON.parse(localStorage.getItem('jump-chars') || '[]').forEach((c) => { if (CHARACTERS[c]) ownedChars.add(c); });
} catch (e) {}
let curChar = localStorage.getItem('jump-char') || 'dungi';
if (!CHARACTERS[curChar] || !ownedChars.has(curChar)) curChar = 'dungi';
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
// 가격: 레벨마다 1.6~2.2배씩 비싸짐 (강화는 긴 여정!)
// perks: 특정 레벨 도달 시 해금되는 특수 능력
const UPGRADES = {
  jump: { name: '점프력', icon: '🦵', desc: '점프 높이 +0.4%/레벨', max: 50, base: 60, growth: 1.13,
    perks: { 10: '✨ 점프력 +3% 보너스 + 반짝이 점프 이펙트!', 30: '🌈 점프력 +3% 보너스 + 무지개 궤적!', 50: '💫 점프력 +4% 보너스 + 별빛 폭발!' } },
  ammo: { name: '총 강화', icon: '🔫', desc: '5레벨마다 탄창 +1발', max: 50, base: 70, growth: 1.13,
    perks: { 15: '🎯 관통탄 — 총알이 몬스터를 뚫음', 35: '💥 더블샷 — 두 발씩 발사' } },
  thunder: { name: '번개', icon: '⚡', desc: '콤보를 쌓으면 낙뢰가 적을 자동 타격 · 5레벨마다 필요 콤보 -1', max: 50, base: 150, growth: 1.14,
    perks: { 1: '⚡ 번개 해금 — 콤보를 쌓으면 낙뢰!', 25: '⚡⚡ 이중 낙뢰!', 50: '🌩️ 삼중 낙뢰!' } },
  shield: { name: '보호막', icon: '🛡️', desc: '피격 방어 버블 · 10레벨마다 방어 +1회', max: 50, base: 200, growth: 1.14,
    perks: { 1: '🛡️ 보호막 해금!' } },
  coinup: { name: '코인 부스터', icon: '💰', desc: '코인 획득량 +1%/레벨', max: 50, base: 55, growth: 1.12,
    perks: { 20: '💎 보석 등장 (+20 코인)', 40: '✨ 골든 터치 — 발판에서 코인이!' } },
  magnet: { name: '기본 자석', icon: '🧲', desc: '자석 없이도 코인 끌어당김 (+2px/레벨)', max: 50, base: 60, growth: 1.12 },
  reload: { name: '빠른 장전', icon: '⏱️', desc: '재장전 시간 -1%/레벨', max: 50, base: 55, growth: 1.12 },
  revive: { name: '질긴 생명', icon: '❤️', desc: '부활 무적 +0.06초/레벨', max: 50, base: 50, growth: 1.12 },
  rocket: { name: '출발 부스트', icon: '🚀', desc: '시작 제트팩 +0.05초/레벨', max: 50, base: 45, growth: 1.12 },
  fireslow: { name: '내열 코팅', icon: '🧯', desc: '불길 속도 -0.8%/레벨', max: 50, base: 55, growth: 1.12 },
  star: { name: '별 수집가', icon: '⭐', desc: '스타 지속 +1%/레벨 · 10레벨마다 필요 별 -1', max: 50, base: 90, growth: 1.13 },
};
let upg = {
  jump: 0, magnet: 0, star: 0, revive: 0, rocket: 0,
  coinup: 0, reload: 0, fireslow: 0, ammo: 0, thunder: 0, shield: 0,
};
try { upg = Object.assign(upg, JSON.parse(localStorage.getItem('jump-upg') || '{}')); } catch (e) {}
// 기존 세이브가 새 max를 넘지 않도록 보정
for (const k of Object.keys(UPGRADES)) upg[k] = Math.min(upg[k] || 0, UPGRADES[k].max);
function saveUpg() { localStorage.setItem('jump-upg', JSON.stringify(upg)); }
function upgCost(k) {
  const d = UPGRADES[k];
  return Math.round(d.base * Math.pow(d.growth, upg[k]) / 10) * 10;
}
function ammoMax() { return AMMO_MAX + Math.floor(upg.ammo / 5) + (curChar === 'dragon' ? 3 : 0); }
function reloadTime() { return Math.round(RELOAD_TIME * (1 - 0.01 * upg.reload)); }
function coinValue() { return 1 + Math.floor(score / 10000); } // 높이 오를수록 코인 가치 상승

// 마일스톤 해금: 강화 레벨이 일정 단계에 도달하면 특수 능력이 열린다
function jumpFxTier() { return upg.jump >= 50 ? 3 : upg.jump >= 30 ? 2 : upg.jump >= 10 ? 1 : 0; } // 점프 이펙트 단계
function hasPierce() { return upg.ammo >= 15; }
function hasDoubleShot() { return upg.ammo >= 35; }
function thunderNeed() { return Math.max(5, 14 - Math.floor(upg.thunder / 5)); }
function thunderBolts() { return upg.thunder >= 50 ? 3 : upg.thunder >= 25 ? 2 : 1; }
function shieldMax() { return (upg.shield > 0 ? Math.ceil(upg.shield / 10) : 0) + (curChar === 'bear' ? 1 : 0); } // 곰: +1회
function hasGems() { return upg.coinup >= 20; }
function hasGoldenTouch() { return upg.coinup >= 40; }

// 강화·캐릭터 효과 적용 헬퍼
function jumpV() {
  // 마일스톤 보너스: Lv10 +3%, Lv30 +3%, Lv50 +4% (레벨당 0.4%와 별도)
  const ms = (upg.jump >= 10 ? 0.03 : 0) + (upg.jump >= 30 ? 0.03 : 0) + (upg.jump >= 50 ? 0.04 : 0);
  return JUMP_VY * (1 + upg.jump * 0.004 + ms + (curChar === 'rabbit' ? 0.10 : 0));
}
function magnetRangeNow() {
  const base = (upg.magnet > 0 ? 28 + upg.magnet * 2 : 0) + (curChar === 'fox' ? 40 : 0); // 여우: 자석 +40px
  return magnetActive ? MAGNET_RANGE : Math.min(150, base);
}
function starGoalNow() { return STAR_GOAL - Math.floor(upg.star / 10); }

// ---------- 사운드 (Web Audio 간단 효과음) ----------
let audioCtx = null;
function tone(freq, dur = 0.08, type = 'square', vol = 0.15) {
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
function beep(freq, dur = 0.08, type = 'square', vol = 0.15) {
  if (!settings.sfx) return;
  tone(freq, dur, type, vol);
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
let inv = { life: 0, rocket: 0, magnet: 0 };
// (꾸미기 슬롯 등록 후 아래 COSMETICS 블록에서 저장값을 병합)

function saveWallet() { localStorage.setItem('jump-coins', String(wallet)); }
function saveInv() { localStorage.setItem('jump-inv', JSON.stringify(inv)); }

// ---------- 누적 통계 & 도전과제 ----------
let stats = {
  runs: 0, totalScore: 0, bestScore: 0, coins: 0, kills: 0,
  missions: 0, stars: 0, maxCombo: 0, revives: 0, space: false, dailyRuns: 0,
  runnerBest: 0, runnerRuns: 0, run2Clear: false, fighterBest: 0, fighterRuns: 0,
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
  { id: 'moon', name: '달 정복자', desc: '달에 착륙하기 (60,000점)', target: 1, get: (s) => (s.moon ? 1 : 0), reward: 500 },
  { id: 'score20k', name: '별바다 항해사', desc: '한 판에 20,000점 달성', target: 20000, get: (s) => s.bestScore, reward: 300 },
  { id: 'score25k', name: '중력을 거부한 자', desc: '한 판에 25,000점 달성', target: 25000, get: (s) => s.bestScore, reward: 400 },
  { id: 'coins2k', name: '알뜰한 저금왕', desc: '코인 누적 2,000개 모으기', target: 2000, get: (s) => s.coins, reward: 300 },
  { id: 'coins5k', name: '코인 재벌', desc: '코인 누적 5,000개 모으기', target: 5000, get: (s) => s.coins, reward: 400 },
  { id: 'coins20k', name: '황금 손', desc: '코인 누적 20,000개 모으기', target: 20000, get: (s) => s.coins, reward: 800 },
  { id: 'kill150', name: '몬스터 킬러', desc: '몬스터 누적 150마리 처치', target: 150, get: (s) => s.kills, reward: 300 },
  { id: 'kill500', name: '몬스터 학살자', desc: '몬스터 누적 500마리 처치', target: 500, get: (s) => s.kills, reward: 500 },
  { id: 'boss10', name: '보스 사냥꾼', desc: '보스 누적 10회 격파', target: 10, get: () => dexN.bossmon || 0, reward: 300 },
  { id: 'boss4kill', name: '어둠을 이긴 자', desc: '암흑 제왕(4번째 보스) 격파', target: 1, get: () => dexN.boss4 || 0, reward: 400 },
  { id: 'mission60', name: '미션 사냥꾼', desc: '미션 60회 완수', target: 60, get: (s) => s.missions, reward: 300 },
  { id: 'mission150', name: '미션의 화신', desc: '미션 150회 완수', target: 150, get: (s) => s.missions, reward: 500 },
  { id: 'star15', name: '별빛 수호자', desc: '스타 파워 15회 발동', target: 15, get: (s) => s.stars, reward: 250 },
  { id: 'star40', name: '별 수집왕', desc: '스타 파워 40회 발동', target: 40, get: (s) => s.stars, reward: 400 },
  { id: 'combo50', name: '콤보 마스터', desc: '한 판에 콤보 50 달성', target: 50, get: (s) => s.maxCombo, reward: 400 },
  { id: 'combo80', name: '리듬의 신', desc: '한 판에 콤보 80 달성', target: 80, get: (s) => s.maxCombo, reward: 600 },
  { id: 'runs150', name: '점프 중독자', desc: '150판 플레이', target: 150, get: (s) => s.runs, reward: 300 },
  { id: 'total500k', name: '하늘길 개척자', desc: '누적 500,000점 오르기', target: 500000, get: (s) => s.totalScore, reward: 400 },
  { id: 'total1m', name: '백만 클라이머', desc: '누적 1,000,000점 오르기', target: 1000000, get: (s) => s.totalScore, reward: 600 },
  { id: 'revive10', name: '오뚝이', desc: '생명으로 10회 부활', target: 10, get: (s) => s.revives, reward: 200 },
  { id: 'daily5', name: '성실한 도전자', desc: '데일리 챌린지 5회 참가', target: 5, get: (s) => s.dailyRuns || 0, reward: 200 },
  { id: 'dex15', name: '탐구자', desc: '도감 15종 완성', target: 15, get: () => dex.size, reward: 300 },
  { id: 'dexall', name: '도감의 지배자', desc: '도감 32종 전부 완성', target: 32, get: () => dex.size, reward: 1000 },
  { id: 'upg50', name: '강화 견습생', desc: '강화 레벨 합계 50 달성', target: 50, get: () => Object.values(upg).reduce((a, b) => a + b, 0), reward: 300 },
  { id: 'upg200', name: '강화의 신', desc: '강화 레벨 합계 200 달성', target: 200, get: () => Object.values(upg).reduce((a, b) => a + b, 0), reward: 800 },
  { id: 'char6', name: '동물 친구들', desc: '캐릭터 6종 보유', target: 6, get: () => ownedChars.size, reward: 300 },
  { id: 'char9', name: '드림팀 감독', desc: '캐릭터 9종 전부 보유', target: 9, get: () => ownedChars.size, reward: 800 },
  { id: 'bolt50', name: '뇌신', desc: '낙뢰로 누적 50마리 처치', target: 50, get: () => dexN.bolt || 0, reward: 400 },
  { id: 'shield20', name: '철벽 수비수', desc: '보호막으로 20회 방어', target: 20, get: () => dexN.shieldhit || 0, reward: 300 },
  { id: 'rps3', name: '가위바위보 달인', desc: '가위바위보 부활전 3회 승리', target: 3, get: () => dexN.rpswin || 0, reward: 200 },
  { id: 'fashion5', name: '패셔니스타', desc: '꾸미기 아이템 5개 보유', target: 5, get: () => COSMETICS.filter((k) => inv[k]).length, reward: 300 },
  { id: 'fashion12', name: '스타일 아이콘', desc: '꾸미기 아이템 12개 보유', target: 12, get: () => COSMETICS.filter((k) => inv[k]).length, reward: 600 },
  { id: 'run500', name: '문 러너 입문', desc: '시리즈2 문 런에서 500m 달리기', target: 500, get: (s) => Math.floor(s.runnerBest || 0), reward: 200 },
  { id: 'run2000', name: '달 위의 폭주족', desc: '시리즈2 문 런에서 2,000m 달리기', target: 2000, get: (s) => Math.floor(s.runnerBest || 0), reward: 500 },
  { id: 'run2clear', name: '우주선 탑승', desc: '문 런 3,000m 지점의 우주선에 탑승 (시리즈2 클리어)', target: 1, get: (s) => (s.run2Clear ? 1 : 0), reward: 400 },
  { id: 'fighter2k', name: '에이스 파일럿', desc: '시리즈3 스타 파이터 2,000점', target: 2000, get: (s) => s.fighterBest || 0, reward: 300 },
  { id: 'fighter5k', name: '은하 수호자', desc: '시리즈3 스타 파이터 5,000점', target: 5000, get: (s) => s.fighterBest || 0, reward: 600 },
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
  partyhat: 'head', beret: 'head', bunnyears: 'head', propeller: 'head', viking: 'head', halo: 'head',
  glasses: 'face', monocle: 'face', heartglasses: 'face', mustache: 'face',
  scarf: 'neck', bowtie: 'neck', pearl: 'neck',
  wings: 'back', cape: 'back', backpack: 'back', balloonpack: 'back',
  trail_spark: 'trail', trail_bubble: 'trail', trail_note: 'trail',
};
const COSMETICS = Object.keys(COSMETIC_SLOTS);
for (const k of COSMETICS) {
  MAX_OWN[k] = 1;
  if (!(k in inv)) inv[k] = 0;
}
try {
  inv = Object.assign(inv, JSON.parse(localStorage.getItem('jump-inv') || '{}'));
} catch (e) { /* 손상된 저장값은 무시 */ }
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

async function submitScore(name, sc, modeStr) {
  const mode = modeStr || (dailyMode ? 'daily' : 'normal');
  const post = (body) => fetch(`${SUPA_URL}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...supaHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  try {
    let res = await post({ name, score: sc, mode, charid: curChar });
    if (!res.ok) res = await post({ name, score: sc, mode }); // charid 컬럼 폴백
    // 문 런·파이터 기록은 mode 없이 올리면 시리즈1 랭킹을 오염시키므로 여기서 중단
    if (!res.ok && mode !== 'runner' && mode !== 'fighter') res = await post({ name, score: sc });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ---------- ☁️ 계정(자동 익명 로그인) & 클라우드 백업 ----------
// 사용자는 로그인 창 없이 자동으로 계정이 만들어지고, 진행 데이터가 서버에 백업된다.
// 문제 발생 시: 운영자가 Supabase 대시보드에서 saves 테이블의 해당 계정(data)을 고치고,
// 사용자는 내 정보 → '서버에서 복원'을 누르면 반영된다.
const CLOUD_KEYS = [
  'jump-best', 'jump-best2', 'jump-coins', 'jump-inv', 'jump-stats', 'jump-ach',
  'jump-equip', 'jump-upg', 'jump-chars', 'jump-char', 'jump-name',
  'jump-dex', 'jump-dexn', 'jump-settings', 'jump-title', 'jump-control',
];
let cloud = { uid: null, at: null, atExp: 0, rt: null, lastHash: '', lastSyncAt: 0, status: 'init', lastErr: '' };
try {
  const a = JSON.parse(localStorage.getItem('jump-auth') || 'null');
  if (a && a.rt && a.uid) { cloud.rt = a.rt; cloud.uid = a.uid; }
} catch (e) {}
function cloudSaveAuth() { localStorage.setItem('jump-auth', JSON.stringify({ rt: cloud.rt, uid: cloud.uid })); }

async function ensureCloudSession() {
  if (cloud.at && Date.now() < cloud.atExp - 30000) return true;
  try {
    if (cloud.rt) { // 저장된 계정으로 재접속
      const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: cloud.rt }),
      });
      if (res.ok) {
        const j = await res.json();
        cloud.at = j.access_token;
        cloud.rt = j.refresh_token || cloud.rt;
        cloud.uid = (j.user && j.user.id) || cloud.uid;
        cloud.atExp = Date.now() + (j.expires_in || 3600) * 1000;
        cloud.status = 'ok';
        cloudSaveAuth();
        return true;
      }
      cloud.rt = null; // 만료된 계정 → 새로 만듦
    }
    const res2 = await fetch(`${SUPA_URL}/auth/v1/signup`, { // 익명 가입 (이메일 불필요)
      method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res2.ok) { // 실패 사유를 화면에서 볼 수 있게 저장
      let why = `HTTP ${res2.status}`;
      try {
        const e2 = await res2.json();
        why = e2.error_code || e2.msg || e2.message || e2.error_description || why;
      } catch (e) {}
      cloud.lastErr = why;
      cloud.status = 'off';
      return false;
    }
    const j2 = await res2.json();
    if (!j2.access_token || !j2.user) { cloud.lastErr = 'no-token'; cloud.status = 'off'; return false; }
    cloud.lastErr = '';
    cloud.at = j2.access_token;
    cloud.rt = j2.refresh_token;
    cloud.uid = j2.user.id;
    cloud.atExp = Date.now() + (j2.expires_in || 3600) * 1000;
    cloud.status = 'ok';
    cloudSaveAuth();
    return true;
  } catch (e) {
    cloud.status = 'err';
    return false;
  }
}

function cloudSnapshot() {
  const keys = {};
  for (const k of CLOUD_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) keys[k] = v;
  }
  return keys;
}

async function cloudSync(force = false) {
  if (opMode) return false; // 🕹️ 운영자 모드: 샌드박스 데이터로 실계정 백업을 덮지 않음
  const keys = cloudSnapshot();
  const hash = JSON.stringify(keys);
  if (!force && hash === cloud.lastHash) return false; // 변경 없으면 전송 안 함
  if (!(await ensureCloudSession())) return false;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/saves?on_conflict=uid`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${cloud.at}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        uid: cloud.uid,
        name: myName || null,
        data: { v: GAME_VERSION, keys },
        updated_at: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      cloud.lastHash = hash;
      cloud.lastSyncAt = Date.now();
      cloud.status = 'ok';
      cloud.lastErr = '';
      return true;
    }
    try {
      const e3 = await res.json();
      cloud.lastErr = e3.code || e3.message || `HTTP ${res.status}`;
    } catch (e) { cloud.lastErr = `HTTP ${res.status}`; }
    cloud.status = 'err';
    return false;
  } catch (e) {
    cloud.status = 'err';
    return false;
  }
}

async function cloudRestore() {
  if (!(await ensureCloudSession())) return { ok: false };
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/saves?uid=eq.${cloud.uid}&select=data,updated_at`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${cloud.at}` },
    });
    if (!res.ok) return { ok: false };
    const rows = await res.json();
    if (!rows.length || !rows[0].data || !rows[0].data.keys) return { ok: false, empty: true };
    for (const [k, v] of Object.entries(rows[0].data.keys)) localStorage.setItem(k, v);
    return { ok: true, at: rows[0].updated_at };
  } catch (e) {
    return { ok: false };
  }
}

// 백업 루프: 접속 2.5초 후 1회 → 이후 30초마다 변경분만, 백그라운드 전환 시에도
setTimeout(() => { ensureCloudSession().then(() => cloudSync(true)); }, 2500);
setInterval(() => { cloudSync(false); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') cloudSync(false);
});

// 최근 상위 기록을 가져와 닉네임별 최고점만 남김
async function fetchScores(tab, series = 1) {
  let dateFilter = '';
  if (tab === 'week') {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    dateFilter = `&created_at=gte.${since}`;
  } else if (tab === 'day') {
    // 오늘의 챌린지: KST 자정 이후
    const now = Date.now() + 9 * 3600 * 1000;
    const k = new Date(now);
    const startUtc = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600 * 1000;
    dateFilter = `&created_at=gte.${new Date(startUtc).toISOString()}`;
  }
  // 시리즈별 분리: 2 = 문 런(runner), 1 = 하늘 점프(normal·daily)
  const modeFilter = series === 2 ? '&mode=eq.runner'
    : series === 3 ? '&mode=eq.fighter'
    : tab === 'day' ? '&mode=eq.daily'
    : '&mode=in.(normal,daily)';
  // 매 판마다 새 행이 쌓이므로, 특정 유저의 최고 기록이 상위 윈도에서 밀려 랭킹이
  // 갱신 안 되는 걸 막기 위해 넉넉히(1000행) 받아서 이름별 최고만 추린다.
  const get = (cols, mf) =>
    fetch(`${SUPA_URL}/rest/v1/scores?select=${cols}&order=score.desc&limit=1000${mf}${dateFilter}`, { headers: supaHeaders });
  let res = await get('name,score,created_at,charid', modeFilter);
  if (!res.ok) res = await get('name,score,created_at', modeFilter); // charid 컬럼 폴백
  if (!res.ok && series === 1) res = await get('name,score,created_at', tab === 'day' ? '&mode=eq.daily' : ''); // 구버전 폴백
  if (!res.ok) throw new Error('fetch failed');
  const rows = await res.json();
  const bestByName = new Map();
  for (const r of rows) {
    if (!bestByName.has(r.name) || bestByName.get(r.name).score < r.score) {
      bestByName.set(r.name, r);
    }
  }
  return [...bestByName.values()].sort((a, b) => b.score - a.score).slice(0, 10); // 톱 10
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

async function autoSubmitScore(sc = score, modeStr) {
  const el = $('lb-status');
  const regBtn = $('btn-register');
  el.textContent = '';
  regBtn.classList.add('hidden');
  if (opMode) { el.textContent = '🕹️ 운영자 모드 — 랭킹에 등록되지 않습니다'; return; }
  if (sc < 100) return; // 너무 낮은 기록은 등록하지 않음
  if (!myName) {
    regBtn.classList.remove('hidden');
    return;
  }
  el.textContent = '🏅 랭킹 등록 중...';
  const ok = await submitScore(myName, sc, modeStr);
  el.textContent = ok ? `🏅 ${myName} — 랭킹에 등록됨!` : '⚠️ 랭킹 등록 실패 (네트워크 확인)';
}

let lbTab = 'all';
let lbSeries = 1; // 1 = 하늘 점프, 2 = 문 런
async function renderLeaderboard() {
  const list = $('lb-list');
  const fmt = (s) => lbSeries === 2 ? `${s.toLocaleString()}m` : s.toLocaleString();
  if (lbSeries !== 1 && lbTab === 'day') lbTab = 'all'; // 데일리는 시리즈1 전용
  $('lb-ser-1').classList.toggle('active', lbSeries === 1);
  $('lb-ser-2').classList.toggle('active', lbSeries === 2);
  $('lb-ser-3').classList.toggle('active', lbSeries === 3);
  $('lb-tab-day').classList.toggle('hidden', lbSeries !== 1);
  $('lb-tab-all').classList.toggle('active', lbTab === 'all');
  $('lb-tab-week').classList.toggle('active', lbTab === 'week');
  $('lb-tab-day').classList.toggle('active', lbTab === 'day');
  const myBest = lbSeries === 2 ? `${best2.toLocaleString()}m` : lbSeries === 3 ? `${best3.toLocaleString()}점` : `${best.toLocaleString()}점`;
  $('lb-my').textContent = myName ? `내 닉네임: ${myName} · 최고 ${myBest}` : '게임오버 화면에서 닉네임을 만들면 랭킹에 올라갑니다';
  list.innerHTML = '<div class="lb-info">불러오는 중...</div>';
  const mySeries = lbSeries; // 렌더 도중 탭 전환 대비
  try {
    const rows = await fetchScores(lbTab, lbSeries);
    if (mySeries !== lbSeries) return; // 이미 다른 시리즈로 넘어감
    if (!rows.length) {
      list.innerHTML = lbSeries === 2
        ? '<div class="lb-info">아직 문 런 기록이 없어요.<br>첫 주인공이 되어보세요!</div>'
        : lbSeries === 3
        ? '<div class="lb-info">아직 스타 파이터 기록이 없어요.<br>첫 주인공이 되어보세요!</div>'
        : '<div class="lb-info">아직 기록이 없어요. 첫 주인공이 되어보세요!</div>';
      return;
    }
    list.innerHTML = '';
    // 🏆 명예의 전당: 1·2·3등 시상대 — 1등이 가운데 제일 높이 선다
    const podium = document.createElement('div');
    podium.className = 'podium';
    const medals3 = { 1: '🥇', 2: '🥈', 3: '🥉' };
    for (const rank of [2, 1, 3]) { // 왼쪽 2등, 가운데 1등, 오른쪽 3등
      const r = rows[rank - 1];
      const col = document.createElement('div');
      col.className = `podium-col p${rank}` +
        (r && r.name === myName ? ' me' : '') + (r ? '' : ' empty');
      if (r) {
        const cdef = CHARACTERS[r.charid] || CHARACTERS.dungi; // 달성 캐릭터 (기록에 없으면 둥이)
        col.innerHTML = `
          ${rank === 1 ? '<div class="podium-crown">👑</div>' : ''}
          <img class="podium-char" src="assets/character/${cdef.dir}jump-left.png" alt="">
          <div class="podium-name"></div>
          <div class="podium-score">${fmt(r.score)}</div>
          <div class="podium-block"><span>${medals3[rank]}</span>${rank}</div>`;
        col.querySelector('.podium-name').textContent = r.name; // XSS 방지: textContent 사용
      } else {
        col.innerHTML = `
          <div class="podium-vacant">?</div>
          <div class="podium-name">도전!</div>
          <div class="podium-score">&nbsp;</div>
          <div class="podium-block"><span>${medals3[rank]}</span>${rank}</div>`;
      }
      podium.appendChild(col);
    }
    list.appendChild(podium);
    // 4~10등 리스트
    rows.slice(3).forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'lb-row' + (r.name === myName ? ' me' : '');
      el.innerHTML = `
        <span class="lb-rank">${i + 4}</span>
        <span class="lb-name"></span>
        <span class="lb-score">${fmt(r.score)}</span>`;
      el.querySelector('.lb-name').textContent = r.name; // XSS 방지: textContent 사용
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = '<div class="lb-info">⚠️ 랭킹을 불러오지 못했어요.<br>인터넷 연결을 확인해주세요.</div>';
  }
}

// ---------- 도감 (누적 달성형 — 목표를 채워야 등록!) ----------
// [이모지, 이름, 목표 횟수, 방법 힌트]
const DEX = {
  plat_normal: ['🟢', '초록 발판', 300, '밟기'], plat_moving: ['🔵', '파란 발판', 50, '밟기'],
  plat_oneshot: ['⚪', '흰 발판', 50, '밟기'], plat_ice: ['🧊', '얼음 발판', 25, '밟기'],
  plat_breaking: ['🟤', '갈색 발판', 15, '부수기'],
  coin: ['🪙', '코인', 400, '모으기'], star: ['⭐', '별', 40, '모으기'], rainbow: ['🌈', '무지개 코인', 25, '모으기'],
  spring: ['🔺', '스프링', 30, '타기'], jetpack: ['🚀', '제트팩', 12, '타기'],
  cannon: ['🎯', '대포', 8, '발사하기'], sstar: ['💫', '별똥별', 5, '잡기'],
  bug: ['👾', '몬스터', 30, '처치'], ufo: ['🛸', 'UFO', 10, '격추'],
  blackhole: ['🕳️', '블랙홀', 15, '만나기'], dizzy: ['😵', '어지럼 구름', 6, '당하기'],
  bossmon: ['👹', '보스', 5, '격파'],
  rain: ['🌧️', '비', 8, '만나기'], snow: ['🌨️', '눈', 8, '만나기'], wind: ['💨', '강풍', 10, '버티기'],
  moon: ['🌕', '달', 1, '착륙'],
  gem: ['💎', '보석', 10, '모으기 (코인 부스터 Lv20)'], bolt: ['🌩️', '낙뢰', 15, '번개 강화로 처치'],
  shieldhit: ['🛡️', '보호막', 10, '피격 방어'],
  gold: ['✨', '골든 터치', 10, '발판에서 코인 (Lv40)'], rpswin: ['✊', '가위바위보', 3, '부활전 승리'],
  fire: ['🌋', '불길', 15, '만나기'], grav: ['🌌', '무중력', 5, '우주 도달'],
  boss2: ['🔥', '화염 대왕', 2, '2번째 보스 격파'], boss3: ['❄️', '얼음 마왕', 2, '3번째 보스 격파'],
  boss4: ['👑', '암흑 제왕', 2, '4번째 보스 격파'], ghost: ['👻', '고스트', 5, '내 기록과 경주'],
};
let dex = new Set(); // 완성된 항목
try { JSON.parse(localStorage.getItem('jump-dex') || '[]').forEach((d) => dex.add(d)); } catch (e) {}
let dexN = {}; // 누적 진행도
try { dexN = JSON.parse(localStorage.getItem('jump-dexn') || '{}') || {}; } catch (e) {}
function dexAdd(id, n = 1) {
  if (!DEX[id] || dex.has(id)) return;
  dexN[id] = (dexN[id] || 0) + n;
  if (dexN[id] >= DEX[id][2]) {
    dex.add(id);
    localStorage.setItem('jump-dex', JSON.stringify([...dex]));
    announce(`📖 도감 완성: ${DEX[id][0]} ${DEX[id][1]}!`, '#16a085', 140);
    sfx.buy();
    vib(60);
  }
  localStorage.setItem('jump-dexn', JSON.stringify(dexN));
}

// ---------- 진동 (숫자 또는 패턴 배열) ----------
function vib(msOrPattern) {
  if (!settings.vib) return;
  try { if (navigator.vibrate) navigator.vibrate(msOrPattern); } catch (e) {}
}

// ---------- 배경음악 (4트랙 칩튠 — 스윙 리듬의 경쾌한 오리지널 루프) ----------
// 멜로디(사각파) + 화음 콤프(사각파) + 워킹 베이스(삼각파) + 드럼(킥·스네어·햇)
const bgm = {
  get on() { return settings.music; },
  timer: null,
  step: 0,
  // ♪ 64스텝(16비트 4마디) C장조 — 통통 튀는 싱커페이션 멜로디
  MEL: [
    523, 0, 659, 784, 880, 784, 0, 659, 698, 0, 587, 0, 784, 0, 659, 523,
    587, 0, 698, 880, 1047, 0, 880, 698, 784, 698, 659, 587, 659, 0, 523, 0,
    659, 659, 0, 784, 880, 0, 1047, 880, 784, 0, 659, 0, 587, 659, 698, 784,
    880, 0, 784, 698, 659, 0, 587, 0, 523, 587, 659, 784, 1047, 0, 523, 0,
  ],
  // 밴드 콤프: 마디별 코드 (오프비트에 두 음 스타카토)
  CHORDS: [[330, 392], [349, 440], [330, 440], [392, 494]], // C · F · Am · G
  // 워킹 베이스: 근음-5도 + 경과음
  BASS: [
    131, 0, 0, 0, 196, 0, 0, 0, 131, 0, 0, 0, 196, 0, 165, 175,
    175, 0, 0, 0, 262, 0, 0, 0, 196, 0, 0, 0, 196, 0, 175, 165,
    220, 0, 0, 0, 165, 0, 0, 0, 175, 0, 0, 0, 220, 0, 196, 175,
    196, 0, 0, 0, 196, 0, 0, 0, 131, 0, 165, 0, 196, 0, 247, 0,
  ],
  // 🛸 스타 파이터: A단조 히로익 드라이브 (32스텝)
  MEL_F: [
    440, 0, 523, 587, 659, 0, 587, 523, 494, 0, 587, 659, 698, 0, 659, 587,
    523, 0, 659, 784, 880, 0, 784, 659, 698, 659, 587, 494, 440, 0, 330, 0,
  ],
  BASS_F: [
    110, 110, 0, 110, 165, 0, 110, 0, 123, 123, 0, 123, 185, 0, 123, 0,
    131, 131, 0, 131, 196, 0, 131, 0, 175, 0, 165, 0, 147, 0, 165, 0,
  ],
  // 🌌 우주 구간: 몽환 멜로디 (기존 유지)
  MEL_SPACE: [
    392, 0, 494, 0, 587, 0, 659, 0, 587, 0, 494, 0, 440, 0, 494, 0,
    392, 0, 494, 0, 659, 0, 784, 0, 659, 0, 587, 0, 494, 0, 440, 0,
  ],
  playStep(i) {
    // 우주(13,500점~) 몽환 모드
    if (!runnerMode && !fighterMode && state === State.PLAYING && score > 13500) {
      if (i % 2) return;
      const sm = this.MEL_SPACE[(i >> 1) % 32];
      if (sm) {
        tone(sm, 0.5, 'triangle', 0.09);
        tone(sm * 1.5, 0.5, 'sine', 0.03);
      }
      return;
    }
    if (fighterMode) { // 히로익 드라이브
      const m = this.MEL_F[i % 32];
      const b = this.BASS_F[i % 32];
      if (m) {
        tone(m, 0.13, 'square', 0.07);
        tone(m * 2, 0.13, 'square', 0.02);
      }
      if (b) tone(b, 0.14, 'triangle', 0.13);
      if (i % 8 === 0) tone(72, 0.09, 'sine', 0.22);            // 킥
      else if (i % 8 === 4) { tone(210, 0.05, 'square', 0.05); tone(3400, 0.03, 'square', 0.028); } // 스네어
      if (i % 2 === 1) tone(6200, 0.016, 'square', 0.014);       // 햇
      return;
    }
    // 경쾌 스윙 (시리즈1·문 런 — 문 런은 2도 올려 더 신나게)
    const tr = runnerMode ? 1.122 : 1;
    const m = this.MEL[i % 64];
    const b = this.BASS[i % 64];
    if (m) {
      tone(m * tr, 0.14, 'square', 0.075);
      tone(m * tr * 2, 0.14, 'square', 0.016); // 옥타브 더블
    }
    // 오프비트 코드 콤프 (움-빠! 밴드 느낌)
    if (i % 4 === 2) {
      const ch = this.CHORDS[Math.floor((i % 64) / 16)];
      tone(ch[0] * tr, 0.09, 'square', 0.032);
      tone(ch[1] * tr, 0.09, 'square', 0.032);
    }
    if (b) tone(b * tr, 0.22, 'triangle', 0.12);
    if (i % 8 === 0) tone(76, 0.08, 'sine', 0.2);                // 킥
    else if (i % 8 === 4) { tone(220, 0.045, 'square', 0.045); tone(3600, 0.028, 'square', 0.024); } // 스네어
    if (i % 2 === 1) tone(6400, 0.015, 'square', 0.013);          // 햇
  },
  start() {
    if (!this.on || this.timer) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { return; }
    this.timer = setInterval(() => {
      const i = this.step++;
      if (i % 2 === 1) { // 🎷 스윙: 뒷박을 살짝 늦게
        setTimeout(() => { if (this.timer) this.playStep(i); }, 40);
      } else {
        this.playStep(i);
      }
    }, 124);
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  toggle() {
    settings.music = !settings.music;
    saveSettings();
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
      if (boss) return; // 보스전 중엔 타이머 정지
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
  if (boss) {
    flashSub = '🛡️ 무적 보너스!'; // 보스전 중엔 비행 대신 무적
  } else {
    jetpackTimer = Math.max(jetpackTimer, 0) + BONUS_JETPACK;
    jetpackSlow = false;
  }
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
  if (boss) {
    flashSub = '🛡️ 무적!';
  } else {
    flashSub = '무적 비행!';
    jetpackTimer = Math.max(jetpackTimer, 0) + Math.round(STAR_FLIGHT * (1 + 0.01 * upg.star) * (curChar === 'unicorn' ? 1.3 : 1));
    jetpackSlow = false;
  }
  invincible = Math.max(invincible, Math.round(STAR_FLIGHT * (1 + 0.01 * upg.star) * (curChar === 'unicorn' ? 1.3 : 1)) + 60);
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
      dexAdd(type);
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
const State = { MENU: 0, PLAYING: 1, PAUSED: 2, OVER: 3, COUNTDOWN: 4, RPS: 5, ENDING: 6 };
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
let rpsUsed;           // 가위바위보 부활 기회 (판당 1회)
let milestoneIdx;      // 구간 이정표 진행
let endingStarted;     // 달 착륙 엔딩
let endingT = 0;
let cleared = false;   // 이번 판 클리어 여부
let dying = 0;         // 죽음 슬로모션 프레임
let deathSpin = 0;
let landSquash = 0;    // 착지 스쿼시 연출 프레임
let jetpackMaxT = 0;   // 부스트 바 최대치
let invMaxT = 0;       // 무적 바 최대치
let runMaxCombo, runKills, runBosses, runStars; // 이번 판 통계
let thunderCombo;      // 번개 충전 콤보 (번개 강화)
let shieldCharges;     // 남은 보호막 (보호막 강화)
let boltFx;            // 낙뢰 연출 [{x,y,life,seed}]
let trailFx;           // 발자국 꾸미기 연출 [{x,y,life,kind,ph}]
let fireY;             // 아래에서 올라오는 불길 (월드 y)
let fireOn;            // 불길 활성화 여부
let fireAnnounced;

const MILESTONES = [
  [3500, '☁️ 구름을 지나 하늘 높이!'],
  [8500, '🌤️ 성층권 진입!'],
  [13500, '🌌 우주 도달! 무중력 구간!'],
  [22000, '🪐 별들의 바다!'],
  [30000, '🌠 은하수 횡단 중!'],
  [40000, '🛰️ 달 궤도 진입!'],
  [50000, '☄️ 혜성과 나란히!'],
  [56000, '🌕 달이 보인다!'],
];
const MOON_SCORE = 60000;
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

function addFloat(text, x, y, color = '#e67e22', size = 16, screen = false, life = 110) {
  floatTexts.push({ text, x, y, color, size, life, screen });
}

// 화면 중앙 안내는 큐로 관리 — 한 번에 하나씩, 겹치지 않게
let msgQueue = [];
let curMsg = null;
function announce(text, color = '#2c3e50', dur = 130) {
  if ((curMsg && curMsg.text === text) || msgQueue.some((m) => m.text === text)) return; // 중복 방지
  if (msgQueue.length >= 4) return; // 너무 쌓이면 버림
  msgQueue.push({ text, color, dur });
}
function tickAnnounce() {
  if (!curMsg && msgQueue.length && missionFlash <= 0) {
    curMsg = msgQueue.shift();
    curMsg.t = 0;
  }
  if (curMsg) {
    curMsg.t++;
    if (curMsg.t > curMsg.dur) curMsg = null;
  }
}
function drawAnnounce() {
  if (!curMsg) return;
  const AW = (runnerMode && R && R.vw) ? R.vw : W; // 러너 가로 화면 폭
  const { text, color, t, dur } = curMsg;
  const fadeIn = clamp(t / 12, 0, 1);
  const fadeOut = clamp((dur - t) / 18, 0, 1);
  const a = Math.min(fadeIn, fadeOut);
  const slide = (1 - fadeIn) * -12;
  ctx.save();
  ctx.globalAlpha = a;
  // 긴 문구 짤림 방지: 글씨 자동 축소 → 그래도 길면 두 줄로 나눔
  let fs = 15;
  ctx.font = `800 ${fs}px sans-serif`;
  let lines = [text];
  const maxTw = AW - 52; // 알약 안쪽 최대 폭
  const rawTw = ctx.measureText(text).width;
  if (rawTw > maxTw) {
    if ((15 * maxTw) / rawTw >= 11) {
      fs = Math.floor((15 * maxTw) / rawTw);
    } else {
      // 두 줄: 가운데에서 가장 가까운 공백에서 자름
      const mid = Math.floor(text.length / 2);
      let cut = -1;
      for (let o = 0; o <= mid; o++) {
        if (text[mid - o] === ' ') { cut = mid - o; break; }
        if (text[mid + o] === ' ') { cut = mid + o; break; }
      }
      if (cut > 0) {
        lines = [text.slice(0, cut), text.slice(cut + 1)];
        fs = 13;
      } else {
        fs = 11;
      }
    }
    ctx.font = `800 ${fs}px sans-serif`;
    let tw2 = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (tw2 > maxTw) { // 여전히 넘치면 한 번 더 축소
      fs = Math.max(9, Math.floor((fs * maxTw) / tw2));
      ctx.font = `800 ${fs}px sans-serif`;
    }
  }
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const pw = Math.min(tw + 36, AW - 16);
  const ph = lines.length > 1 ? 48 : 34;
  const py = 152 + slide;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(AW / 2 - pw / 2, py, pw, ph, 17);
  ctx.fillStyle = color;
  // 가운데 정렬을 좌표로 직접 계산 — 일부 iOS 웹킷의 textAlign 어긋남까지 원천 차단
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.textBaseline = 'middle';
  const drawCentered = (line, yy) => {
    const lw = ctx.measureText(line).width;
    ctx.fillText(line, AW / 2 - lw / 2, yy);
  };
  if (lines.length > 1) {
    drawCentered(lines[0], py + 15);
    drawCentered(lines[1], py + 33);
  } else {
    drawCentered(text, py + 17.5);
  }
  ctx.restore();
}

// ---------- 입력 ----------
const input = { left: false, right: false, tilt: 0 };

// 조작 방법: 'touch'(터치·방향키) 또는 'tilt'(기울이기)
let controlMode = localStorage.getItem('jump-control') || 'touch';

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') input.left = true;
  if (e.code === 'ArrowRight') input.right = true;
  if (e.code === 'ArrowUp') {
    e.preventDefault();
    if (state === State.PLAYING && runnerMode) runnerJump();
  }
  if (e.code === 'ArrowDown' && runnerMode) {
    e.preventDefault();
    if (R) R.slideHeld = true;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === State.PLAYING) { if (runnerMode) runnerJump(); else shoot(); }
  }
  if (e.code === 'Escape' && state === State.PLAYING) pauseGame();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft') input.left = false;
  if (e.code === 'ArrowRight') input.right = false;
  if (e.code === 'ArrowDown' && R) R.slideHeld = false;
});

// 터치: [터치 모드] 좌/우 절반 이동, 위쪽 탭 발사 / [기울이기 모드] 아무 곳이나 탭 → 발사
let touchSide = null;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (photoMode) { exitPhotoMode(); return; }
  if (state !== State.PLAYING) return;
  if (fighterMode && F) { // 스타 파이터: 터치한 x를 향해 이동
    const rectF = canvas.getBoundingClientRect();
    F.tx = clamp(((e.changedTouches[0].clientX - rectF.left) / rectF.width) * W, 20, W - 20);
    return;
  }
  if (runnerMode) { // 문 런: (가로 기준) 왼쪽 탭 = 슬라이드, 오른쪽 탭 = 점프
    const rect0 = canvas.getBoundingClientRect();
    const t0 = e.changedTouches[0];
    const rotated = document.getElementById('game-container').classList.contains('landscape');
    // CSS 회전 상태에선 화면 세로축이 실제 가로 방향 (아래쪽 절반 = 왼손)
    const slideSide = rotated
      ? (t0.clientY - rect0.top) > rect0.height / 2
      : (t0.clientX - rect0.left) < rect0.width / 2;
    if (slideSide) R.slideHeld = true;
    else runnerJump();
    return;
  }
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
canvas.addEventListener('touchmove', (e) => {
  if (!fighterMode || !F || state !== State.PLAYING) return;
  e.preventDefault();
  const rectF = canvas.getBoundingClientRect();
  F.tx = clamp(((e.changedTouches[0].clientX - rectF.left) / rectF.width) * W, 20, W - 20);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  touchSide = null;
  input.left = false;
  input.right = false;
  if (R) R.slideHeld = false;
}, { passive: false });

// 기울기 (모바일) — 기울이기 모드에서만 반영
// 감도를 낮추고(-25°에서 최대) 목표값을 부드럽게 따라가 급격한 움직임 방지
let tiltTarget = 0;
window.addEventListener('deviceorientation', (e) => {
  if (controlMode !== 'tilt') { tiltTarget = 0; input.tilt = 0; return; }
  const div = { low: 34, mid: 25, high: 18 }[settings.tilt] || 25;
  if (e.gamma != null) tiltTarget = clamp(e.gamma / div, -1, 1);
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
  if (ghostPts && state === State.COUNTDOWN) dexAdd('ghost'); // 내 기록과 경주

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
  nextBossAt = 6000;
  standPlat = null;
  ammo = ammoMax();
  reloading = 0;
  jetpackSlow = false;
  rpsUsed = false;
  milestoneIdx = 0;
  endingStarted = false;
  endingT = 0;
  cleared = false;
  dying = 0;
  deathSpin = 0;
  runMaxCombo = 0;
  runKills = 0;
  runBosses = 0;
  runStars = 0;
  msgQueue = [];
  curMsg = null;
  fireY = H + 420;
  fireOn = false;
  fireAnnounced = false;
  thunderCombo = 0;
  shieldCharges = shieldMax();
  boltFx = [];
  trailFx = [];

  // 들고 들어가는 아이템: 판당 1개씩만 사용 (생명도 한 판에 1번!)
  lives = Math.min(inv.life, 1);
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
      jetpackTimer = Math.max(jetpackTimer, upg.rocket * 3); // 출발 부스트 강화
      jetpackSlow = true;
    }
  }

  // 🛠️ 운영자: 시작 점수 지정 (보스·이정표는 그 지점 이후부터)
  if (masterMode && cheatStartScore > 0 && state === State.COUNTDOWN) {
    score = cheatStartScore;
    nextBossAt = Math.floor(score / 6000) * 6000 + 6000;
    while (milestoneIdx < MILESTONES.length && MILESTONES[milestoneIdx][0] <= score) milestoneIdx++;
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
      announce('👾 몬스터 등장! 🔫 버튼으로 총 발사!', '#c0392b', 180);
    }
    const isUfo = score > 7000 && wr() < 0.35;
    monsters.push({
      x: wrand(30, W - 30), y: y - 40,
      w: isUfo ? 42 : 32, h: isUfo ? 30 : 27,
      vx: wrand(0.5, 1.2 + d * 0.8) * (wr() < 0.5 ? -1 : 1),
      dead: false,
      wobble: wr() * Math.PI * 2,
      kind: isUfo ? 'ufo' : 'bug',
      hp: isUfo ? 2 : 1,
      baseY: y - 40,
    });
  }

  // 블랙홀: 6000점부터 드물게 — 발판에서 멀리 떨어진 곳에만 생성
  if (score > 6000 && wr() < 0.010 + d * 0.012) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const bx = wrand(45, W - 45);
      const by = y - wrand(50, 100);
      const tooClose = platforms.some((p) => {
        if (Math.abs(p.y - by) > 85) return false;
        const nearX = clamp(bx, p.x, p.x + p.w); // 발판에서 가장 가까운 점
        return Math.hypot(bx - nearX, by - p.y) < 70;
      });
      if (!tooClose) {
        blackholes.push({ x: bx, y: by, r: 24, spin: 0 });
        dexAdd('blackhole');
        break;
      }
    }
  }

  // 어지러움 구름: 5000점부터 드물게 (통과하면 잠시 조작 반전)
  if (score > 5000 && wr() < 0.012 + d * 0.012) {
    dizzyClouds.push({ x: wrand(50, W - 50), y: y - wrand(30, 70), w: 74, h: 36, used: false });
  }

  // 대포: 1200점부터 드물게 (떨어져서 들어가면 조준 발사!)
  if (score > 1200 && wr() < 0.009 + d * 0.008) {
    cannons.push({ x: wrand(45, W - 45), y: y - wrand(20, 50), ang: 0, osc: wrand(0, Math.PI * 2), fired: false, timer: 0 });
  }

  // 새로 생긴 발판이 기존 블랙홀과 가까우면 블랙홀을 밀어내거나 제거
  for (let i = blackholes.length - 1; i >= 0; i--) {
    const bh = blackholes[i];
    const near = (bx) => platforms.some((p) => {
      if (Math.abs(p.y - bh.y) > 85) return false;
      const nx = clamp(bx, p.x, p.x + p.w);
      return Math.hypot(bx - nx, bh.y - p.y) < 70;
    });
    if (!near(bh.x)) continue;
    const cands = [wrand(45, W - 45), wrand(45, W - 45), 45, W - 45];
    const ok = cands.find((cx) => !near(cx));
    if (ok !== undefined) bh.x = ok;
    else blackholes.splice(i, 1);
  }

  highestPlatY = y;
}

// ---------- 점프 이펙트 (점프력 마일스톤): 뛸 때마다 화려하게! ----------
function addJumpFx() {
  const t = jumpFxTier();
  if (t === 0) return;
  // Lv10+: 반짝이 입자
  for (let i = 0; i < 4 + t * 2; i++) {
    particles.push({
      x: player.x + rand(-15, 15), y: player.y + player.h / 2,
      vx: rand(-1.7, 1.7), vy: rand(-0.6, 1.3),
      life: rand(14, 26),
      color: t >= 2 ? `hsl(${Math.floor(rand(0, 360))}, 90%, 65%)` : '#ffd832',
    });
  }
  if (t >= 3) addBurst(player.x, player.y + 8, '#e056fd'); // Lv50: 별빛 폭발
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
  const mkB = (bx) => bullets.push({ x: bx, y: player.y - player.h / 2, vy: BULLET_VY, pierce: hasPierce() });
  if (hasDoubleShot()) { mkB(player.x - 8); mkB(player.x + 8); } // 💥 더블샷 (총 강화 Lv35)
  else mkB(player.x);
  shootPose = 20;
  sfx.shoot();
  missionEvent('Shoot');
  if (ammo <= 0) startReload(); // 다 쓰면 자동 재장전
  updateFireBtn();
}

function startReload() {
  if (reloading > 0) return;
  reloading = reloadTime();
  beep(300, 0.08, 'triangle', 0.12);
  setTimeout(() => beep(420, 0.08, 'triangle', 0.12), 160);
  updateFireBtn();
}

// ---------- 보스 얼굴/패턴 (티어가 오르면 진화!) ----------
const BOSS_FACES = [
  null,
  { name: '젤리킹', c1: '#a06bc4', c2: '#6c3483', c3: '#4a235a', line: '#341c42', eye: '#ffdd59', deco: 'horns',
    patterns: ['aimed', 'spread3', 'sides'] },
  { name: '화염 대왕', c1: '#ff8a70', c2: '#c0392b', c3: '#7b241c', line: '#5a1710', eye: '#ffe66d', deco: 'flames',
    patterns: ['aimed', 'spread3', 'wall', 'sides'] },
  { name: '얼음 마왕', c1: '#8ee3f5', c2: '#3498db', c3: '#1b4f72', line: '#123a55', eye: '#eafffd', deco: 'ice',
    patterns: ['aimed', 'spread5', 'zigzag', 'wall'] },
  { name: '암흑 제왕', c1: '#8d7bb2', c2: '#4a3f66', c3: '#1e1930', line: '#0f0c1a', eye: '#ffd700', deco: 'crown',
    patterns: ['aimed2', 'spread5', 'zigzag', 'wall', 'homing'] },
];

function fireBossPattern(kind) {
  const spd = 3.1 + boss.tier * 0.25;
  const mk = (x, vx, vy, extra = {}) => bossShots.push({ x, y: boss.y + 28, vx, vy, kind, ...extra });
  if (kind === 'aimed') {
    mk(boss.x, clamp((player.x - boss.x) / 65, -2.2, 2.2), spd);
  } else if (kind === 'aimed2') {
    // 조준 2연발 (두 번째는 반 박자 뒤)
    mk(boss.x, clamp((player.x - boss.x) / 65, -2.2, 2.2), spd);
    setTimeout(() => {
      if (boss) mk(boss.x, clamp((player.x - boss.x) / 60, -2.4, 2.4), spd * 1.05);
    }, 260);
  } else if (kind === 'spread3') {
    for (const vx of [-1.7, 0, 1.7]) mk(boss.x, vx, spd * 0.95);
  } else if (kind === 'spread5') {
    for (const vx of [-2.4, -1.2, 0, 1.2, 2.4]) mk(boss.x, vx, spd * 0.9);
  } else if (kind === 'sides') {
    mk(boss.x - 34, 0, spd);
    mk(boss.x + 34, 0, spd);
  } else if (kind === 'wall') {
    // 벽 탄막: 한 칸 틈으로 피하세요!
    const slots = 7;
    const gap = Math.floor(Math.random() * slots);
    for (let i = 0; i < slots; i++) {
      if (i === gap || i === (gap + 1) % slots) continue;
      const wx = 26 + (W - 52) * (i / (slots - 1));
      bossShots.push({ x: wx, y: boss.y + 24, vx: 0, vy: spd * 0.82, kind });
    }
  } else if (kind === 'zigzag') {
    mk(boss.x - 22, 0, spd * 0.85, { sway: Math.random() * Math.PI * 2 });
    mk(boss.x + 22, 0, spd * 0.85, { sway: Math.random() * Math.PI * 2 });
  } else if (kind === 'homing') {
    mk(boss.x, 0, spd * 0.7, { homing: true, hlife: 110 });
  }
}

// ---------- 보스 아레나 종료 ----------
function endBossArena() {
  boss = null;
  bossShots = [];
  bullets = []; // 남은 총알 제거 — 복귀 비행 때 카메라가 추월해 '되돌아오는' 것처럼 보임
  standPlat = null;
  for (const p of platforms) {
    if (p.arena) addBurst(p.x + p.w / 2, p.y, '#f6e58d');
  }
  platforms = platforms.filter((p) => !p.arena);

  // 전투 종료 보상: 3초 제트팩 비행 + 무적으로 안전하게 복귀
  jetpackTimer = 180;
  jetpackSlow = false;
  invincible = Math.max(invincible, 260);
  addFloat('🚀 복귀 비행!', player.x, player.y - 44, '#e67e22', 15);
}

// ---------- 보스 격파 공통 처리 (총알·번개 공용) ----------
function bossDefeated() {
  const reward = 20 + boss.tier * 10;
  runCoins += reward;
  wallet += reward;
  stats.coins += reward;
  saveWallet();
  score += 300; // 격파 보너스 점수
  runBosses++;
  dexAdd('bossmon');
  if (boss.face >= 2) dexAdd('boss' + boss.face); // 진화 보스 도감
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

// ---------- 번개 (번개 강화): 콤보가 차면 낙뢰가 적을 자동 타격 ----------
function fireThunder() {
  const targets = monsters.filter((m) => !m.dead && m.y > cameraY - 10 && m.y < cameraY + H);
  targets.sort((a, b) => Math.abs(a.y - player.y) - Math.abs(b.y - player.y));
  if (boss) targets.unshift(boss);
  if (!targets.length) return 0;
  const n = Math.min(thunderBolts(), targets.length);
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    boltFx.push({ x: t.x, y: t.y, life: 16, seed: Math.floor(Math.random() * 233280) });
    addBurst(t.x, t.y, '#ffe66d');
    sfx.hit();
    if (t === boss) {
      boss.hp--;
      if (boss.hp <= 0) { bossDefeated(); break; }
    } else {
      t.dead = true;
      missionEvent('Kill');
      stats.kills++;
      runKills++;
      dexAdd(t.kind);
      dexAdd('bolt');
    }
  }
  saveStats();
  checkAchievements();
  shakeT = Math.max(shakeT, 8);
  beep(1300, 0.14, 'sawtooth', 0.15);
  vib(50);
  return n;
}

// ---------- 보호막 (보호막 강화): 몬스터·보스탄·블랙홀 피격을 1회 방어 ----------
function shieldBlock() {
  if (shieldCharges <= 0) return false;
  shieldCharges--;
  invincible = Math.max(invincible, 60);
  dexAdd('shieldhit');
  addBurst(player.x, player.y, '#74b9ff');
  addFloat(shieldCharges > 0 ? `🛡️ 보호막! (${shieldCharges}회 남음)` : '🛡️ 보호막 소진!',
    player.x, player.y - 42, '#3f8efc', 14);
  beep(900, 0.12, 'triangle', 0.14);
  vib(40);
  return true;
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
    invincible = REVIVE_INVINCIBLE + Math.round(upg.revive * 3.6);
    jetpackTimer = 0;
    combo = 0;
    shakeT = 14;
    fireY = cameraY + H + 360;
    sfx.revive();
    vib(120);
    addFloat('🐱 고양이 목숨! 한 번 더!', player.x, cameraY + H - 60, '#e67e22', 16);
    addBurst(player.x, player.y, '#f7b05c');
    return true;
  }
  if (lives > 0) {
    lives--;
    inv.life = Math.max(0, inv.life - 1); // 보유분에서 1개만 차감
    saveInv();
    // 화면 아래에서 크게 튀어오르며 부활 + 잠시 무적
    player.x = clamp(player.x, 30, W - 30);
    player.y = cameraY + H - 4;
    player.vy = SPRING_VY * 1.2;
    player.vx = 0;
    invincible = REVIVE_INVINCIBLE + Math.round(upg.revive * 3.6);
    jetpackTimer = 0;
    combo = 0;
    shakeT = 14;
    fireY = cameraY + H + 360;
    sfx.revive();
    vib(120);
    addBurst(player.x, player.y, '#e74c3c');
    stats.revives++;
    saveStats();
    checkAchievements();
    return true;
  }
  // 죽음 슬로모션 → 가위바위보(1회) 또는 게임오버
  if (dying <= 0) {
    dying = 46;
    deathSpin = 0;
    shakeT = Math.max(shakeT, 10);
    sfx.die();
    vib(120);
  }
  return false;
}

// ---------- 가위바위보 부활 ----------
const RPS_HANDS = ['✊', '✋', '✌️'];
let rpsBusy = false;

function openRps() {
  rpsUsed = true;
  rpsBusy = false;
  state = State.RPS;
  $('rps-result').textContent = '무엇을 낼까요?';
  document.querySelectorAll('.rps-btn').forEach((b) => { b.disabled = false; });
  $('rps-screen').classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
  showMoveBtns(false);
  beep(440, 0.15, 'square', 0.12);
  vib(60);
}

function playRps(mine) {
  if (rpsBusy || state !== State.RPS) return;
  rpsBusy = true;
  document.querySelectorAll('.rps-btn').forEach((b) => { b.disabled = true; });
  const comp = Math.floor(Math.random() * 3);
  const resultEl = $('rps-result');
  resultEl.textContent = `나 ${RPS_HANDS[mine]}  vs  👾 ${RPS_HANDS[comp]}`;
  const win = (mine - comp + 3) % 3 === 1;
  const draw = mine === comp;
  setTimeout(() => {
    if (draw) {
      resultEl.textContent = `나 ${RPS_HANDS[mine]} vs 👾 ${RPS_HANDS[comp]} — 비겼다! 한 번 더!`;
      document.querySelectorAll('.rps-btn').forEach((b) => { b.disabled = false; });
      rpsBusy = false;
      beep(500, 0.1, 'square', 0.1);
      return;
    }
    if (win) {
      resultEl.textContent = `나 ${RPS_HANDS[mine]} vs 👾 ${RPS_HANDS[comp]} — 이겼다! 🎉`;
      sfx.bonus();
      vib([80, 60, 120]);
      setTimeout(() => {
        $('rps-screen').classList.add('hidden');
        pauseBtn.classList.remove('hidden');
        fireBtn.classList.remove('hidden');
        showMoveBtns(true);
        state = State.PLAYING;
        player.x = clamp(player.x, 30, W - 30);
        player.y = cameraY + H - 4;
        player.vy = SPRING_VY * 1.2;
        player.vx = 0;
        invincible = REVIVE_INVINCIBLE + Math.round(upg.revive * 3.6);
        jetpackTimer = 0;
        combo = 0;
        standPlat = null;
        fireY = cameraY + H + 360;
        sfx.revive();
        dexAdd('rpswin');
        addBurst(player.x, cameraY + H - 30, '#f6e58d');
        announce('✊✋✌️ 가위바위보 승리! 한 목숨 더! 🎉', '#e67e22');
      }, 900);
    } else {
      resultEl.textContent = `나 ${RPS_HANDS[mine]} vs 👾 ${RPS_HANDS[comp]} — 졌다... 😢`;
      sfx.die();
      setTimeout(() => {
        $('rps-screen').classList.add('hidden');
        gameOver();
      }, 1000);
    }
  }, 550);
}

// ---------- 업데이트 ----------
function update() {
  frame++;
  if (cheatGod && invincible < 30) invincible = 30; // 🛠️ 운영자 무적
  // 🚀 부스터(시작 로켓·미션 제트팩·스타 파워·복귀 비행) 중엔 무적 — 보호막도 소모되지 않음
  if (jetpackTimer > 0 && invincible < 2) invincible = 2;
  // ⏳ 남은 시간 바 최대치 추적
  if (jetpackTimer > jetpackMaxT) jetpackMaxT = jetpackTimer;
  if (jetpackTimer <= 0) jetpackMaxT = 0;
  if (invincible > invMaxT) invMaxT = invincible;
  if (invincible <= 0) invMaxT = 0;

  // 죽음 슬로모션: 잠시 느리게 떨어지며 빙글 돈 뒤 가위바위보/게임오버
  if (dying > 0) {
    dying--;
    deathSpin += 0.13;
    player.y += 2.2;
    if (dying === 0) {
      if (!rpsUsed) openRps();
      else gameOver();
    }
    return;
  }

  // 구간 이정표
  if (milestoneIdx < MILESTONES.length && score >= MILESTONES[milestoneIdx][0]) {
    announce(MILESTONES[milestoneIdx][1], '#2c3e50', 150);
    if (MILESTONES[milestoneIdx][0] === 13500) dexAdd('grav'); // 우주 도달
    beep(760, 0.12, 'square', 0.12);
    setTimeout(() => beep(980, 0.16, 'square', 0.12), 130);
    milestoneIdx++;
  }

  // 달 착륙 엔딩! (30,000점)
  if (!endingStarted && !boss && score >= MOON_SCORE) {
    endingStarted = true;
    state = State.ENDING;
    endingT = 0;
    bgm.stop();
    pauseBtn.classList.add('hidden');
    fireBtn.classList.add('hidden');
    sfx.bonus();
    vib([100, 80, 100, 80, 300]);
    return;
  }
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
    // 아레나 전체 바닥에서는 좌우 끝 → 반대편으로 그대로 이어짐 (랩어라운드 유지)
    const offEdge = !standPlat.arena &&
      (player.x < standPlat.x - 8 || player.x > standPlat.x + standPlat.w + 8);
    if (!boss || standPlat.broken || offEdge) {
      standPlat = null; // 발판을 벗어남 → 자유낙하
    } else {
      player.y = standPlat.y - player.h / 2;
      player.vy = 0;
    }
  }

  // --- 중력/제트팩 (우주에선 무중력에 가깝게 둥실둥실) ---
  const gravity = score > 13500 ? GRAVITY * 0.55 : GRAVITY;
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
    player.vy += gravity * (curChar === 'owl' && player.vy > 0 ? 0.82 : 1); // 부엉이: 활공
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
          dexAdd('plat_breaking');
          sfx.break();
          continue; // 튕기지 않고 통과
        }
        player.y = p.y - player.h / 2;
        dexAdd('plat_' + p.type);
        p.squashT = 12; // 밟히면 살짝 눌리는 애니메이션
        for (let di = 0; di < 4; di++) { // 착지 먼지
          particles.push({
            x: player.x + rand(-14, 14), y: p.y - 2,
            vx: rand(-1.2, 1.2), vy: rand(-0.8, -0.2),
            life: rand(10, 18), color: 'rgba(255,255,255,0.8)',
          });
        }
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
          dexAdd('jetpack');
          sfx.jetpack();
        } else if (p.spring) {
          player.vy = SPRING_VY;
          dexAdd('spring');
          sfx.spring();
        } else {
          player.vy = jumpV();
          landSquash = 9; // 통통 튀는 스쿼시!
          addJumpFx();
          sfx.jump();
        }
        // 얼음 발판: 잠시 미끄러움 (펭귄은 면역!)
        if (p.type === PlatType.ICE && curChar !== 'penguin') {
          slipT = 55;
          beep(1500, 0.08, 'triangle', 0.1);
          if (frame - lastCloseCall > 120) addFloat('미끌미끌~', player.x, player.y - 40, '#48c9e5', 14);
        }
        if (p.type === PlatType.ONESHOT) p.broken = true;
        // ✨ 골든 터치 (코인 부스터 Lv40): 밟은 발판에서 가끔 코인이 솟는다
        if (hasGoldenTouch() && Math.random() < 0.05) {
          coinsArr.push({
            x: p.x + p.w / 2, y: p.y - 26,
            vy: 0.4, swayPhase: rand(0, Math.PI * 2), spin: rand(0, Math.PI * 2),
            type: 'coin',
          });
          addBurst(p.x + p.w / 2, p.y - 10, '#ffd832');
          dexAdd('gold');
        }
        // 미션 훅: 처음 밟는 발판인지 + 스프링 여부
        const fresh = !landedSet.has(p);
        landedSet.add(p);
        missionEvent('Land', p, { fresh, spring: usedSpring });

        // 콤보: 새 발판 연속 밟기
        if (fresh) {
          combo++;
          if (combo > runMaxCombo) runMaxCombo = combo;
          if (combo > stats.maxCombo) { stats.maxCombo = combo; saveStats(); checkAchievements(); }
          if (combo >= 5) score += Math.min(combo, 30); // 콤보 보너스 점수
          if (combo % 10 === 0) {
            runCoins += 3;
            wallet += 3;
            saveWallet();
            addFloat(`x${combo} 콤보! +3🪙`, player.x, player.y - 40, '#e056fd', 18);
            sfx.buy();
          }
          // ⚡ 번개 충전 (번개 강화): 새 발판을 밟을 때마다
          if (upg.thunder > 0 && thunderCombo < thunderNeed()) thunderCombo++;
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
            announce('🏵️ 간발의 승부사! +50🪙', '#e056fd');
            sfx.bonus();
          }
        } else {
          closeStreak = 0;
        }

        // 튜토리얼: 첫 스프링
        if (tut && usedSpring && !tut.spring) {
          tut.spring = true;
          announce('🔴 스프링! 아주 높이 점프!', '#e74c3c');
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
    if (p.squashT > 0) p.squashT--;
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
    const type = roll < 0.16 ? 'star'
      : roll < 0.23 ? 'rainbow'
      : (hasGems() && roll < 0.27) ? 'gem' : 'coin'; // 💎 보석 (코인 부스터 Lv20)
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
        runStars++;
        dexAdd('star');
        sfx.spring();
        addBurst(c.x, c.y, '#ffd832');
        if (tut && !tut.star) {
          tut.star = true;
          announce('⭐ 별을 모으면 스타 파워!', '#c78a00');
        }
        if (starCount >= starGoalNow()) starPower();
      } else if (c.type === 'rainbow') {
        dexAdd('rainbow');
        const rv = 5 * coinValue();
        runCoins += rv;
        wallet += rv;
        stats.coins += rv;
        saveWallet();
        sfx.buy();
        addFloat(`+${rv}🪙`, c.x, c.y - 14, '#e056fd', 15);
        addBurst(c.x, c.y, '#e056fd');
        missionEvent('Coin');
      } else if (c.type === 'gem') {
        // 💎 보석 (코인 부스터 Lv20 해금)
        const gv = 20 * coinValue();
        runCoins += gv;
        wallet += gv;
        stats.coins += gv;
        saveWallet();
        sfx.buy();
        addFloat(`💎 +${gv}🪙`, c.x, c.y - 14, '#9b59b6', 16);
        addBurst(c.x, c.y, '#a55eea');
        dexAdd('gem');
        missionEvent('Coin');
      } else {
        const cv = coinValue(); // 높이 오를수록 코인 가치 상승 (10,000점당 +1)
        runCoins += cv;
        wallet += cv;
        stats.coins += cv;
        const bonusRate = (curChar === 'penguin' ? 0.1 : 0) + upg.coinup * 0.01; // 펭귄+코인 부스터
        if (bonusRate > 0) {
          coinFrac += cv * bonusRate;
          const ex = Math.floor(coinFrac);
          if (ex > 0) { coinFrac -= ex; runCoins += ex; wallet += ex; stats.coins += ex; }
        }
        saveWallet();
        sfx.coin();
        for (let sp = 0; sp < 5; sp++) { // ✨ 반짝 스파클
          const an = (Math.PI * 2 * sp) / 5 + rand(0, 0.8);
          particles.push({ x: c.x, y: c.y, vx: Math.cos(an) * 1.8, vy: Math.sin(an) * 1.8 - 0.6, life: rand(10, 17), color: sp % 2 ? '#fff6c9' : '#ffd832' });
        }
        if (cv > 1) addFloat(`+${cv}🪙`, c.x, c.y - 12, '#f1c40f', 13);
        particles.push({ x: c.x, y: c.y, vx: 0, vy: -1.5, life: 18, color: '#f1c40f' });
        missionEvent('Coin');
        dexAdd('coin');
        if (tut && !tut.coin) {
          tut.coin = true;
          announce('🪙 코인으로 상점에서 아이템을 사요!', '#b7791f');
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
    if (invincible <= 0 && jetpackTimer <= 0 && dist < 95) {
      const pull = (1 - dist / 95) * 0.6;
      player.vx += (dx / dist) * pull;
      player.vy += (dy / dist) * pull * 0.6;
      if (dist < bh.r * 0.7) {
        shakeT = 18;
        addBurst(player.x, player.y, '#6c5ce7');
        if (shieldBlock()) continue; // 🛡️ 보호막: 무적 60프레임 동안 탈출
        if (!tryRevive()) return;
      }
    }
  }
  blackholes = blackholes.filter((b) => b.y < cameraY + H + 80);

  // --- 어지러움 구름 (보스전 중 비활성) ---
  for (const dc of dizzyClouds) {
    if (boss) break;
    if (dc.used) continue;
    if (jetpackTimer > 0 || invincible > 0) continue; // 비행·무적 중엔 어지럼도 통과
    if (Math.abs(player.x - dc.x) < dc.w / 2 + 10 && Math.abs(player.y - dc.y) < dc.h / 2 + 14) {
      dc.used = true;
      dexAdd('dizzy');
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
        dexAdd('cannon');
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
  } else if (score > 2500 && score < 13500 && !boss) {
    if (--windWait <= 0) {
      windState = { dir: Math.random() < 0.5 ? -1 : 1, warnT: 90, t: 430 };
      dexAdd('wind');
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
      dexAdd('sstar');
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
    const tier = Math.round(nextBossAt / 6000);
    const face = Math.min(tier, 4);
    boss = {
      tier,
      face,
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
    announce(`👹 ${BOSS_FACES[face].name} 등장!`, '#c0392b', 120);
    nextBossAt += 6000;
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
    reversedT = 0;      // 조작 반전 해제
    windState = null;   // 바람 종료
    weatherDrops = weatherDrops.slice(0, 40);
    // 부스터/제트팩을 타고 왔다면 비행을 끝내고 바로 낙하 → 전투 시작!
    if (jetpackTimer > 0) {
      jetpackTimer = 0;
      jetpackSlow = false;
      if (player.vy < 0) player.vy = 1.5;
      addFloat('비행 종료! 전투 준비!', player.x, player.y - 44, '#e67e22', 15);
    }
    announce('좌우로 피하고 🔫 버튼으로 공격!', '#c0392b', 140);
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
      const set = BOSS_FACES[boss.face].patterns;
      boss.pattern = (boss.pattern + 1) % set.length;
      fireBossPattern(set[boss.pattern]);
      beep(200, 0.08, 'square', 0.1);
    }
    if (boss.t <= 0) {
      endBossArena();
      announce('보스가 물러갔다...', '#57606f', 100);
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
    if (bs.sway !== undefined) { // 지그재그
      bs.sway += 0.11;
      bs.x += Math.sin(bs.sway) * 2.1;
    }
    if (bs.homing && bs.hlife > 0) { // 유도탄: 잠시 플레이어를 쫓음
      bs.hlife--;
      bs.vx = clamp((bs.vx || 0) + Math.sign(player.x - bs.x) * 0.09, -2.3, 2.3);
    }
    if (invincible <= 0 && !holdCannon &&
        Math.hypot(player.x - bs.x, player.y - bs.y) < 18) {
      bs.y = cameraY + H + 999;
      shakeT = 16;
      addBurst(player.x, player.y, '#c0392b');
      if (shieldBlock()) continue; // 🛡️ 보호막이 대신 맞아줌
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

  // 🌈 점프 이펙트 Lv30+: 상승 중 무지개 궤적
  if (jumpFxTier() >= 2 && player.vy < -3 && jetpackTimer <= 0 && !boss && frame % 2 === 0) {
    particles.push({
      x: player.x + rand(-8, 8), y: player.y + 16,
      vx: rand(-0.4, 0.4), vy: rand(0.5, 1.2),
      life: 20, color: `hsl(${(frame * 14) % 360}, 90%, 62%)`,
    });
  }

  // --- 발자국 꾸미기 (트레일 아이템) ---
  const trailKind = wearing('trail_spark') ? 'spark'
    : wearing('trail_bubble') ? 'bubble'
    : wearing('trail_note') ? 'note' : null;
  if (trailKind && frame % 5 === 0 && !holdCannon && !standPlat) {
    trailFx.push({ x: player.x + rand(-6, 6), y: player.y + 16, life: 30, kind: trailKind, ph: rand(0, Math.PI * 2) });
    if (trailFx.length > 24) trailFx.shift();
  }
  for (const tf of trailFx) { tf.life--; if (tf.kind === 'bubble') tf.y -= 0.5; }
  trailFx = trailFx.filter((t) => t.life > 0);

  // --- 튜토리얼: 첫 미션 안내 ---
  if (tut && mission && !tut.mission) {
    tut.mission = true;
    announce('🎯 미션을 완수하면 보너스 타임!', '#6c3fb5');
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
          addJumpFx();
          sfx.jump();
          addBurst(m.x, m.y - m.h / 2, '#95afc0');
        } else {
          m.dead = true;
          player.vy = jumpV();
          addJumpFx();
          sfx.hit();
          vib(40);
          addBurst(m.x, m.y, '#9b59b6');
          missionEvent('Kill');
          stats.kills++;
          runKills++;
          dexAdd(m.kind);
          saveStats();
          checkAchievements();
        }
      } else {
        m.dead = true; // 부활 직후 같은 몬스터에 또 죽지 않게 제거
        shakeT = 16;
        addBurst(m.x, m.y, '#9b59b6');
        if (shieldBlock()) continue; // 🛡️ 보호막이 대신 맞아줌
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
      if (boss.hp <= 0) bossDefeated();
      continue;
    }
    for (const m of monsters) {
      if (m.dead) continue;
      if (Math.abs(b.x - m.x) < m.w / 2 && Math.abs(b.y - m.y) < m.h / 2) {
        m.hp = (m.hp || 1) - 1;
        if (!(b.pierce && m.hp <= 0)) b.y = -9999; // 🎯 관통탄(Lv15)은 처치 시 뚫고 지나감
        if (m.hp <= 0) {
          m.dead = true;
          sfx.hit();
          addBurst(m.x, m.y, m.kind === 'ufo' ? '#95afc0' : '#9b59b6');
          missionEvent('Kill');
          stats.kills++;
          runKills++;
          dexAdd(m.kind);
          saveStats();
          checkAchievements();
        } else {
          sfx.break();
          addBurst(b.x, b.y, '#f5b70d');
        }
      }
    }
  }
  bullets = bullets.filter((b) => b.y > cameraY - 16); // 화면 위로 나가면 바로 정리 (빠른 상승 시 재등장 방지)
  if (shootPose > 0) shootPose--;

  // ⚡ 낙뢰: 충전이 가득하고 화면에 적이 있으면 자동 발사 (없으면 충전 유지)
  if (upg.thunder > 0 && thunderCombo >= thunderNeed() && dying <= 0 && frame % 8 === 0) {
    if (fireThunder() > 0) {
      thunderCombo = 0;
      addFloat('⚡ 낙뢰!', player.x, player.y - 40, '#c78a00', 15);
    }
  }
  for (const bf of boltFx) bf.life--;
  boltFx = boltFx.filter((b) => b.life > 0);

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
      ammo = ammoMax();
      beep(650, 0.09, 'square', 0.12); // 철컥!
      updateFireBtn();
    } else if (frame % 6 === 0) {
      updateFireBtn();
    }
  }

  // --- 불길: 같은 곳에 머물 수 없다! ---
  if (!fireOn && (score > 250 || frame > 540)) {
    fireOn = true;
    dexAdd('fire');
    if (!fireAnnounced) {
      fireAnnounced = true;
      announce('🔥 아래에서 불길이 올라옵니다! 계속 위로!', '#e74c3c', 170);
      vib(80);
    }
  }
  if (fireOn && !boss && state === State.PLAYING) {
    const fireSpd = (0.45 + difficulty() * 0.75) * (1 - 0.008 * upg.fireslow);
    fireY -= fireSpd;
    // 너무 뒤처지면 화면 아래 3분의 1 지점까지 따라붙음
    fireY = Math.min(fireY, cameraY + H + 320);
    if (invincible <= 0 && dying <= 0 && player.y + 18 > fireY) {
      addBurst(player.x, player.y, '#e67e22');
      addBurst(player.x, player.y, '#e74c3c');
      shakeT = Math.max(shakeT, 12);
      if (!tryRevive()) return;
    }
  }

  tickAnnounce();

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
      // 반짝이는 별 (십자 스파클 섞음)
      const tw = 0.5 + Math.sin(frame * 0.06 + i * 1.7) * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${(0.45 + 0.45 * tw) * starA})`;
      const sx1 = (cx * 1.7 + 40) % W, sy1 = (cy * 1.3 % H + H) % H;
      ctx.fillRect(sx1, sy1, 3, 3);
      ctx.fillRect((cx * 0.6 + 150) % W, ((cy * 0.8 + 90) % H + H) % H, 2, 2);
      if (i % 3 === 0 && tw > 0.75) { // 가끔 십자 반짝
        ctx.fillRect(sx1 - 4, sy1 + 1, 11, 1);
        ctx.fillRect(sx1 + 1, sy1 - 4, 1, 11);
      }
    }
  }
  // 🌈 성층권 오로라 커튼 (8,500~13,500 구간)
  const auroraA = clamp((score - 8000) / 2500, 0, 1) * clamp((15000 - score) / 3000, 0, 1);
  if (auroraA > 0.02) {
    ctx.save();
    ctx.globalAlpha = auroraA * 0.28;
    for (let b = 0; b < 3; b++) {
      const hue = 130 + b * 45;
      const grad = ctx.createLinearGradient(0, 60 + b * 30, 0, 220 + b * 30);
      grad.addColorStop(0, `hsla(${hue}, 85%, 65%, 0)`);
      grad.addColorStop(0.5, `hsla(${hue}, 85%, 65%, 0.8)`);
      grad.addColorStop(1, `hsla(${hue}, 85%, 65%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = 130 + b * 26 + Math.sin(x * 0.02 + frame * 0.012 + b * 2) * 34;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(W, 260 + b * 30);
      ctx.lineTo(0, 260 + b * 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // 🌕 고고도에서 달이 은은히 빛남 (22,000+)
  const moonA = clamp((score - 20000) / 6000, 0, 1);
  if (moonA > 0.02) {
    ctx.save();
    ctx.globalAlpha = moonA;
    ctx.shadowColor = 'rgba(255, 250, 220, 0.9)';
    ctx.shadowBlur = 26;
    const mg = ctx.createRadialGradient(W - 70 - 6, 96 - 6, 4, W - 70, 96, 30);
    mg.addColorStop(0, '#fffdf2');
    mg.addColorStop(1, '#e8e0c8');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(W - 70, 96, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200, 192, 168, 0.5)';
    ctx.beginPath();
    ctx.arc(W - 78, 88, 5.5, 0, Math.PI * 2);
    ctx.arc(W - 62, 102, 4, 0, Math.PI * 2);
    ctx.arc(W - 70, 110, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
  { // 발판 아래 은은한 그림자 (공중 부양감)
    const shY = p.y - cameraY + p.h + 6;
    if (shY > -20 && shY < H + 20 && !p.broken) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#1e2a38';
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, shY, p.w * 0.42, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  if (boss && !p.arena) return; // 보스전 중 일반 발판 숨김
  const y = p.y - cameraY;
  ctx.save();
  if (p.squashT > 0) { // 밟힌 직후 눌림 효과
    const sq = Math.sin((p.squashT / 12) * Math.PI);
    ctx.translate(p.x + p.w / 2, y + p.h);
    ctx.scale(1 + 0.09 * sq, 1 - 0.26 * sq);
    ctx.translate(-(p.x + p.w / 2), -(y + p.h));
  }
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
  if (c.type === 'gem') {
    // 💎 보석 (코인 부스터 Lv20): 보라 다이아몬드
    ctx.shadowColor = 'rgba(165, 94, 234, 0.9)';
    ctx.shadowBlur = 12;
    ctx.rotate(Math.sin(c.spin) * 0.25);
    const gg = ctx.createLinearGradient(0, -12, 0, 12);
    gg.addColorStop(0, '#e6d3ff');
    gg.addColorStop(0.5, '#a55eea');
    gg.addColorStop(1, '#6c3fb5');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, -3);
    ctx.lineTo(0, 13);
    ctx.lineTo(-9, -3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#5b2c9c';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, -3);
    ctx.lineTo(9, -3);
    ctx.moveTo(0, -12);
    ctx.lineTo(-4, -3);
    ctx.lineTo(0, 13);
    ctx.stroke();
  } else if (c.type === 'star') {
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
  ctx.translate(0, Math.sin(frame * 0.05 + cn.osc) * 1.5); // 둥실둥실
  // 구름 받침: 공중에 떠 있어도 폭탄처럼 안 보이게 확실한 발판을 그려줌
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.ellipse(0, 17, 23, 8.5, 0, 0, Math.PI * 2);
  ctx.ellipse(-14, 14, 11, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(13, 14, 12, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(185, 200, 216, 0.55)';
  ctx.beginPath();
  ctx.ellipse(0, 20, 18, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
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
      ctx.strokeText(msg, W / 2, 330);
      ctx.fillStyle = '#0984e3';
      ctx.fillText(msg, W / 2, 330);
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
  const F = BOSS_FACES[boss.face];
  const y = boss.y - cameraY + Math.sin(boss.wobble) * 4;
  ctx.save();
  ctx.translate(boss.x, y);

  // 티어 4: 어둠의 오라
  if (F.deco === 'crown') {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(boss.wobble * 2);
    ctx.fillStyle = '#6c5ce7';
    ctx.beginPath();
    ctx.ellipse(0, 0, 54, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 머리 장식 (티어별)
  if (F.deco === 'horns') {
    ctx.fillStyle = '#8e2f2f';
    ctx.beginPath();
    ctx.moveTo(-24, -22); ctx.lineTo(-36, -44); ctx.lineTo(-14, -30);
    ctx.moveTo(24, -22); ctx.lineTo(36, -44); ctx.lineTo(14, -30);
    ctx.fill();
  } else if (F.deco === 'flames') {
    for (let i = -2; i <= 2; i++) {
      const fh = 16 + 6 * Math.sin(boss.wobble * 3 + i); // 일렁이는 불꽃
      ctx.fillStyle = i % 2 ? '#ff9f43' : '#ee5253';
      ctx.beginPath();
      ctx.moveTo(i * 14 - 6, -26);
      ctx.lineTo(i * 14, -26 - fh);
      ctx.lineTo(i * 14 + 6, -26);
      ctx.fill();
    }
  } else if (F.deco === 'ice') {
    ctx.fillStyle = '#c9f3ff';
    ctx.strokeStyle = '#7fc9e8';
    ctx.lineWidth = 1.5;
    for (const [ix, ih] of [[-20, 16], [0, 24], [20, 16]]) {
      ctx.beginPath();
      ctx.moveTo(ix - 7, -24);
      ctx.lineTo(ix, -24 - ih);
      ctx.lineTo(ix + 7, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (F.deco === 'crown') {
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-20, -26);
    ctx.lineTo(-20, -42); ctx.lineTo(-10, -32);
    ctx.lineTo(0, -46); ctx.lineTo(10, -32);
    ctx.lineTo(20, -42); ctx.lineTo(20, -26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(0, -34, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 몸통
  const g = ctx.createRadialGradient(-10, -12, 5, 0, 0, 46);
  g.addColorStop(0, F.c1);
  g.addColorStop(0.6, F.c2);
  g.addColorStop(1, F.c3);
  ctx.fillStyle = g;
  ctx.strokeStyle = F.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 화난 눈 (티어 4는 빛남)
  for (const side of [-1, 1]) {
    if (F.deco === 'crown') {
      ctx.shadowColor = F.eye;
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = F.eye;
    ctx.beginPath();
    ctx.ellipse(side * 14, -8, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(side * 12, -7, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = F.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(side * 5, -20);
    ctx.lineTo(side * 22, -14);
    ctx.stroke();
  }
  // 이빨 입
  ctx.fillStyle = F.line;
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

  // 보스 투사체 (종류별 색)
  for (const bs of bossShots) {
    const sy = bs.y - cameraY;
    let cA = '#ff9f8a', cB = '#c0392b', glow = 'rgba(192, 57, 43, 0.8)';
    if (bs.sway !== undefined) { cA = '#c9f3ff'; cB = '#0abde3'; glow = 'rgba(10, 189, 227, 0.8)'; }
    else if (bs.homing) { cA = '#dcc6f0'; cB = '#8e44ad'; glow = 'rgba(142, 68, 173, 0.9)'; }
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8;
    const pg = ctx.createRadialGradient(bs.x - 1, sy - 1, 0.5, bs.x, sy, 7);
    pg.addColorStop(0, cA);
    pg.addColorStop(1, cB);
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
  if (dying > 0) {
    ctx.rotate(deathSpin); // 죽을 땐 빙글빙글
  } else {
    ctx.rotate(clamp(player.vx * 0.03, -0.22, 0.22)); // 이동 방향으로 살짝 기울기
  }

  // 부활 무적: 깜빡임 (보너스 비행 중에는 깜빡이지 않음)
  if (invincible > 0 && jetpackTimer <= 0 && Math.floor(invincible / 6) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }

  // 스쿼시&스트레치: 착지 순간 납작 → 상승 중 길쭉 (통통 튀는 느낌)
  if (landSquash > 0) landSquash--;
  if (dying <= 0) {
    if (landSquash > 0) {
      const t = landSquash / 9;
      ctx.scale(1 + 0.16 * t, 1 - 0.2 * t);
    } else if (player.vy < -7 && jetpackTimer <= 0) {
      const st = clamp((-player.vy - 7) / 10, 0, 1);
      ctx.scale(1 - 0.08 * st, 1 + 0.12 * st);
    }
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

  // 🛡️ 보호막 버블 (보호막 강화)
  if (shieldCharges > 0 && state !== State.MENU && dying <= 0) {
    const pr = 30 + Math.sin(frame * 0.1) * 2;
    ctx.save();
    ctx.translate(x, y);
    const sg2 = ctx.createRadialGradient(0, 0, pr * 0.55, 0, 0, pr);
    sg2.addColorStop(0, 'rgba(116, 185, 255, 0)');
    sg2.addColorStop(0.85, 'rgba(116, 185, 255, 0.16)');
    sg2.addColorStop(1, 'rgba(116, 185, 255, 0.42)');
    ctx.fillStyle = sg2;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-pr * 0.35, -pr * 0.4, pr * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const wearing = (item) => equip[item] && inv[item];

// 사이드뷰 스프라이트의 머리 앵커 (왼쪽을 보는 기준, 좌우반전은 ctx가 처리)
const HEADX = -9.5;   // 머리 중심 x
const HEADY = -5;     // 머리 중심 y
const HEADR = 8.4;    // 머리 반지름

// 등 뒤 아이템 (캐릭터보다 먼저 그림 — 등쪽에서 나옴)
function drawAccessoriesBack() {
  if (wearing('backpack')) {
    // 책가방: 등에 멘 주황 가방
    ctx.fillStyle = '#e17055';
    roundRect(6, -6, 11, 14, 3.5);
    ctx.strokeStyle = '#c44d3f';
    ctx.lineWidth = 1;
    ctx.strokeRect(7.5, -3, 8, 4.5);
    ctx.fillStyle = '#fdcb6e';
    roundRect(8.5, 2.5, 6, 4, 1.6);
  }
  if (wearing('balloonpack')) {
    // 풍선 3개: 둥실둥실 떠다님
    const bob = Math.sin(frame * 0.07) * 1.5;
    const cols = [['#ff6b81', 0], ['#ffd832', 3.2], ['#54a0ff', 6.4]];
    for (const [col, dx] of cols) {
      const bx = 7 + dx, by = -19 + bob + (dx === 3.2 ? -3.5 : 0);
      ctx.strokeStyle = 'rgba(120, 120, 130, 0.7)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(bx, by + 4.5);
      ctx.quadraticCurveTo(bx - 1, by + 12, 8, 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(bx, by, 3.2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(bx - 1, by - 1.3, 1, 1.4, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (wearing('wings')) {
    // 천사 날개: 등(오른쪽 뒤)에서 위로 펼쳐져 팔랑임
    const f = Math.sin(frame * 0.22) * 2.5;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(185, 195, 214, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(8, -8 + f * 0.5, 10, 4.6, -0.85, 0, Math.PI * 2);
    ctx.ellipse(12, -3 + f * 0.8, 8.5, 4, -0.6, 0, Math.PI * 2);
    ctx.ellipse(14, 2 + f, 7, 3.4, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (wearing('cape')) {
    // 망토: 목 뒤에서 등 뒤로 휘날림
    const wave = Math.sin(frame * 0.18) * 3.5;
    ctx.save();
    const g = ctx.createLinearGradient(2, -8, 22, 14);
    g.addColorStop(0, '#e74c3c');
    g.addColorStop(1, '#a93226');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2, -7);
    ctx.quadraticCurveTo(14, -5 + wave * 0.4, 21, 7 + wave);
    ctx.quadraticCurveTo(16, 13 + wave * 0.6, 11, 10 + wave * 0.5);
    ctx.quadraticCurveTo(8, 14 + wave * 0.3, 4, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// 앞쪽 아이템 (캐릭터 위에 그림 — 머리에 밀착)
function drawAccessoriesFront() {
  if (wearing('hat')) {
    // 야구모자: 머리 윗면을 감싸는 돔 + 진행 방향 챙
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(HEADX, HEADY - 2.5, HEADR * 0.96, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    roundRect(HEADX - HEADR - 6, HEADY - 4.6, 7.5, 2.6, 1.2); // 챙
    ctx.fillStyle = '#a93226';
    ctx.beginPath();
    ctx.arc(HEADX, HEADY - 10.6, 1.4, 0, Math.PI * 2); // 꼭지 단추
    ctx.fill();
  }
  if (wearing('crown')) {
    // 왕관: 정수리에 딱 얹힘
    const by = HEADY - HEADR + 0.5; // 왕관 밑변
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#c29d0b';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(HEADX - 6, by);
    ctx.lineTo(HEADX - 6, by - 6);
    ctx.lineTo(HEADX - 3, by - 2.5);
    ctx.lineTo(HEADX, by - 7.5);
    ctx.lineTo(HEADX + 3, by - 2.5);
    ctx.lineTo(HEADX + 6, by - 6);
    ctx.lineTo(HEADX + 6, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(HEADX, by - 3.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('tophat')) {
    // 실크햇: 정수리 위 원기둥 + 챙
    const by = HEADY - HEADR + 1;
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(HEADX - 5, by - 9.5, 10, 9.5);
    roundRect(HEADX - 8, by - 1, 16, 2.4, 1.2);
    ctx.fillStyle = '#6c5ce7';
    ctx.fillRect(HEADX - 5, by - 3.2, 10, 2.2); // 보라 띠
  }
  if (wearing('bow')) {
    // 리본: 정수리 뒤쪽에 살짝
    const bx = HEADX + 3.5, by = HEADY - HEADR - 0.5;
    ctx.fillStyle = '#fd79a8';
    ctx.strokeStyle = '#e84393';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 5.5, by - 4);
    ctx.lineTo(bx - 5.5, by + 3);
    ctx.closePath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + 5.5, by - 4);
    ctx.lineTo(bx + 5.5, by + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e84393';
    ctx.beginPath();
    ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('headphones')) {
    // 헤드폰: 머리를 넘는 밴드 + 귀 위치의 이어컵 (사이드뷰라 한쪽)
    ctx.strokeStyle = '#e17055';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(HEADX, HEADY, HEADR + 0.8, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    const cx2 = HEADX + 4.5, cy2 = HEADY + 1.5; // 귀(뺨 뒤) 위치
    ctx.fillStyle = '#d63031';
    ctx.beginPath();
    ctx.ellipse(cx2, cy2, 3, 3.8, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx2 - 1, cy2 - 1.2, 1, 1.4, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('glasses')) {
    // 선글라스 (사이드뷰): 눈 위 렌즈 하나 + 귀로 넘어가는 다리
    const ex = -13.5, ey = -6.5;
    ctx.fillStyle = 'rgba(28, 28, 38, 0.92)';
    ctx.strokeStyle = 'rgba(15, 15, 22, 0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 4, 3.4, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex + 3.8, ey - 0.8);
    ctx.lineTo(HEADX + 6, HEADY - 1.5); // 귀로 가는 다리
    ctx.moveTo(ex - 4, ey - 0.6);
    ctx.lineTo(ex - 6.2, ey + 0.6); // 코 걸이
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(ex - 1.2, ey - 1.2, 1.4, 1, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('scarf')) {
    // 목도리: 목을 감싸는 띠 + 늘어진 자락
    ctx.fillStyle = '#e67e22';
    ctx.save();
    ctx.translate(-4.5, 1.5);
    ctx.rotate(0.12);
    roundRect(-5.5, -2.2, 11, 4.4, 2.2);
    ctx.restore();
    ctx.fillStyle = '#d35400';
    roundRect(-7.5, 3.5, 4, 8, 2);
    ctx.fillStyle = '#e67e22';
    roundRect(-7, 9.5, 3, 2.4, 1.2); // 자락 끝단
  }
  if (wearing('partyhat')) {
    // 고깔모자: 물방울무늬 + 폼폼
    const by = HEADY - HEADR + 1;
    ctx.fillStyle = '#f78fb3';
    ctx.beginPath();
    ctx.moveTo(HEADX - 5.5, by);
    ctx.lineTo(HEADX, by - 11);
    ctx.lineTo(HEADX + 5.5, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e05c8a';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#ffd832';
    for (const [dx, dy] of [[-1.6, -3], [1.8, -5.5], [-0.4, -7.5]]) {
      ctx.beginPath();
      ctx.arc(HEADX + dx, by + dy, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(HEADX, by - 11.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('beret')) {
    // 화가 베레모: 살짝 기울여 얹음
    ctx.fillStyle = '#5f27cd';
    ctx.beginPath();
    ctx.ellipse(HEADX + 1, HEADY - HEADR + 0.6, 8, 3.4, -0.12, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(HEADX + 1, HEADY - HEADR - 2, 6.2, 2.4, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#341f97';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(HEADX + 1, HEADY - HEADR - 4);
    ctx.lineTo(HEADX + 2.2, HEADY - HEADR - 6);
    ctx.stroke();
  }
  if (wearing('bunnyears')) {
    // 토끼 귀 머리띠
    for (const dx of [-4.5, 2.5]) {
      const bx = HEADX + dx, by = HEADY - HEADR + 1;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d8d0e0';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(bx, by - 7.5, 2.6, 7.5, dx * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fbb1c8';
      ctx.beginPath();
      ctx.ellipse(bx, by - 7, 1.2, 5, dx * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (wearing('propeller')) {
    // 프로펠러 모자: 날개가 빙글빙글
    ctx.fillStyle = '#48c9e5';
    ctx.beginPath();
    ctx.arc(HEADX, HEADY - 2.5, HEADR * 0.92, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#2f9ab8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(HEADX, HEADY - HEADR - 0.5);
    ctx.lineTo(HEADX, HEADY - HEADR - 3);
    ctx.stroke();
    const sp = Math.sin(frame * 0.45);
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.ellipse(HEADX, HEADY - HEADR - 3.8, Math.abs(sp) * 6 + 1.5, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6b93b';
    ctx.beginPath();
    ctx.arc(HEADX, HEADY - HEADR - 3.8, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  if (wearing('viking')) {
    // 바이킹 투구: 은빛 돔 + 양쪽 뿔
    ctx.fillStyle = '#f5e8d0';
    ctx.strokeStyle = '#cbb894';
    ctx.lineWidth = 0.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(HEADX + s * (HEADR - 2), HEADY - 4);
      ctx.quadraticCurveTo(HEADX + s * (HEADR + 4.5), HEADY - 8, HEADX + s * (HEADR + 2), HEADY - 13.5);
      ctx.lineTo(HEADX + s * (HEADR - 3.5), HEADY - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#95a5a6';
    ctx.beginPath();
    ctx.arc(HEADX, HEADY - 2, HEADR * 0.98, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#707b7c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADX - HEADR + 1, HEADY - 2.5);
    ctx.lineTo(HEADX + HEADR - 1, HEADY - 2.5);
    ctx.stroke();
  }
  if (wearing('halo')) {
    // 천사 링: 머리 위에 둥실
    const hy = HEADY - HEADR - 4.5 + Math.sin(frame * 0.08) * 0.8;
    ctx.strokeStyle = '#ffd832';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = 'rgba(255, 216, 50, 0.8)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.ellipse(HEADX, hy, 6, 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (wearing('monocle')) {
    // 신사 외눈 안경 + 금줄
    const ex = -13.5, ey = -6.5;
    ctx.fillStyle = 'rgba(200, 230, 255, 0.25)';
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex + 2, ey + 3.2);
    ctx.quadraticCurveTo(ex + 4.5, ey + 6.5, ex + 4, ey + 10);
    ctx.stroke();
  }
  if (wearing('heartglasses')) {
    // 하트 안경 (사이드뷰 렌즈 하나)
    const ex = -13.5, ey = -6.5;
    ctx.fillStyle = 'rgba(253, 121, 168, 0.9)';
    ctx.strokeStyle = '#e84393';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ex, ey + 3.8);
    ctx.bezierCurveTo(ex - 5.5, ey - 1, ex - 3.5, ey - 5.8, ex, ey - 2.2);
    ctx.bezierCurveTo(ex + 3.5, ey - 5.8, ex + 5.5, ey - 1, ex, ey + 3.8);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ex + 3.5, ey - 1);
    ctx.lineTo(HEADX + 6, HEADY - 1.5);
    ctx.stroke();
  }
  if (wearing('mustache')) {
    // 멋쟁이 콧수염 (주둥이 끝)
    ctx.strokeStyle = '#4a3728';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-17.5, 0.5);
    ctx.quadraticCurveTo(-14, -1.5, -11.5, 0.2);
    ctx.moveTo(-17.5, 0.5);
    ctx.quadraticCurveTo(-20.5, -0.8, -22, -2.4);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  if (wearing('bowtie')) {
    // 나비넥타이
    ctx.save();
    ctx.translate(-4, 3.5);
    ctx.fillStyle = '#e74c3c';
    ctx.strokeStyle = '#b03a2e';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-5, -3.2);
    ctx.lineTo(-5, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, -3.2);
    ctx.lineTo(5, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (wearing('pearl')) {
    // 진주 목걸이
    ctx.fillStyle = '#fdfefe';
    ctx.strokeStyle = 'rgba(175, 175, 192, 0.85)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const px = -10.5 + t * 13;
      const py = 2 + Math.sin(t * Math.PI) * 3.6;
      ctx.beginPath();
      ctx.arc(px, py, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

// 내장 임시 캐릭터 (이미지 로딩 전 폴백): 동글동글한 초록 캐릭터
function drawDefaultCharacter() {
  const dir = player.facing === 'right' ? 1 : -1;
  ctx.fillStyle = '#a3d977';
  ctx.strokeStyle = '#6ab04c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, 2, 20, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6ab04c';
  ctx.beginPath();
  ctx.ellipse(-9, 18, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(9, 18, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
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

  // ⚡ 낙뢰 연출: 하늘에서 내리꽂히는 지그재그 번개
  for (const bf of boltFx) {
    const a = clamp(bf.life / 16, 0, 1);
    const ty = bf.y - cameraY;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#fffbe0';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ffe66d';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(bf.x, -12);
    let zs = bf.seed;
    let zy = -12;
    while (zy < ty - 20) {
      zs = (zs * 9301 + 49297) % 233280;
      zy += 24;
      ctx.lineTo(bf.x + ((zs / 233280) - 0.5) * 36, zy);
    }
    ctx.lineTo(bf.x, ty);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffe66d';
    ctx.stroke();
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bf.x, ty, 10 * (1 - a) + 4, 0, Math.PI * 2);
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

  // 트레일 꾸미기
  for (const tf of trailFx) {
    const ta = clamp(tf.life / 30, 0, 1);
    const ty2 = tf.y - cameraY;
    ctx.save();
    ctx.globalAlpha = ta * 0.9;
    if (tf.kind === 'spark') {
      ctx.fillStyle = '#ffd832';
      ctx.translate(tf.x, ty2);
      ctx.rotate(tf.ph + frame * 0.05);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 === 0 ? 4.5 : 1.8;
        const an = (Math.PI / 4) * i;
        ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.closePath();
      ctx.fill();
    } else if (tf.kind === 'bubble') {
      ctx.strokeStyle = 'rgba(140, 205, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(tf.x, ty2, 4 + Math.sin(tf.ph) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(tf.x - 1.5, ty2 - 1.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tf.ph > Math.PI ? '🎵' : '🎶', tf.x, ty2);
    }
    ctx.restore();
  }

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
    const halfW = ctx.measureText(f.text).width / 2;
    const fx = clamp(f.x, halfW + 4, W - halfW - 4); // 화면 밖 짤림 방지
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, fx, fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, fx, fy);
    ctx.restore();
  }

  drawFire();
  if (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN) drawAnnounce();

  // 조작 반전 상태: 보라 틴트
  if (reversedT > 0 && state === State.PLAYING) {
    ctx.fillStyle = `rgba(155, 89, 182, ${0.10 + 0.05 * Math.sin(frame * 0.3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 달 착륙 엔딩 연출
  if (state === State.ENDING) {
    const t = endingT;
    // 우주 배경
    ctx.fillStyle = `rgba(8, 8, 32, ${clamp(t / 60, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 40; i++) {
      ctx.fillRect((i * 97 + 23) % W, (i * 61 + ((t * 0.2) | 0)) % H, 2, 2);
    }
    // 달이 아래에서 떠오름
    const moonY = H + 160 - clamp(t / 140, 0, 1) * 480;
    const mg = ctx.createRadialGradient(W / 2 - 30, moonY - 40, 20, W / 2, moonY, 170);
    mg.addColorStop(0, '#fdfbe8');
    mg.addColorStop(1, '#cfc9a8');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(W / 2, moonY, 160, 0, Math.PI * 2);
    ctx.fill();
    // 크레이터
    ctx.fillStyle = 'rgba(180, 172, 140, 0.6)';
    for (const [cx2, cy2, r2] of [[-60, -50, 18], [40, -90, 12], [80, -20, 22], [-20, 10, 10]]) {
      ctx.beginPath();
      ctx.arc(W / 2 + cx2, moonY + cy2, r2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (t > 130) {
      // 둥이 착륙 + 깃발
      const img = charImgs.left;
      if (img) ctx.drawImage(img, W / 2 - 50, moonY - 160 - 46, 52, 52);
      ctx.strokeStyle = '#8d6e63';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(W / 2 + 22, moonY - 158);
      ctx.lineTo(W / 2 + 22, moonY - 210);
      ctx.stroke();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(W / 2 + 24, moonY - 210);
      ctx.lineTo(W / 2 + 62, moonY - 199);
      ctx.lineTo(W / 2 + 24, moonY - 188);
      ctx.fill();
    }
    if (t > 180) {
      ctx.font = '900 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 6;
      ctx.strokeText('🌕 달 착륙 성공!', W / 2, 150);
      ctx.fillStyle = '#f6b93b';
      ctx.fillText('🌕 달 착륙 성공!', W / 2, 150);
      ctx.font = '800 17px sans-serif';
      ctx.strokeText('둥이는 해냈습니다!', W / 2, 186);
      ctx.fillStyle = '#fff';
      ctx.fillText('둥이는 해냈습니다!', W / 2, 186);
    }
    // 색종이
    if (t > 180) {
      for (let i = 0; i < 24; i++) {
        const px = (i * 53 + t * ((i % 3) + 1)) % W;
        const py = (i * 91 + t * 2) % H;
        ctx.fillStyle = `hsl(${(i * 47) % 360}, 85%, 65%)`;
        ctx.fillRect(px, py, 5, 8);
      }
    }
  }

  // 죽음 슬로모션: 붉은 비네트
  if (dying > 0) {
    const dv = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
    dv.addColorStop(0, 'rgba(180, 30, 30, 0)');
    dv.addColorStop(1, `rgba(150, 20, 20, ${0.45 * (1 - dying / 46)})`);
    ctx.fillStyle = dv;
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

  // HUD: 점수 / 코인 / 별 / 생명 (사진 모드에선 숨김) — 노치만큼 아래로
  if (!photoMode && (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN)) {
    ctx.save();
    ctx.translate(0, safeTopL());
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
    // ⚡ 번개 충전 (해금한 경우에만)
    if (upg.thunder > 0) {
      const txt = `⚡${Math.min(thunderCombo, thunderNeed())}/${thunderNeed()}`;
      ctx.font = '800 13px sans-serif';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      roundRect(198, 48, tw + 20, 28, 14);
      ctx.fillStyle = '#8e6d00';
      ctx.fillText(txt, 208, 63);
    }
    // ⏳ 부스트·무적 남은 시간 바
    drawTimerBars([
      { icon: '🚀', frac: jetpackTimer > 0 && jetpackMaxT > 0 ? jetpackTimer / jetpackMaxT : 0, color: '#e67e22' },
      { icon: '✨', frac: invincible > 40 && invMaxT > 0 ? invincible / invMaxT : 0, color: '#f6b93b' },
    ], 96, W - 60);

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

    { // 🎒 이번 판 아이템 트레이: 생명 · 보호막 · 가위바위보 찬스
      const trayParts = [`❤️${lives}`];
      if (shieldMax() > 0) trayParts.push(`🛡️${shieldCharges}`);
      if (!rpsUsed) trayParts.push('✊1');
      const trayTxt = trayParts.join('  ');
      ctx.font = '800 13px sans-serif';
      const trayW = ctx.measureText(trayTxt).width + 18;
      const trayY = mission ? 118 : 84;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      roundRect(8, trayY, trayW, 25, 12.5);
      ctx.fillStyle = '#5a4a2f';
      ctx.fillText(trayTxt, 17, trayY + 13);
    }

    ctx.restore();
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

// ---------- 불길 그리기 ----------
function drawFire() {
  if (!fireOn || boss || state === State.ENDING) return;
  const fy = fireY - cameraY;
  // 가까워지면 화면 아래 붉은 경고 글로우
  const gap = fireY - player.y;
  if (gap < 300) {
    const a = clamp(1 - gap / 300, 0, 1) * 0.35;
    const g = ctx.createLinearGradient(0, H - 130, 0, H);
    g.addColorStop(0, 'rgba(231, 76, 60, 0)');
    g.addColorStop(1, `rgba(231, 76, 60, ${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 130, W, 130);
  }
  if (fy > H + 40) return;
  // 본체: 그라데이션 + 일렁이는 불꽃 혀
  const g2 = ctx.createLinearGradient(0, fy - 26, 0, Math.min(fy + 130, H + 40));
  g2.addColorStop(0, 'rgba(255, 200, 80, 0.95)');
  g2.addColorStop(0.35, 'rgba(240, 120, 40, 0.97)');
  g2.addColorStop(1, 'rgba(180, 40, 20, 1)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.moveTo(0, H + 40);
  ctx.lineTo(0, fy);
  for (let x = 0; x <= W; x += 18) {
    const h2 = 14 + 11 * Math.sin(x * 0.35 + frame * 0.22) + 6 * Math.sin(x * 0.13 - frame * 0.15);
    ctx.lineTo(x + 9, fy - h2);
    ctx.lineTo(x + 18, fy);
  }
  ctx.lineTo(W, H + 40);
  ctx.closePath();
  ctx.fill();
  // 불씨
  for (let i = 0; i < 8; i++) {
    const ex = (i * 47 + frame * 1.3 * ((i % 3) + 1)) % W;
    const eh = (i * 31 + frame * (1.6 + (i % 2))) % 90;
    ctx.fillStyle = `rgba(255, ${150 + (i * 13) % 90}, 60, ${0.75 - eh / 130})`;
    ctx.fillRect(ex, fy - 20 - eh, 3, 3);
  }
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
      if (runnerMode) updateRunner(); else if (fighterMode) updateFighter(); else update();
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
    if (state === State.PAUSED || state === State.COUNTDOWN) tickAnnounce();
    // 달 착륙 엔딩 진행
    if (state === State.ENDING) {
      endingT++;
      if (endingT === 200) sfx.bonus();
      if (endingT > 400) {
        cleared = true;
        stats.moon = true;
        dexAdd('moon');
        saveStats();
        checkAchievements();
        gameOver();
      }
    }
  }
  if (runnerMode && state === State.OVER) {
    // 종료 화면: 세로로 되돌아온 캔버스를 우주색으로 깔끔히 채움(러너 장면 왜곡 방지)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1836';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (runnerMode) drawRunner();
  else if (fighterMode) drawFighter();
  else draw();
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
const moveBtns = $('move-btns');
// ◀ ▶ 이동 버튼: 누르는 동안 이동 (터치 모드 전용, 화면 반쪽 터치와 병행)
function bindMoveBtn(id, key) {
  const b = $(id);
  const on = (e) => { e.preventDefault(); input[key] = true; };
  const off = (e) => { e.preventDefault(); input[key] = false; };
  b.addEventListener('touchstart', on, { passive: false });
  b.addEventListener('touchend', off, { passive: false });
  b.addEventListener('touchcancel', off, { passive: false });
  b.addEventListener('mousedown', on);
  b.addEventListener('mouseup', off);
  b.addEventListener('mouseleave', () => { input[key] = false; });
}
bindMoveBtn('btn-left', 'left');
bindMoveBtn('btn-right', 'right');
function showMoveBtns(show) {
  moveBtns.classList.toggle('hidden', !show || controlMode !== 'touch');
}
// 🏃 문 런 전용 점프/슬라이드 버튼
(() => {
  const jb = $('btn-jump'), sb = $('btn-slide');
  const jOn = (e) => { e.preventDefault(); runnerJump(); };
  const sOn = (e) => { e.preventDefault(); if (R) R.slideHeld = true; };
  const sOff = (e) => { e.preventDefault(); if (R) R.slideHeld = false; };
  jb.addEventListener('touchstart', jOn, { passive: false });
  jb.addEventListener('mousedown', jOn);
  sb.addEventListener('touchstart', sOn, { passive: false });
  sb.addEventListener('touchend', sOff, { passive: false });
  sb.addEventListener('touchcancel', sOff, { passive: false });
  sb.addEventListener('mousedown', sOn);
  sb.addEventListener('mouseup', sOff);
  sb.addEventListener('mouseleave', () => { if (R) R.slideHeld = false; });
})();
function updateFireBtn() {
  if (reloading > 0) {
    fireBtn.innerHTML = `⏳<span class="ammo">${Math.ceil((reloading / reloadTime()) * 100)}%</span>`;
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
  const title = localStorage.getItem('jump-title');
  $('best-score-label').textContent = best.toLocaleString();
  $('wallet-label').textContent = wallet.toLocaleString();
  const rb = $('btn-run2');
  if (rb) {
    rb.textContent = series2Unlocked()
      ? `2️⃣ 시리즈2 · 문 런${best2 > 0 ? ` (BEST ${best2}m)` : ''}`
      : '🔒 시리즈2 · 문 런';
    rb.classList.toggle('locked', !series2Unlocked());
  }
  const rb3 = $('btn-run3');
  if (rb3) {
    if (series3Unlocked()) {
      rb3.disabled = false;
      rb3.classList.add('unlocked');
      rb3.innerHTML = `3️⃣ 시리즈3 · 스타 파이터${best3 > 0 ? ` (BEST ${best3.toLocaleString()})` : ''}`;
    } else {
      rb3.disabled = false; // 잠금 안내 클릭은 가능
      rb3.classList.remove('unlocked');
      rb3.innerHTML = '🔒 시리즈3 · 스타 파이터<small>문 런 우주선 탑승 시 해금</small>';
    }
  }
  const sc2 = $('series-count');
  if (sc2) sc2.textContent = `🎮 시리즈 ${1 + (series2Unlocked() ? 1 : 0) + (series3Unlocked() ? 1 : 0)} / 3 해금`;
  const ob = $('op-badge');
  if (ob) ob.classList.toggle('hidden', !opMode);
  $('title-sub').textContent = title ? `🎖️ ${title}` : '하늘 끝까지 올라가 보세요';
}

function refreshControlUI() {
  $('ctrl-touch').classList.toggle('active', controlMode === 'touch');
  $('ctrl-tilt').classList.toggle('active', controlMode === 'tilt');
  $('control-desc').innerHTML = controlMode === 'touch'
    ? '◀ ▶ 버튼 또는 화면 좌/우 터치(← → 방향키)로 이동<br>🔫 오른쪽 아래 버튼(또는 스페이스바)으로 발사'
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
  document.querySelectorAll('#shop-screen .btn-buy').forEach((btn) => {
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
        btn.textContent = `🪙 ${PRICES[item].toLocaleString()}`;
      }
      return;
    }
    btn.disabled = wallet < PRICES[item] || inv[item] >= MAX_OWN[item];
    btn.textContent = inv[item] >= MAX_OWN[item] ? '최대 보유' : `🪙 ${PRICES[item].toLocaleString()}`;
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
  checkAchievements(); // 패션 도전과제
  sfx.buy();
  refreshShop();
}

// ---------- 강화 화면 ----------
// 강화 마일스톤 해금 토스트 (강화 화면 안에서 보여줌)
function showUpgToast(text) {
  document.querySelectorAll('.upg-toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'upg-toast';
  t.textContent = `🔓 해금! ${text}`;
  $('upg-screen').appendChild(t);
  setTimeout(() => t.remove(), 2800);
  sfx.bonus();
  vib(70);
}

function renderUpgrades() {
  $('upg-balance').textContent = String(wallet);
  const list = $('upg-list');
  list.innerHTML = '';
  for (const [key, def] of Object.entries(UPGRADES)) {
    const lv = upg[key];
    const maxed = lv >= def.max;
    const cost = maxed ? 0 : upgCost(key);
    const el = document.createElement('div');
    el.className = 'shop-item';
    const perksHtml = def.perks
      ? Object.entries(def.perks).map(([pl, pt]) =>
          `<span class="upg-perk${lv >= +pl ? ' on' : ''}">${lv >= +pl ? '✅' : '🔒'} Lv${pl} · ${pt}</span>`).join('')
      : '';
    el.innerHTML = `
      <div class="shop-info">
        <span class="shop-name">${def.icon} ${def.name} <small>Lv.${lv} / ${def.max}</small></span>
        <span class="shop-desc">${def.desc}</span>
        <div class="upg-bar"><div style="width:${Math.round((lv / def.max) * 100)}%"></div></div>
        ${perksHtml ? `<div class="upg-perks">${perksHtml}</div>` : ''}
      </div>
      <button class="btn-buy" ${maxed || wallet < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `🪙 ${cost.toLocaleString()}`}</button>`;
    el.querySelector('button').addEventListener('click', () => {
      if (maxed || wallet < cost) return;
      wallet -= cost;
      upg[key]++;
      saveWallet();
      saveUpg();
      checkAchievements(); // 강화 도전과제
      sfx.buy();
      if (def.perks && def.perks[upg[key]]) showUpgToast(def.perks[upg[key]]); // 마일스톤 도달!
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
      checkAchievements(); // 캐릭터 수집 도전과제
      sfx.buy();
      renderChars();
    });
    list.appendChild(el);
  }
}

// ---------- 내 정보 화면 ----------
const COSMETIC_NAMES = {
  bow: '🎀 리본', hat: '🧢 빨간 모자', headphones: '🎧 헤드폰', tophat: '🎩 마술사 모자',
  crown: '👑 왕관', glasses: '😎 선글라스', scarf: '🧣 목도리', cape: '🦸 빨간 망토', wings: '🪽 천사 날개',
  partyhat: '🥳 고깔모자', beret: '🎨 베레모', bunnyears: '🐰 토끼 귀 머리띠', propeller: '🚁 프로펠러 모자',
  viking: '⚔️ 바이킹 투구', halo: '😇 천사 링', monocle: '🧐 외눈 안경', heartglasses: '😍 하트 안경',
  mustache: '🥸 콧수염', bowtie: '🤵 나비넥타이', pearl: '📿 진주 목걸이', backpack: '🎒 책가방',
  balloonpack: '🎈 풍선 세트', trail_spark: '✨ 반짝이 발자국', trail_bubble: '🫧 비눗방울 발자국', trail_note: '🎵 음표 발자국',
};
let meTimer = null;

function renderMePreview() {
  const pv = $('me-preview');
  const pctx = pv.getContext('2d');
  const mainCtx = ctx;
  ctx = pctx; // 액세서리 그리기 함수들이 전역 ctx를 쓰므로 잠시 교체
  try {
    pctx.clearRect(0, 0, 180, 180);
    if (state === State.MENU) frame++; // 망토/날개 애니메이션용
    pctx.save();
    pctx.translate(90, 96);
    pctx.scale(2.7, 2.7);
    drawAccessoriesBack();
    if (charImgs.left) pctx.drawImage(charImgs.left, -23, -23, 46, 46);
    drawAccessoriesFront();
    pctx.restore();
  } finally {
    ctx = mainCtx;
  }
}

let meTab = 'base';
function renderMe() {
  const C = CHARACTERS[curChar];
  const title = localStorage.getItem('jump-title');
  $('me-name').innerHTML = `${C.emoji} ${C.name}${title ? ` <small>🎖️ ${title}</small>` : ''}<small>${C.desc}</small>`;

  // 자원 바 (생명/로켓/자석 보유량)
  const bar = (label, cls, n, max) => `
    <div class="res-row">
      <span class="res-label">${label}</span>
      <div class="res-track ${cls}"><div style="width:${Math.round((Math.min(n, max) / max) * 100)}%"></div></div>
      <span class="res-val">${n}/${max}</span>
    </div>`;
  $('me-bars').innerHTML =
    bar('❤️ 생명', 'res-life', inv.life, 3) +
    bar('🚀 로켓', 'res-rocket', inv.rocket, 9) +
    bar('🧲 자석', 'res-magnet', inv.magnet, 9);

  $('me-tab-base').classList.toggle('active', meTab === 'base');
  $('me-tab-gear').classList.toggle('active', meTab === 'gear');
  $('me-tab-rec').classList.toggle('active', meTab === 'rec');

  if (meTab === 'base') {
    // 실효 수치 스탯 그리드 (강화·캐릭터 능력 반영)
    const jumpPct = +(upg.jump * 0.4 + (upg.jump >= 10 ? 3 : 0) + (upg.jump >= 30 ? 3 : 0) + (upg.jump >= 50 ? 4 : 0) + (curChar === 'rabbit' ? 10 : 0)).toFixed(1);
    const coinPct = upg.coinup + (curChar === 'penguin' ? 10 : 0);
    const cell = (icon, name, val, boost) =>
      `<div class="stat-cell${boost ? ' boost' : ''}"><span>${icon} ${name}</span><b>${val}</b></div>`;
    $('me-info').innerHTML = `<div class="stat-grid">
      ${cell('🦵', '점프력', jumpPct > 0 ? `+${jumpPct}%` : '기본', jumpPct > 0)}
      ${cell('✨', '점프 이펙트', ['기본', '반짝이', '무지개', '별빛 폭발'][jumpFxTier()], jumpFxTier() > 0)}
      ${cell('💰', '코인 획득', coinPct > 0 ? `+${coinPct}%` : '기본', coinPct > 0)}
      ${cell('🔫', '탄창', `${ammoMax()}발${hasDoubleShot() ? ' ×2' : ''}`, upg.ammo > 0)}
      ${cell('⚡', '번개', upg.thunder > 0 ? `콤보${thunderNeed()} ${thunderBolts()}발` : '🔒 미해금', upg.thunder > 0)}
      ${cell('🛡️', '보호막', shieldMax() > 0 ? `${shieldMax()}회/판` : '🔒 미해금', shieldMax() > 0)}
      ${cell('⏱️', '재장전', `${(reloadTime() / 60).toFixed(2)}초`, upg.reload > 0)}
      ${cell('🧲', '기본 자석', upg.magnet > 0 ? `${28 + upg.magnet * 2}px` : '없음', upg.magnet > 0)}
      ${cell('🧯', '내열', upg.fireslow > 0 ? `-${(upg.fireslow * 0.8).toFixed(1)}%` : '기본', upg.fireslow > 0)}
      ${cell('❤️', '부활 무적', `${((REVIVE_INVINCIBLE + Math.round(upg.revive * 3.6)) / 60).toFixed(1)}초`, upg.revive > 0)}
      ${cell('🚀', '출발 부스트', upg.rocket > 0 ? `+${(upg.rocket * 0.05).toFixed(2)}초` : '없음', upg.rocket > 0)}
      ${cell('⭐', '스타 목표', `${starGoalNow()}개`, upg.star > 0)}
      ${cell('🐾', '특성', C.name === '둥이' ? '밸런스' : C.desc.split(' ·')[0], curChar !== 'dungi')}
    </div>`;
  } else if (meTab === 'gear') {
    const worn = COSMETICS.filter((k) => equip[k] && inv[k]).map((k) => COSMETIC_NAMES[k]);
    const ownedN = COSMETICS.filter((k) => inv[k]).length;
    $('me-info').innerHTML = `<div class="me-section"><h3>👒 착용 중 (보유 ${ownedN}/${COSMETICS.length})</h3>
      ${worn.length ? worn.map((w) => `<div class="me-row"><span>${w}</span><b>착용 ✓</b></div>`).join('') : '<div class="me-row"><span>없음 — 상점에서 꾸며보세요!</span></div>'}
    </div>`;
  } else {
    let cloudLabel = { ok: '✅ 연동됨', off: '⚠️ 서버 설정 대기', err: '⚠️ 연결 오류', init: '⏳ 연결 중...' }[cloud.status] || '-';
    if (cloud.lastErr && cloud.status !== 'ok') cloudLabel += ` (${String(cloud.lastErr).slice(0, 40)})`;
    if (opMode) cloudLabel = '🕹️ 운영자 모드 (백업 일시중지)';
    const lastSync = cloud.lastSyncAt ? new Date(cloud.lastSyncAt).toLocaleTimeString('ko-KR') : '아직 없음';
    $('me-info').innerHTML = `<div class="me-section"><h3>☁️ 계정 백업</h3>
      <div class="me-row"><span>상태</span><b>${cloudLabel}</b></div>
      <div class="me-row"><span>계정 ID</span><b>${cloud.uid ? cloud.uid.slice(0, 8) : '-'}</b></div>
      <div class="me-row"><span>마지막 백업</span><b>${lastSync}</b></div>
      <div class="cloud-btns">
        <button id="btn-cloud-save">☁️ 지금 백업</button>
        <button id="btn-cloud-load">⤵️ 서버에서 복원</button>
      </div>
      <p class="cloud-hint">문제가 생기면 계정 ID와 함께 문의하세요 — 서버에서 고친 뒤 복원하면 됩니다.</p>
    </div>` + `<div class="me-section"><h3>📊 누적 기록</h3>
      <div class="me-row"><span>🏆 최고 기록</span><b>${best.toLocaleString()}</b></div>
      <div class="me-row"><span>🎮 플레이 횟수</span><b>${stats.runs.toLocaleString()}판</b></div>
      <div class="me-row"><span>📈 누적 점수</span><b>${stats.totalScore.toLocaleString()}</b></div>
      <div class="me-row"><span>🪙 누적 코인</span><b>${stats.coins.toLocaleString()}</b></div>
      <div class="me-row"><span>👾 몬스터 처치</span><b>${stats.kills.toLocaleString()}</b></div>
      <div class="me-row"><span>🔥 최고 콤보</span><b>x${stats.maxCombo}</b></div>
      <div class="me-row"><span>🎯 미션 완수</span><b>${stats.missions}</b></div>
      <div class="me-row"><span>📖 도감</span><b>${dex.size}/${Object.keys(DEX).length}</b></div>
      <div class="me-row"><span>🌕 달 착륙</span><b>${stats.moon ? '성공!' : '아직'}</b></div>
    </div>`;
    // ☁️ 백업/복원 버튼
    $('btn-cloud-save').addEventListener('click', async () => {
      $('btn-cloud-save').textContent = '☁️ 백업 중...';
      const okS = await cloudSync(true);
      $('btn-cloud-save').textContent = okS ? '✅ 백업 완료!' : '⚠️ 실패 (연결 확인)';
      setTimeout(() => renderMe(), 1500);
    });
    $('btn-cloud-load').addEventListener('click', async () => {
      if (!confirm('서버에 저장된 데이터로 되돌릴까요?\n(현재 기기의 진행 상황을 덮어씁니다)')) return;
      $('btn-cloud-load').textContent = '⤵️ 복원 중...';
      const r = await cloudRestore();
      if (r.ok) {
        alert('복원 완료! 게임을 다시 불러옵니다.');
        location.reload();
      } else {
        $('btn-cloud-load').textContent = r.empty ? '⚠️ 서버에 저장본 없음' : '⚠️ 실패 (연결 확인)';
        setTimeout(() => renderMe(), 1800);
      }
    });
  }
  renderMePreview();
}

// ---------- 도감 화면 ----------
function renderDex() {
  const grid = $('dex-grid');
  grid.innerHTML = '';
  const total = Object.keys(DEX).length;
  $('dex-count').textContent = `완성: ${dex.size} / ${total} — 목표를 채우면 등록됩니다!`;
  for (const [id, [emoji, name, target, hint]] of Object.entries(DEX)) {
    const found = dex.has(id);
    const n = Math.min(dexN[id] || 0, target);
    const el = document.createElement('div');
    el.className = 'dex-card' + (found ? '' : ' locked');
    el.innerHTML = found
      ? `<span class="dex-emoji">${emoji}</span><span class="dex-name">${name}</span><span class="dex-prog done">완성!</span>`
      : `<span class="dex-emoji">❓</span><span class="dex-name">${hint} ${target}회</span>
         <div class="dex-bar"><div style="width:${Math.round((n / target) * 100)}%"></div></div>
         <span class="dex-prog">${n}/${target}</span>`;
    grid.appendChild(el);
  }
}

// ---------- 설정 화면 ----------
function refreshSettingsUI() {
  const map = [
    ['set-sfx-on', settings.sfx], ['set-sfx-off', !settings.sfx],
    ['set-music-on', settings.music], ['set-music-off', !settings.music],
    ['set-vib-on', settings.vib], ['set-vib-off', !settings.vib],
    ['set-tilt-low', settings.tilt === 'low'], ['set-tilt-mid', settings.tilt === 'mid'], ['set-tilt-high', settings.tilt === 'high'],
    ['set-hand-r', !settings.lefty], ['set-hand-l', settings.lefty],
  ];
  for (const [id, on] of map) $(id).classList.toggle('active', on);
  $('master-panel').classList.toggle('hidden', !masterMode);
  $('mp-op').textContent = `🕹️ 운영자 모드: ${opMode ? 'ON' : 'OFF'}`;
  $('mp-op').classList.toggle('on', opMode);
  refreshControlUI();
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
    const curTitle = localStorage.getItem('jump-title') || '';
    el.innerHTML = `
      <div class="ach-top">
        <span class="ach-name">${done ? '✅ ' : ''}${a.name}</span>
        ${done ? `<button class="ach-title-btn${curTitle === a.name ? ' on' : ''}">${curTitle === a.name ? '대표 칭호 ✓' : '칭호로 설정'}</button>` : `<span class="ach-reward">🪙 ${a.reward}</span>`}
      </div>
      <div class="ach-desc">${a.desc}</div>
      <div class="ach-bar"><div style="width:${Math.round((cur / a.target) * 100)}%"></div></div>
      <div class="ach-prog">${cur.toLocaleString()} / ${a.target.toLocaleString()}</div>`;
    const tbtn = el.querySelector('.ach-title-btn');
    if (tbtn) tbtn.addEventListener('click', () => {
      const now = localStorage.getItem('jump-title') === a.name;
      if (now) localStorage.removeItem('jump-title');
      else localStorage.setItem('jump-title', a.name);
      sfx.buy();
      renderAchievements();
      refreshMenu();
    });
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
  showMoveBtns(true);
  updateFireBtn();
  photoMode = false;
  bgm.start();
  if (tut) announce('👆 좌우로 움직여 발판을 밟아요!', '#2c3e50', 260);
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
  if (state !== State.PLAYING && state !== State.RPS && state !== State.ENDING) return;
  const run2Before = series2Unlocked(); // best 갱신 전에 판정
  state = State.OVER;
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
  if (dailyMode) stats.dailyRuns = (stats.dailyRuns || 0) + 1;
  stats.totalScore += score;
  if (score > stats.bestScore) stats.bestScore = score;
  const run2Now = !run2Before && series2Unlocked(); // 이번 판으로 시리즈2 해금!
  if (score >= 14000) stats.space = true;
  saveStats();
  checkAchievements();
  $('gameover-title').textContent = cleared ? '🌕 달 착륙 성공!' : '게임 오버';
  $('final-score').textContent = String(score);
  $('final-coins').textContent = String(runCoins);
  $('final-best').textContent = `최고 기록 ${best}`;
  $('final-stats').textContent =
    `🔥 최고 콤보 x${runMaxCombo} · 👾 처치 ${runKills}` +
    (runBosses ? ` · 👹 보스 ${runBosses}` : '') + ` · ⭐ 별 ${runStars}` +
    (run2Now ? ' · 🌕 시리즈2 문 런 해금!' : '');
  $('new-record').classList.toggle('hidden', !isRecord);
  overScreen.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
  showMoveBtns(false);
  autoSubmitScore();
  cloudSync(false); // ☁️ 판 종료 시 백업
}

function goHome() {
  runnerMode = false;
  fighterMode = false;
  R = null;
  F = null;
  $('run-btns').classList.add('hidden');
  updateRunnerOrientation(); // 세로 복귀
  state = State.MENU;
  bgm.stop();
  overScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  helpScreen.classList.add('hidden');
  $('ach-screen').classList.add('hidden');
  $('lb-screen').classList.add('hidden');
  $('upg-screen').classList.add('hidden');
  $('char-screen').classList.add('hidden');
  $('settings-screen').classList.add('hidden');
  $('dex-screen').classList.add('hidden');
  $('me-screen').classList.add('hidden');
  if (meTimer) { clearInterval(meTimer); meTimer = null; }
  pauseBtn.classList.add('hidden');
  fireBtn.classList.add('hidden');
  showMoveBtns(false);
  startScreen.classList.remove('hidden');
  newGame(); // 메뉴 배경을 새 장면으로 (state가 MENU라 아이템 소비 없음)
  refreshMenu();
}



// ==================== 시리즈 3: 스타 파이터 (1942식 종스크롤 슈팅) ====================
// 문 런에서 탑승한 우주선으로 출격! 좌우로 움직이며 자동 발사로 적을 격추한다.
let fighterMode = false;
let F = null;
let best3 = parseInt(localStorage.getItem('jump-best3') || '0', 10);

function startFighter() {
  fighterMode = true;
  runnerMode = false;
  dailyMode = false;
  state = State.COUNTDOWN;
  initFighter();
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
  fireBtn.classList.add('hidden');
  $('run-btns').classList.add('hidden');
  showMoveBtns(true); // ◀ ▶ 버튼으로도 조종
  updateRunnerOrientation();
  photoMode = false;
  bgm.start();
}

function initFighter() {
  cameraY = 0;
  frame = 0;
  shakeT = 0;
  floatTexts = [];
  particles = [];
  msgQueue = [];
  curMsg = null;
  F = {
    x: W / 2, tx: W / 2, vh: 640,
    hearts: 3, inv: 0, score: 0, coins: 0,
    fireT: 0, spawnT: 60, t: 0,
    bullets: [], ebullets: [], enemies: [], drops: [], booms: [],
    pow: { double: 0, spread: 0, shield: 0 },
    boss: null, nextBoss: 800, bossN: 0, hinted: false,
    stars: Array.from({ length: 70 }, () => ({
      x: Math.random() * W, y: Math.random() * 800,
      r: Math.random() * 1.5 + 0.5, sp: Math.random() < 0.5 ? 1.6 : 3.2,
    })),
    nebulas: Array.from({ length: 4 }, (_, i) => ({
      x: (i * 137 + 60) % W, y: i * 260,
      r: 70 + (i % 2) * 40, hue: [265, 195, 320, 230][i], sp: 0.5 + (i % 2) * 0.25,
    })),
  };
}

function fighterShipY() { return F.vh - 130; }

function fighterHit() {
  if (F.inv > 0) return;
  if (F.pow.shield > 0) { // 실드가 대신 맞음
    F.pow.shield--;
    F.inv = 60;
    addBurst(F.x, fighterShipY(), '#74b9ff');
    beep(900, 0.12, 'triangle', 0.14);
    return;
  }
  F.hearts--;
  F.inv = 100;
  shakeT = 12;
  sfx.hit();
  vib(90);
  addBurst(F.x, fighterShipY(), '#e74c3c');
  if (F.hearts <= 0) {
    F.booms.push({ x: F.x, y: fighterShipY(), r: 4, life: 26 });
    fighterOver();
  }
}

function fighterOver() {
  state = State.OVER;
  bgm.stop();
  vib(160);
  const sc = F.score;
  const isRecord = sc > best3;
  if (isRecord) {
    best3 = sc;
    localStorage.setItem('jump-best3', String(best3));
  }
  stats.fighterRuns = (stats.fighterRuns || 0) + 1;
  if (sc > (stats.fighterBest || 0)) stats.fighterBest = sc;
  saveStats();
  checkAchievements();
  $('gameover-title').textContent = '🛸 스타 파이터 종료!';
  $('final-score').textContent = String(sc);
  $('final-coins').textContent = String(F.coins);
  $('final-best').textContent = `최고 기록 ${best3}`;
  $('final-stats').textContent = `🛸 격추 점수 ${sc} · 🪙 ${F.coins}개 · 👹 보스 ${F.bossN}`;
  $('new-record').classList.toggle('hidden', !isRecord);
  overScreen.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  showMoveBtns(false);
  autoSubmitScore(sc, 'fighter');
  cloudSync(false);
}

function fighterSpawnEnemy(kind, x, extra = {}) {
  const d = Math.min(1, F.score / 3000);
  const base = {
    pod: { hp: 1, vy: 2.1 + d * 1.4, w: 26, h: 22, pts: 10 },
    ufo: { hp: 2, vy: 1.7 + d, w: 30, h: 20, pts: 15 },
    shooter: { hp: 3, vy: 1.1 + d * 0.6, w: 30, h: 26, pts: 20, shot: 70 },
    rock: { hp: 4, vy: 1.5 + d * 0.8, w: 36, h: 34, pts: 25 },
  }[kind];
  F.enemies.push(Object.assign({ kind, x, y: -30, ph: rand(0, 6), sway: rand(0.8, 1.6) }, base, extra));
}

function updateFighter() {
  frame++;
  F.t++;
  F.vh = canvas.height / scale;
  if (cheatGod && F.inv < 30) F.inv = 30;
  const d = Math.min(1, F.score / 3000);
  const sy = fighterShipY();

  if (!F.hinted) {
    F.hinted = true;
    announce('◀ ▶ 버튼이나 드래그로 조종 — 발사는 자동!', '#2c3e50', 220);
  }

  // --- 조종: 버튼/방향키/기울기 + 드래그 목표 ---
  const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0) + (controlMode === 'tilt' ? input.tilt : 0);
  if (dir !== 0) {
    F.x += dir * 5.2;
    F.tx = F.x;
  } else {
    F.x += (F.tx - F.x) * 0.25; // 드래그 목표 추적
  }
  F.x = clamp(F.x, 20, W - 20);

  // --- 자동 발사 ---
  if (--F.fireT <= 0) {
    F.fireT = F.pow.double > 0 ? 7 : 9;
    const mk = (bx, vx = 0) => F.bullets.push({ x: bx, y: sy - 18, vy: -11, vx });
    if (F.pow.double > 0) { mk(F.x - 7); mk(F.x + 7); }
    else mk(F.x);
    if (F.pow.spread > 0) { mk(F.x - 4, -2.2); mk(F.x + 4, 2.2); }
    beep(1150, 0.03, 'square', 0.04);
  }
  for (const k of ['double', 'spread']) if (F.pow[k] > 0) F.pow[k]--;

  // --- 적 스폰 (보스 중엔 정지) ---
  if (!F.boss && --F.spawnT <= 0) {
    F.spawnT = Math.round(rand(34, 60) * (1 - d * 0.45));
    const roll = Math.random();
    if (roll < 0.3) {
      fighterSpawnEnemy('pod', rand(30, W - 30));
    } else if (roll < 0.48 && d > 0.1) { // V자 편대
      const cx = rand(80, W - 80);
      for (let i = -2; i <= 2; i++) fighterSpawnEnemy('pod', cx + i * 34, { y: -30 - Math.abs(i) * 26 });
      F.spawnT += 30;
    } else if (roll < 0.66) {
      fighterSpawnEnemy('ufo', rand(40, W - 40));
    } else if (roll < 0.84 && d > 0.15) {
      fighterSpawnEnemy('shooter', rand(40, W - 40));
    } else {
      fighterSpawnEnemy('rock', rand(40, W - 40));
    }
  }

  // --- 보스 등장 ---
  if (!F.boss && F.score >= F.nextBoss) {
    F.bossN++;
    F.boss = {
      hp: 26 + F.bossN * 14, maxHp: 26 + F.bossN * 14,
      x: W / 2, y: -60, vx: 1.6 + F.bossN * 0.3, shot: 70, ph: 0,
    };
    F.nextBoss += 1200 + F.bossN * 400;
    announce(`👹 모선 출현! (${F.bossN}차)`, '#c0392b', 140);
    beep(70, 0.5, 'sawtooth', 0.2);
    vib([180, 70, 320]);
    shakeT = 18;
  }
  if (F.boss) {
    const b = F.boss;
    if (b.y < 90) b.y += 1.6;
    b.x += b.vx;
    if (b.x < 60 || b.x > W - 60) b.vx *= -1;
    if (--b.shot <= 0) {
      b.shot = Math.max(42, 68 - F.bossN * 5);
      b.ph = (b.ph + 1) % 3;
      if (b.ph === 0) { // 조준탄
        const a = Math.atan2(sy - b.y, F.x - b.x);
        F.ebullets.push({ x: b.x, y: b.y + 24, vx: Math.cos(a) * 3.4, vy: Math.sin(a) * 3.4 });
      } else if (b.ph === 1) { // 부채꼴
        for (const vx of [-2.2, -1.1, 0, 1.1, 2.2]) F.ebullets.push({ x: b.x, y: b.y + 24, vx, vy: 3 });
      } else { // 양옆 낙하
        F.ebullets.push({ x: b.x - 40, y: b.y + 10, vx: 0, vy: 3.4 });
        F.ebullets.push({ x: b.x + 40, y: b.y + 10, vx: 0, vy: 3.4 });
      }
      beep(200, 0.07, 'square', 0.1);
    }
  }

  // --- 적 이동 + 슈터 발사 ---
  for (const e of F.enemies) {
    e.y += e.vy;
    if (e.kind === 'ufo') e.x += Math.sin(frame * 0.06 + e.ph) * e.sway * 2.2;
    if (e.kind === 'rock') e.ph += 0.04;
    if (e.kind === 'shooter' && --e.shot <= 0) {
      e.shot = 95;
      const a = Math.atan2(sy - e.y, F.x - e.x);
      F.ebullets.push({ x: e.x, y: e.y + 12, vx: Math.cos(a) * 2.9, vy: Math.sin(a) * 2.9 });
      beep(300, 0.05, 'square', 0.07);
    }
    e.x = clamp(e.x, 16, W - 16);
    // 기체 충돌
    if (F.inv <= 0 && Math.abs(e.x - F.x) < (e.w + 26) / 2 - 4 && Math.abs(e.y - sy) < (e.h + 30) / 2 - 4) {
      e.hp = 0;
      e.dead = true;
      F.booms.push({ x: e.x, y: e.y, r: 4, life: 20 });
      fighterHit();
    }
  }
  F.enemies = F.enemies.filter((e) => !e.dead && e.y < F.vh + 50);

  // --- 플레이어 총알 ---
  for (const b of F.bullets) {
    b.y += b.vy;
    b.x += b.vx || 0;
    // 보스 피격
    if (F.boss && Math.abs(b.x - F.boss.x) < 52 && Math.abs(b.y - F.boss.y) < 30) {
      b.gone = true;
      F.boss.hp--;
      if (frame % 3 === 0) particles.push({ x: b.x, y: b.y, vx: rand(-1, 1), vy: rand(-1.5, 0), life: 10, color: '#ffe66d' });
      if (F.boss.hp <= 0) {
        F.booms.push({ x: F.boss.x, y: F.boss.y, r: 10, life: 34 });
        F.score += 300;
        const reward = 15 + F.bossN * 5;
        F.coins += reward;
        wallet += reward;
        stats.coins += reward;
        saveWallet();
        addFloat(`👹 모선 격파! +300점 +${reward}🪙`, W / 2, 180, '#e67e22', 17, true, 90);
        sfx.bonus();
        vib(140);
        shakeT = 16;
        F.boss = null;
      }
      continue;
    }
    for (const e of F.enemies) {
      if (e.dead) continue;
      if (Math.abs(b.x - e.x) < e.w / 2 + 3 && Math.abs(b.y - e.y) < e.h / 2 + 4) {
        b.gone = true;
        e.hp--;
        e.flash = 5; // ⚡ 피격 흰 플래시
        if (e.hp <= 0) {
          e.dead = true;
          F.score += e.pts;
          F.booms.push({ x: e.x, y: e.y, r: 3, life: 18 });
          addFloat(`+${e.pts}`, e.x, e.y - 14, '#ffe66d', 13, true, 40); // 격추 점수 팝업
          sfx.hit();
          const dropRoll = Math.random();
          if (dropRoll < 0.3) F.drops.push({ x: e.x, y: e.y, vy: 2.2, kind: 'coin', spin: rand(0, 6) });
          else if (dropRoll < 0.34) F.drops.push({ x: e.x, y: e.y, vy: 1.8, kind: ['double', 'spread', 'shield', 'heart'][Math.floor(Math.random() * 4)] });
        } else {
          particles.push({ x: b.x, y: b.y, vx: 0, vy: -1, life: 8, color: '#fff' });
        }
        break;
      }
    }
  }
  F.bullets = F.bullets.filter((b) => !b.gone && b.y > -30);

  // --- 적 탄환 ---
  for (const eb of F.ebullets) {
    eb.x += eb.vx;
    eb.y += eb.vy;
    if (F.inv <= 0 && Math.hypot(eb.x - F.x, eb.y - sy) < 16) {
      eb.gone = true;
      fighterHit();
    }
  }
  F.ebullets = F.ebullets.filter((eb) => !eb.gone && eb.y < F.vh + 30 && eb.y > -30 && eb.x > -20 && eb.x < W + 20);

  // --- 드롭 (코인·파워업) ---
  for (const dp of F.drops) {
    dp.y += dp.vy;
    dp.spin = (dp.spin || 0) + 0.15;
    if (Math.hypot(dp.x - F.x, dp.y - sy) < 26) {
      dp.gone = true;
      if (dp.kind === 'coin') {
        F.coins++;
        wallet++;
        stats.coins++;
        saveWallet();
        sfx.coin();
      } else if (dp.kind === 'heart') {
        F.hearts = Math.min(3, F.hearts + 1);
        sfx.revive();
        addFloat('❤️ +1', dp.x, dp.y - 14, '#e74c3c', 15, true, 50);
      } else if (dp.kind === 'shield') {
        F.pow.shield = Math.min(2, F.pow.shield + 1);
        beep(900, 0.12, 'triangle', 0.14);
        addFloat('🛡️ 실드!', dp.x, dp.y - 14, '#3f8efc', 15, true, 50);
      } else {
        F.pow[dp.kind] = 600; // 10초
        sfx.bonus();
        addFloat(dp.kind === 'double' ? '🔫 더블샷!' : '🎯 스프레드!', dp.x, dp.y - 14, '#8e44ad', 15, true, 50);
      }
    }
  }
  F.drops = F.drops.filter((dp) => !dp.gone && dp.y < F.vh + 30);

  // 엔진 트레일 (기체 뒤로 이온 꼬리)
  if (frame % 2 === 0) {
    particles.push({
      x: F.x + rand(-3.5, 3.5), y: sy + 22,
      vx: rand(-0.3, 0.3), vy: rand(2.2, 3.6),
      life: rand(10, 18),
      color: Math.random() < 0.5 ? 'rgba(120, 200, 255, 0.85)' : 'rgba(255, 190, 110, 0.85)',
    });
  }

  // --- 생존 점수 + 연출 ---
  if (F.t % 30 === 0) F.score++;
  if (F.inv > 0) F.inv--;
  if (shakeT > 0) shakeT--;
  for (const bm of F.booms) { bm.life--; bm.r += 2.6; }
  F.booms = F.booms.filter((bm) => bm.life > 0);
  for (const pt of particles) { pt.x += pt.vx; pt.y += pt.vy; pt.life--; }
  particles = particles.filter((pt) => pt.life > 0);
  for (const f of floatTexts) { f.life--; if (!f.screen) f.y -= 0.4; }
  floatTexts = floatTexts.filter((f) => f.life > 0);
  tickAnnounce();
}

function drawFighter() {
  ctx.save();
  ctx.scale(scale, scale);
  const VH = canvas.height / scale;
  if (shakeT > 0) ctx.translate(rand(-3, 3), rand(-3, 3));

  // 우주 배경 + 스크롤 별
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#070a1f');
  bg.addColorStop(0.6, '#141a3d');
  bg.addColorStop(1, '#232a5c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, VH);
  // 🌫️ 성운 구름 (은은한 색 안개, 느리게 흐름)
  for (const nb of (F ? F.nebulas : [])) {
    const nyp = ((nb.y + F.t * nb.sp) % (VH + nb.r * 2)) - nb.r;
    const ng = ctx.createRadialGradient(nb.x, nyp, 4, nb.x, nyp, nb.r);
    ng.addColorStop(0, `hsla(${nb.hue}, 70%, 60%, 0.13)`);
    ng.addColorStop(1, `hsla(${nb.hue}, 70%, 60%, 0)`);
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(nb.x, nyp, nb.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of (F ? F.stars : [])) {
    const syp = (s.y + F.t * s.sp) % (VH + 20) - 10;
    ctx.globalAlpha = s.sp > 2 ? 0.9 : 0.5;
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x, syp, s.r, s.r * (s.sp > 2 ? 4 : 2)); // 별이 아래로 흘러 속도감
  }
  ctx.globalAlpha = 1;
  if (!F) { ctx.restore(); return; }
  const sy = fighterShipY();

  // 적 탄환
  for (const eb of F.ebullets) {
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowColor = 'rgba(255, 80, 80, 0.8)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(eb.x, eb.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd5d5';
    ctx.beginPath();
    ctx.arc(eb.x - 1.2, eb.y - 1.2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 플레이어 총알
  for (const b of F.bullets) {
    ctx.fillStyle = 'rgba(120, 220, 255, 0.5)';
    ctx.fillRect(b.x - 1.5, b.y + 4, 3, 10);
    ctx.shadowColor = 'rgba(120, 220, 255, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#d9f4ff';
    ctx.fillRect(b.x - 2, b.y - 6, 4, 11);
    ctx.shadowBlur = 0;
  }

  // 적들
  for (const e of F.enemies) {
    if (e.flash > 0) e.flash--;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.flash > 0) ctx.filter = 'brightness(2.2)'; // 피격 플래시
    if (e.kind === 'pod') {
      ctx.fillStyle = '#a06bc4';
      ctx.strokeStyle = '#6c3483';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(-12, -8);
      ctx.quadraticCurveTo(0, -16, 12, -8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffdd59';
      ctx.beginPath();
      ctx.arc(0, -3, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === 'ufo') {
      ctx.fillStyle = '#57e0a3';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b8ffd9';
      ctx.beginPath();
      ctx.ellipse(0, -5, 7, 5, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#2e8b60';
      for (const dx of [-8, 0, 8]) {
        ctx.beginPath();
        ctx.arc(dx, 2.5, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.kind === 'shooter') {
      ctx.fillStyle = '#e17055';
      ctx.strokeStyle = '#b0472f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-14, -6);
      ctx.lineTo(-6, -12);
      ctx.lineTo(6, -12);
      ctx.lineTo(14, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(-2.5, 8, 5, 8); // 포신
      ctx.fillStyle = '#ffeaa7';
      ctx.beginPath();
      ctx.arc(0, -2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else { // rock
      ctx.rotate(e.ph);
      ctx.fillStyle = '#8d7b6f';
      ctx.strokeStyle = '#5d5148';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-16, 2);
      ctx.lineTo(-9, -14);
      ctx.lineTo(6, -16);
      ctx.lineTo(17, -4);
      ctx.lineTo(12, 12);
      ctx.lineTo(-6, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(-4, -2, 3.5, 0, Math.PI * 2);
      ctx.arc(6, 5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.restore();
  }

  // 보스 모선
  if (F.boss) {
    const b = F.boss;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.shadowColor = 'rgba(192, 57, 43, 0.7)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#5b3b8e';
    ctx.beginPath();
    ctx.ellipse(0, 0, 52, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8d6bc4';
    ctx.beginPath();
    ctx.ellipse(0, -10, 26, 14, 0, Math.PI, 0);
    ctx.fill();
    const bl = Math.floor(frame / 7) % 5;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i === bl ? '#ff6b6b' : 'rgba(255, 221, 89, 0.8)';
      ctx.beginPath();
      ctx.arc(-36 + i * 18, 8, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 체력바
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(W / 2 - 70, 14, 140, 9, 4.5);
    ctx.fillStyle = '#e74c3c';
    roundRect(W / 2 - 70, 14, 140 * (b.hp / b.maxHp), 9, 4.5);
  }

  // 드롭
  for (const dp of F.drops) {
    ctx.save();
    ctx.translate(dp.x, dp.y);
    if (dp.kind === 'coin') {
      const sq = Math.max(Math.abs(Math.sin(dp.spin)), 0.3);
      ctx.scale(sq, 1);
      ctx.fillStyle = '#f1c40f';
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const col = { double: '#8e44ad', spread: '#e67e22', shield: '#3f8efc', heart: '#e74c3c' }[dp.kind];
      const label = { double: 'W', spread: 'S', shield: 'B', heart: '❤' }[dp.kind];
      ctx.shadowColor = col;
      ctx.shadowBlur = 9;
      ctx.fillStyle = col;
      roundRect(-9, -9, 18, 18, 5);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '900 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 1);
    }
    ctx.restore();
  }

  // 파티클 + 폭발 링
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life / 20, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  for (const bm of F.booms) {
    const a = clamp(bm.life / 24, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffb26b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(bm.x, bm.y, bm.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(bm.x, bm.y, bm.r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- 플레이어 우주선 (문 런에서 탄 그 우주선!) ---
  if (state !== State.OVER || F.hearts > 0) {
    ctx.save();
    ctx.translate(F.x, sy);
    if (F.inv > 0 && Math.floor(F.inv / 6) % 2 === 0) ctx.globalAlpha = 0.4;
    // 엔진 불꽃
    ctx.fillStyle = 'rgba(255, 159, 67, 0.9)';
    ctx.beginPath();
    ctx.moveTo(-6, 16);
    ctx.lineTo(0, 26 + Math.random() * 10);
    ctx.lineTo(6, 16);
    ctx.closePath();
    ctx.fill();
    // 몸체
    const sg = ctx.createLinearGradient(0, -22, 0, 18);
    sg.addColorStop(0, '#eef3fb');
    sg.addColorStop(0.6, '#b9c6da');
    sg.addColorStop(1, '#8fa0b8');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.quadraticCurveTo(13, -6, 11, 14);
    ctx.lineTo(-11, 14);
    ctx.quadraticCurveTo(-13, -6, 0, -24);
    ctx.fill();
    // 날개
    ctx.fillStyle = '#7f94b0';
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.lineTo(-22, 15);
    ctx.lineTo(-10, 13);
    ctx.moveTo(10, 4);
    ctx.lineTo(22, 15);
    ctx.lineTo(10, 13);
    ctx.fill();
    // 조종석 (내 캐릭터!)
    ctx.fillStyle = '#48c9e5';
    ctx.beginPath();
    ctx.arc(0, -4, 7, 0, Math.PI * 2);
    ctx.fill();
    if (charImgs.left) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, -4, 6, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(charImgs.left, -7.5, -12, 15, 15);
      ctx.restore();
    }
    // 실드
    if (F.pow.shield > 0) {
      ctx.strokeStyle = 'rgba(116, 185, 255, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -2, 26 + Math.sin(frame * 0.1) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 떠오르는 텍스트
  for (const f of floatTexts) {
    const fy = f.screen ? f.y : f.y - cameraY;
    ctx.save();
    ctx.globalAlpha = clamp(f.life / 40, 0, 1);
    ctx.font = `900 ${f.size}px sans-serif`;
    const hw = ctx.measureText(f.text).width / 2;
    const fx3 = clamp(f.x, hw + 4, W - hw - 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, fx3, fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, fx3, fy);
    ctx.restore();
  }
  if (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN) drawAnnounce();

  // HUD
  if (!photoMode && (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN)) {
    ctx.save();
    ctx.translate(0, safeTopL());
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(8, 8, 112, 34, 17);
    roundRect(8, 48, 92, 28, 14);
    ctx.fillStyle = '#2c3e50';
    ctx.font = '900 19px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(F.score), 22, 26);
    ctx.font = '800 15px sans-serif';
    ctx.fillStyle = '#b7791f';
    ctx.fillText('🪙 ' + F.coins, 18, 63);
    ctx.font = '17px sans-serif';
    ctx.fillText('❤️'.repeat(Math.max(0, F.hearts)) + '🖤'.repeat(Math.max(0, 3 - F.hearts))
      + (F.pow.shield > 0 ? `  🛡️${F.pow.shield}` : ''), 10, 92);
    // ⏳ 파워업 남은 시간 바
    drawTimerBars([
      { icon: '🔫', frac: F.pow.double > 0 ? F.pow.double / 600 : 0, color: '#8e44ad' },
      { icon: '🎯', frac: F.pow.spread > 0 ? F.pow.spread / 600 : 0, color: '#e67e22' },
    ], 52, W - 60);
    if (best3 > 0) {
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'right';
      ctx.fillText(`BEST ${best3}`, W - 60, 26);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  // 카운트다운
  if (state === State.COUNTDOWN) {
    const remain = Math.max(0, countdownUntil - performance.now());
    const n = Math.ceil(remain / 1000);
    ctx.fillStyle = 'rgba(7, 10, 31, 0.55)';
    ctx.fillRect(0, 0, W, VH);
    ctx.fillStyle = '#fff';
    ctx.font = '900 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), W / 2, VH / 2 - 60);
    ctx.font = '800 19px sans-serif';
    ctx.fillText('🛸 시리즈3 · 스타 파이터', W / 2, VH / 2 + 14);
    ctx.font = '700 15px sans-serif';
    ctx.fillStyle = '#cdd3ff';
    ctx.fillText('◀ ▶ 버튼 · 드래그로 조종', W / 2, VH / 2 + 44);
    ctx.fillText('발사는 자동! 파워업을 모으세요', W / 2, VH / 2 + 68);
  }
  ctx.restore();
}

// ==================== 시리즈 2: 문 런 (달 표면 러너) ====================
// 60,000점 엔딩 클리어 시 해금 — 오른쪽으로 자동 질주, 점프/슬라이드로 장애물 회피!
let runnerMode = false;
let R = null; // 러너 상태
let best2 = parseInt(localStorage.getItem('jump-best2') || '0', 10);
const R_VH = 360;       // 러너 논리 높이 (가로 화면 기준)
const R_GROUND = 296;   // 지면 y (발 위치)
const R_PX = 110;       // 플레이어 고정 x

// 시리즈2 해금: 시리즈1에서 10,000점 달성 (또는 달 착륙)
const RUN2_UNLOCK = 10000;
function series2Unlocked() {
  return stats.bestScore >= RUN2_UNLOCK || best >= RUN2_UNLOCK || stats.moon;
}
// 시리즈3 해금: 문 런 3,000m 우주선 탑승 (시리즈2 클리어)
const RUN2_GOAL = 3000;
function series3Unlocked() { return !!stats.run2Clear; }

// 문 런 가로 화면: 뷰포트가 세로면 CSS로 90° 회전 (폰을 돌려서 플레이)
function updateRunnerOrientation() {
  const gc = document.getElementById('game-container');
  const portraitVp = window.innerHeight >= window.innerWidth;
  // 러너 게임이 진행 중일 때만 가로. 종료(OVER) 화면에선 세로로 되돌려 오버레이 짤림 방지
  const activeRun = runnerMode && state !== State.OVER;
  gc.classList.toggle('landscape', activeRun && portraitVp);       // 세로 기기: 90° 회전
  gc.classList.toggle('landscape-full', activeRun && !portraitVp); // 가로 기기: 전체 폭 사용
  resize();
}
window.addEventListener('resize', updateRunnerOrientation);

function startRunner() {
  runnerMode = true;
  dailyMode = false;
  state = State.COUNTDOWN;
  initRunner();
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
  fireBtn.classList.add('hidden'); // 러너에선 총 없음
  showMoveBtns(false);
  $('run-btns').classList.remove('hidden'); // ⬆️⬇️ 러너 전용 버튼
  photoMode = false;
  updateRunnerOrientation(); // 가로 화면 전환
  bgm.start();
}

function initRunner() {
  cameraY = 0; // 떠오르는 텍스트/안내가 화면 좌표로 그려지도록
  frame = 0;
  shakeT = 0;
  floatTexts = [];
  particles = [];
  msgQueue = [];
  curMsg = null;
  R = {
    py: R_GROUND, vy: 0, jumps: 2, sliding: false, slideHeld: false,
    hearts: 3, inv: 0, dist: 0, coins: 0, coinFrac: 0,
    obstacles: [], pickups: [], gaps: [], craters: [],
    spawnT: 90, gapSafe: 0, starT: 0, hinted: false,
    vw: 640, rings: [], ship: null, clearT: 0,
    lastCls: [], lastExt: 0, lastSpawnF: -999, coyote: 0, pitFall: false,
    stars: Array.from({ length: 60 }, () => ({
      x: Math.random() * 800, y: Math.random() * (R_GROUND - 60),
      r: Math.random() * 1.4 + 0.5, tw: Math.random() * Math.PI * 2, layer: Math.random() < 0.5 ? 0.15 : 0.4,
    })),
  };
  // 시작 지면 크레이터 몇 개
  for (let i = 0; i < 4; i++) R.craters.push({ x: 60 + i * 110 + rand(-20, 20), w: rand(26, 50) });
}

function runnerSpeed() {
  return 5.2 + Math.min(6.0, R.dist / 1500); // 시원한 기본 속도 + 빠른 가속 (최대 11.2)
}

function runnerJump() {
  if (!runnerMode || state !== State.PLAYING || !R || R.jumps <= 0) return;
  R.vy = R.jumps === 2 ? -12.4 : -10.6;
  if (R.jumps === 1) R.rings.push({ x: R_PX, y: R.py - 8, r: 5, life: 16 }); // 더블 점프 링
  R.jumps--;
  R.sliding = false;
  (R.jumps === 1 ? sfx.jump : sfx.spring)();
  vib(15);
  for (let i = 0; i < 6; i++) {
    particles.push({ x: R_PX + rand(-10, 10), y: R.py, vx: rand(-1.5, 0.5), vy: rand(0.3, 1.6), life: rand(10, 18), color: '#cfd3dd' });
  }
}

function runnerOverGap() {
  return R.gaps.some((g) => R_PX - 5 > g.x && R_PX + 5 < g.x + g.w);
}

function runnerHit(kind) {
  if (R.inv > 0) return;
  R.hearts--;
  R.inv = 110;
  shakeT = 12;
  sfx.hit();
  vib(90);
  addBurst(R_PX, R.py - 24, '#e74c3c');
  addFloat(R.hearts > 0 ? '아야! ❤️ -1' : '으악!', R_PX + 30, R.py - 66, '#e74c3c', 15, true, 60);
  if (kind === 'pit') { // 구덩이: 위로 튕겨 복귀
    R.py = R_GROUND - 150;
    R.vy = 0;
    R.jumps = 2;
    R.pitFall = false;
    R.coyote = 0;
    R.gaps = R.gaps.filter((g) => g.x > R_PX + 160); // 같은 구덩이에 연속으로 빠지지 않게 발밑 정리
  }
  if (R.hearts <= 0) runnerOver();
}

function runnerOver(cleared2 = false, firstClear = false) {
  state = State.OVER;
  $('run-btns').classList.add('hidden');
  updateRunnerOrientation(); // 🔄 세로 복귀 → 종료 화면이 짤리지 않게
  bgm.stop();
  vib(160);
  const m = Math.floor(R.dist);
  const isRecord = m > best2;
  if (isRecord) {
    best2 = m;
    localStorage.setItem('jump-best2', String(best2));
  }
  stats.runnerRuns = (stats.runnerRuns || 0) + 1;
  if (m > (stats.runnerBest || 0)) stats.runnerBest = m;
  saveStats();
  checkAchievements();
  $('gameover-title').textContent = cleared2 ? '🚀 우주선 탑승 성공!' : '🌕 문 런 종료!';
  $('final-score').textContent = `${m}m`;
  $('final-coins').textContent = String(R.coins);
  $('final-best').textContent = `최고 기록 ${best2}m`;
  $('final-stats').textContent = `🏃 ${m}m 질주 · 🪙 ${R.coins}개 획득` +
    (firstClear ? ' · 🛸 시리즈3 스타 파이터 해금!' : cleared2 ? ' · 시리즈2 클리어!' : '');
  $('new-record').classList.toggle('hidden', !isRecord);
  overScreen.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  showMoveBtns(false);
  autoSubmitScore(m, 'runner'); // 문 런 랭킹 등록 (100m 미만 제외)
  cloudSync(false); // ☁️ 판 종료 시 백업
}

function updateRunner() {
  frame++;
  R.vw = canvas.width / (canvas.height / R_VH); // 가로 논리 폭 (기기별)
  if (cheatGod && R.inv < 30) R.inv = 30; // 🛠️ 운영자 무적
  const spd = runnerSpeed();
  const preM = Math.floor(R.dist / 500);
  R.dist += spd / 9; // 미터 환산
  if (Math.floor(R.dist / 500) > preM && R.dist < RUN2_GOAL - 150) { // 📍 500m 이정표
    const mMark = Math.floor(R.dist / 500) * 500;
    addFloat(`📍 ${mMark.toLocaleString()}m!`, R.vw / 2, 120, '#ffd832', 22, true, 80);
    beep(760, 0.1, 'square', 0.12);
    setTimeout(() => beep(1010, 0.14, 'square', 0.12), 120);
  }

  // 첫 안내
  if (!R.hinted) {
    R.hinted = true;
    announce('⬆️ 점프 · ⬇️ 슬라이드 버튼으로 조작! (화면 탭도 가능)', '#2c3e50', 220);
  }

  // --- 🚀 3,000m: 우주선 등장 → 탑승하면 시리즈2 클리어! ---
  if (!R.ship && R.dist >= RUN2_GOAL - 120) {
    R.ship = { x: R.vw + 260, boarded: false };
    R.obstacles = R.obstacles.filter((o) => o.x < R.vw * 0.6); // 앞길 정리
    R.gaps = [];
    announce('🚀 우주선이 보인다! 달려가서 탑승하자!', '#e67e22', 200);
  }
  if (R.ship && !R.ship.boarded) {
    R.ship.x -= spd;
    if (R.ship.x <= R_PX + 26) { // 탑승!
      R.ship.boarded = true;
      R.clearT = 150;
      R.obstacles = [];
      R.gaps = [];
      sfx.bonus();
      vib([100, 60, 200]);
    }
  }
  if (R.clearT > 0) { // 이륙 연출 → 클리어
    R.clearT--;
    R.ship.lift = (150 - R.clearT) * (150 - R.clearT) * 0.02; // 가속 상승
    if (frame % 2 === 0) {
      particles.push({ x: R.ship.x + rand(-10, 10), y: R_GROUND - 8 - (R.ship.lift || 0) + 26, vx: rand(-1, 1), vy: rand(1.5, 3.5), life: rand(12, 22), color: Math.random() < 0.5 ? '#ff9f43' : '#ffe66d' });
    }
    for (const pt of particles) { pt.x += pt.vx; pt.y += pt.vy; pt.life--; }
    particles = particles.filter((pt) => pt.life > 0);
    if (R.clearT === 0) {
      const first = !stats.run2Clear;
      stats.run2Clear = true;
      saveStats();
      checkAchievements();
      R.dist = Math.max(R.dist, RUN2_GOAL);
      runnerOver(true, first);
    }
    tickAnnounce();
    return; // 연출 중엔 나머지 진행 정지
  }

  // --- 스폰: 패턴 기반 (거리에 따라 다양한 조합 해금) ---
  if (R.gapSafe > 0) R.gapSafe--;
  if (R.ship) R.spawnT = 999; // 우주선 등장 후엔 장애물 없음
  if (--R.spawnT <= 0) {
    const d = Math.min(1, R.dist / 2000);
    R.spawnT = Math.round(rand(42, 74) * (5.2 / spd));
    const sx = R.vw + 50;
    const roll = Math.random();
    if (roll < 0.14) { // 코인 아치 / 슬라럼
      if (Math.random() < 0.5) {
        for (let i = 0; i < 5; i++) {
          R.pickups.push({ x: sx + i * 30, y: R_GROUND - 46 - Math.sin((i / 4) * Math.PI) * 66, kind: 'coin', spin: rand(0, 6) });
        }
      } else { // 위-아래 슬라럼
        for (let i = 0; i < 6; i++) {
          R.pickups.push({ x: sx + i * 34, y: R_GROUND - (i % 2 === 0 ? 34 : 104), kind: 'coin', spin: rand(0, 6) });
        }
      }
    } else if (roll < 0.17 && R.hearts < 3 && R.dist > 300) {
      R.pickups.push({ x: sx, y: R_GROUND - 90, kind: 'heart', spin: 0 });
    } else if (roll < 0.20 && R.dist > 400) {
      R.pickups.push({ x: sx, y: R_GROUND - 110, kind: 'star', spin: 0 });
    } else {
      // 장애물 패턴 헬퍼
      const rock = (x) => R.obstacles.push({ x, y: R_GROUND - 28, w: 28, h: 28, kind: 'rock', ph: rand(0, 6) });
      const crystal = (x) => R.obstacles.push({ x, y: R_GROUND - 48, w: 26, h: 48, kind: 'crystal', ph: rand(0, 6) });
      const beam = (x) => R.obstacles.push({ x, y: R_GROUND - 58, w: 96, h: 20, kind: 'beam', ph: rand(0, 6) });
      const alien = (x) => R.obstacles.push({ x, y: R_GROUND - 26, w: 26, h: 26, kind: 'alien', ph: rand(0, 6), vx: 0.9 + d * 0.6 });
      const drone = (x) => R.obstacles.push({ x, y: R_GROUND - 88, baseY: R_GROUND - 88, w: 30, h: 20, kind: 'drone', ph: rand(0, 6) });
      const meteor = (x) => R.obstacles.push({ x, y: -999, w: 22, h: 26, kind: 'meteor', phase: 'warn', warnT: 52, ph: rand(0, 6) });
      const gap = (x, wMul = 1) => {
        if (R.gapSafe > 0) { rock(x); return; }
        R.gaps.push({ x, w: rand(64, 104 + d * 40) * wMul });
        R.gapSafe = 80;
      };
      // 조작 요구 클래스: jump(점프 필수) · slide(슬라이드 필수) · nojump(점프 금지) · gap(구덩이)
      // [필요 난이도, 가중치, 생성 함수, 추가 지연, 클래스들, 패턴 폭]
      const P = [
        [0.00, 3.0, () => rock(sx), 0, ['jump'], 30],
        [0.08, 2.2, () => beam(sx), 0, ['slide'], 100],
        [0.12, 2.0, () => { rock(sx); rock(sx + 120 + d * 40); }, 14, ['jump'], 190],   // 연속 점프
        [0.20, 2.0, () => crystal(sx), 0, ['jump'], 30],
        [0.25, 2.0, () => gap(sx), 0, ['gap'], 150],
        [0.28, 1.8, () => { beam(sx); rock(sx + 210); }, 16, ['slide', 'jump'], 240],   // 슬라이드→점프
        [0.32, 1.8, () => alien(sx), 0, ['jump'], 30],
        [0.38, 1.6, () => drone(sx), 0, ['nojump'], 34],                                // 점프 금지 드론
        [0.42, 1.5, () => { beam(sx); beam(sx + 185); }, 20, ['slide'], 290],           // 이중 게이트
        [0.48, 1.5, () => { gap(sx); rock(sx + 280); }, 18, ['gap', 'jump'], 310],      // 구덩이→점프
        [0.55, 1.4, () => { rock(sx); crystal(sx + 150); }, 16, ['jump'], 180],         // 점프→더블 점프
        [0.60, 1.4, () => meteor(sx + rand(-30, 60)), 0, ['jump'], 90],                 // ☄️ 운석 (경고 후)
        [0.68, 1.2, () => { alien(sx); beam(sx + 190); }, 20, ['jump', 'slide'], 290],  // 외계인→슬라이드
        [0.76, 1.1, () => { drone(sx); rock(sx + 260); }, 18, ['nojump', 'jump'], 290], // 드론 통과→점프
        [0.85, 1.0, () => { rock(sx); rock(sx + 110); rock(sx + 220); }, 26, ['jump'], 250], // 트리플 점프
        [0.30, 1.4, () => { for (let i = 0; i < 10; i++) R.pickups.push({ x: sx + i * 32, y: R_GROUND - 58 - Math.sin(i * 0.85) * 44, kind: 'coin', spin: i }); }, 10, [], 320], // 🌊 파도 코인
        [0.52, 1.3, () => { meteor(sx); meteor(sx + 180); }, 24, ['jump'], 270],        // ☄️☄️ 운석 소나기
        [0.62, 1.2, () => { alien(sx); alien(sx + 130); alien(sx + 260); }, 26, ['jump'], 290], // 👽 러시
        [0.72, 1.1, () => { gap(sx); beam(sx + 260); }, 22, ['gap', 'slide'], 360],     // 🕳️→슬라이드
      ];
      // ⚔️ 상충 규칙: 이 조합이 가까이 붙으면 회피 불가 → 안전거리 확보 전엔 금지
      const clash = (a, b) =>
        (a === 'nojump' && (b === 'jump' || b === 'gap')) ||
        (b === 'nojump' && (a === 'jump' || a === 'gap')) ||
        (a === 'gap' && b === 'slide') || (b === 'gap' && a === 'slide');
      const SAFE_PX = 260; // 반응·착지에 필요한 최소 거리
      const gapPx = Math.max(0, (frame - R.lastSpawnF) * spd - R.lastExt);
      let pool = P.filter((pt) => d >= pt[0]);
      if (gapPx < SAFE_PX && R.lastCls.length) {
        pool = pool.filter((pt) => !pt[4].some((c) => R.lastCls.some((lc) => clash(c, lc))));
      }
      if (!pool.length) {
        R.spawnT = 16; // 안전거리 확보 후 재시도
      } else {
        let total = 0;
        for (const pt of pool) total += pt[1];
        let pick = Math.random() * total;
        for (const pt of pool) {
          pick -= pt[1];
          if (pick <= 0) {
            pt[2]();
            R.spawnT += pt[3];
            R.lastCls = pt[4];
            R.lastExt = pt[5];
            R.lastSpawnF = frame;
            break;
          }
        }
      }
    }
  }
  // 장식 크레이터
  if (Math.random() < 0.02) R.craters.push({ x: W + 60, w: rand(24, 54) });

  // --- 이동/정리 ---
  for (const o of R.obstacles) {
    o.x -= spd + (o.kind === 'alien' ? o.vx : 0);
    if (o.kind === 'drone') o.y = o.baseY + Math.sin(frame * 0.12 + o.ph) * 9; // 둥실둥실
    if (o.kind === 'meteor') { // ☄️ 경고 → 낙하 → 지면 잔해
      if (o.phase === 'warn') {
        if (--o.warnT <= 0) { o.phase = 'fall'; o.y = -30; beep(500, 0.2, 'sawtooth', 0.14); }
      } else if (o.phase === 'fall') {
        o.y += 17;
        if (o.y >= R_GROUND - 26) {
          o.y = R_GROUND - 26;
          o.phase = 'ground';
          shakeT = Math.max(shakeT, 7);
          R.rings.push({ x: o.x + o.w / 2, y: R_GROUND, r: 6, life: 18 });
          sfx.break();
          for (let i = 0; i < 8; i++) particles.push({ x: o.x + rand(-14, 14), y: R_GROUND - 4, vx: rand(-2, 2), vy: rand(-2.5, -0.5), life: rand(12, 22), color: '#ff9f43' });
        }
      }
    }
  }
  for (const c of R.pickups) c.x -= spd;
  for (const g of R.gaps) g.x -= spd;
  for (const cr of R.craters) cr.x -= spd;
  R.obstacles = R.obstacles.filter((o) => o.x > -120 && !o.gone);
  R.pickups = R.pickups.filter((c) => c.x > -40 && !c.taken);
  R.gaps = R.gaps.filter((g) => g.x + g.w > -40);
  R.craters = R.craters.filter((c) => c.x + c.w > -40);

  // --- 플레이어 물리 ---
  const overGap = runnerOverGap();
  const onGround = (!overGap || R.coyote > 0) && R.py >= R_GROUND - 0.5 && R.vy >= 0 && !R.pitFall;
  R.sliding = R.slideHeld && onGround;
  if (!overGap && R.py >= R_GROUND - 0.5 && R.vy >= 0) R.coyote = 8; // 지면 → 코요테 충전
  if (overGap && R.coyote > 0 && R.py >= R_GROUND - 0.5 && R.vy >= 0 && !R.pitFall) {
    // 🪂 코요테 타임: 가장자리를 살짝 지나쳐도 잠깐은 버팀 (늦은 점프 기회)
    R.coyote--;
    R.py = R_GROUND;
    R.vy = 0;
    R.jumps = 2;
  } else {
    R.vy += 0.62;
    R.py += R.vy;
  }
  if (overGap && R.py > R_GROUND + 30) R.pitFall = true; // 깊이 빠짐 → 추락 확정
  // 착지: 얕게 스친 정도(30px 이내)는 땅이 돌아오면 안전하게 복귀
  if (!R.pitFall && !overGap && R.vy >= 0 && R.py >= R_GROUND) {
    if (R.vy > 3) { // 착지 먼지
      for (let i = 0; i < 4; i++) particles.push({ x: R_PX + rand(-12, 12), y: R_GROUND, vx: rand(-1.2, 1.2), vy: rand(-0.6, 0), life: rand(8, 14), color: '#cfd3dd' });
    }
    R.py = R_GROUND;
    R.vy = 0;
    R.jumps = 2;
  }
  if (R.py > R_VH + 60) runnerHit('pit'); // 구덩이 추락

  // 스타 무지개 트레일
  if (R.starT > 0 && frame % 2 === 0) {
    particles.push({ x: R_PX - 16, y: R.py - 20 + rand(-12, 12), vx: rand(-2.5, -1.2), vy: rand(-0.4, 0.4), life: 18, color: `hsl(${(frame * 16) % 360}, 92%, 62%)` });
  }
  // 슬라이드 스키드 먼지
  if (R.sliding && frame % 3 === 0) {
    particles.push({ x: R_PX + rand(-14, 6), y: R_GROUND - 2, vx: rand(-2.4, -1.2), vy: rand(-1.2, -0.2), life: rand(10, 18), color: 'rgba(220, 224, 234, 0.9)' });
  }
  for (const rg of R.rings) { rg.life--; rg.r += 3.2; }
  R.rings = R.rings.filter((rg) => rg.life > 0);

  // 달리기 먼지
  if (onGround && frame % 6 === 0) {
    particles.push({ x: R_PX - 14, y: R_GROUND - 2, vx: rand(-1.8, -0.8), vy: rand(-0.5, 0.2), life: rand(8, 15), color: 'rgba(210,214,224,0.8)' });
  }

  // --- 충돌 ---
  const ph = R.sliding ? 22 : 40;
  const prect = { x: R_PX - 12, y: R.py - ph, w: 24, h: ph };
  if (R.inv <= 0) {
    for (const o of R.obstacles) {
      if (o.gone) continue;
      if (prect.x < o.x + o.w && prect.x + prect.w > o.x && prect.y < o.y + o.h && prect.y + prect.h > o.y) {
        o.gone = true;
        runnerHit(o.kind);
        break;
      }
    }
  }

  // --- 픽업 ---
  const mr = magnetRangeNow();
  for (const c of R.pickups) {
    if (mr > 0) { // 기본 자석도 적용!
      const dx = R_PX - c.x, dy = (R.py - 20) - c.y;
      const dist2 = Math.hypot(dx, dy);
      if (dist2 < mr && dist2 > 1) { c.x += (dx / dist2) * 4.5; c.y += (dy / dist2) * 4.5; }
    }
    c.spin += 0.15;
    if (Math.hypot(R_PX - c.x, (R.py - 20) - c.y) < 26) {
      c.taken = true;
      if (c.kind === 'coin') {
        let gain = 1;
        const bonusRate = (curChar === 'penguin' ? 0.1 : 0) + upg.coinup * 0.01;
        R.coinFrac += bonusRate;
        if (R.coinFrac >= 1) { R.coinFrac -= 1; gain++; }
        R.coins += gain;
        wallet += gain;
        stats.coins += gain;
        saveWallet();
        for (let i = 0; i < 4; i++) particles.push({ x: c.x + rand(-6, 6), y: c.y + rand(-6, 6), vx: rand(-1.4, 1.4), vy: rand(-1.8, -0.4), life: rand(10, 16), color: '#ffe98a' });
        sfx.coin();
      } else if (c.kind === 'heart') {
        R.hearts = Math.min(3, R.hearts + 1);
        sfx.revive();
        addFloat('❤️ +1', c.x, c.y - 16, '#e74c3c', 15, true, 50);
      } else { // star: 잠시 무적 질주
        R.inv = Math.max(R.inv, 250);
        R.starT = 250;
        sfx.bonus();
        addFloat('⭐ 무적 질주!', R_PX + 40, R.py - 70, '#c78a00', 16, true, 60);
      }
    }
  }

  if (R.inv > 0) R.inv--;
  if (R.starT > 0) R.starT--;
  if (shakeT > 0) shakeT--;
  for (const pt of particles) { pt.x += pt.vx; pt.y += pt.vy; pt.life--; }
  particles = particles.filter((pt) => pt.life > 0);
  for (const f of floatTexts) { f.life--; if (!f.screen) f.y -= 0.4; }
  floatTexts = floatTexts.filter((f) => f.life > 0);
  tickAnnounce();
}

function drawRunner() {
  ctx.save();
  const s2 = canvas.height / R_VH; // 가로 화면: 논리 높이 360 고정
  ctx.scale(s2, s2);
  const RVW = canvas.width / s2;   // 가로 논리 폭 (기기별 640~800)
  const VH = R_VH;
  if (shakeT > 0) ctx.translate(rand(-3, 3), rand(-3, 3));

  // --- 우주 배경 ---
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#0a0c26');
  bg.addColorStop(0.7, '#1a1f4a');
  bg.addColorStop(1, '#232a5c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RVW, VH);
  // 별 (패럴랙스 반짝임)
  for (const s of (R ? R.stars : [])) {
    const sxp = ((s.x - R.dist * 9 * s.layer) % (RVW + 20) + RVW + 20) % (RVW + 20) - 10;
    ctx.globalAlpha = 0.5 + Math.sin(frame * 0.05 + s.tw) * 0.4;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sxp, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 🌌 은하 소용돌이 (왼쪽 위, 아주 천천히 회전)
  ctx.save();
  ctx.translate(90, 66);
  ctx.rotate(R ? R.dist * 0.0004 : 0);
  ctx.globalAlpha = 0.5;
  for (let ga = 0; ga < 3; ga++) {
    ctx.rotate((Math.PI * 2) / 3);
    const gg4 = ctx.createRadialGradient(16, 0, 2, 16, 0, 30);
    gg4.addColorStop(0, 'rgba(190, 160, 255, 0.55)');
    gg4.addColorStop(1, 'rgba(190, 160, 255, 0)');
    ctx.fillStyle = gg4;
    ctx.beginPath();
    ctx.ellipse(16, 0, 28, 9, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f2e8ff';
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 🪐 고리 행성 (중앙 상단, 느린 패럴랙스)
  ctx.save();
  const plx = (RVW * 0.62 - (R ? R.dist * 0.5 : 0) % (RVW + 200));
  ctx.translate(((plx % (RVW + 200)) + RVW + 200) % (RVW + 200) - 100, 110);
  ctx.fillStyle = '#d9905f';
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 220, 170, 0.5)';
  ctx.beginPath();
  ctx.ellipse(-4, -4, 6, 4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(240, 200, 150, 0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 2, 27, 7, -0.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 지구 (오른쪽 위)
  ctx.save();
  ctx.translate(RVW - 64, 78);
  ctx.shadowColor = 'rgba(90, 160, 255, 0.7)';
  ctx.shadowBlur = 18;
  const eg = ctx.createRadialGradient(-8, -8, 4, 0, 0, 30);
  eg.addColorStop(0, '#8eccff');
  eg.addColorStop(0.6, '#3d7de0');
  eg.addColorStop(1, '#1d4ea8');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(110, 200, 120, 0.85)';
  ctx.beginPath();
  ctx.ellipse(-8, -4, 12, 7, 0.5, 0, Math.PI * 2);
  ctx.ellipse(10, 10, 8, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(4, -12, 14, 4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 고속 스피드라인 (속도감 연출)
  if (R && runnerSpeed() > 6.3 && state === State.PLAYING) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const ly = 60 + ((i * 97) % (R_GROUND - 120));
      const lx = RVW - ((R.dist * 46 + i * 173) % (RVW + 160)) + 40;
      const ln = 30 + (i % 3) * 22;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + ln, ly);
      ctx.stroke();
    }
  }

  // 먼 산등성이 (패럴랙스)
  ctx.fillStyle = '#2e3560';
  ctx.beginPath();
  ctx.moveTo(0, R_GROUND);
  for (let x = 0; x <= RVW; x += 24) {
    const wx = x + (R ? R.dist * 2.2 : 0);
    ctx.lineTo(x, R_GROUND - 26 - Math.abs(Math.sin(wx * 0.012)) * 46);
  }
  ctx.lineTo(RVW, R_GROUND);
  ctx.closePath();
  ctx.fill();

  // --- 달 지면 ---
  const gg2 = ctx.createLinearGradient(0, R_GROUND, 0, VH);
  gg2.addColorStop(0, '#b9bec9');
  gg2.addColorStop(0.12, '#9aa0ad');
  gg2.addColorStop(1, '#6d7280');
  ctx.fillStyle = gg2;
  ctx.fillRect(0, R_GROUND, RVW, VH - R_GROUND);
  if (R) {
    // 지면 질감: 모래 알갱이 + 가로 줄무늬
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    for (let gi = 0; gi < 26; gi++) {
      const gx = ((gi * 61 - R.dist * 9.5) % (RVW + 30) + RVW + 30) % (RVW + 30) - 15;
      const gy = R_GROUND + 8 + ((gi * 37) % (VH - R_GROUND - 14));
      ctx.fillRect(gx, gy, 2.2, 2.2);
    }
    ctx.fillStyle = 'rgba(70, 74, 88, 0.12)';
    ctx.fillRect(0, R_GROUND + 18, RVW, 2);
    ctx.fillRect(0, R_GROUND + 40, RVW, 2.5);
    // 크레이터
    for (const cr of R.craters) {
      ctx.fillStyle = 'rgba(90, 95, 108, 0.55)';
      ctx.beginPath();
      ctx.ellipse(cr.x, R_GROUND + 26, cr.w / 2, cr.w / 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(210, 214, 224, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cr.x, R_GROUND + 24, cr.w / 2, cr.w / 5.5, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    // 구덩이 (낭떠러지)
    for (const g of R.gaps) {
      const vg = ctx.createLinearGradient(0, R_GROUND, 0, VH);
      vg.addColorStop(0, '#14172e');
      vg.addColorStop(1, '#05060f');
      ctx.fillStyle = vg;
      ctx.fillRect(g.x, R_GROUND, g.w, VH - R_GROUND);
      ctx.fillStyle = 'rgba(230, 233, 240, 0.75)';
      ctx.fillRect(g.x - 3, R_GROUND, 3, 7);
      ctx.fillRect(g.x + g.w, R_GROUND, 3, 7);
    }
    // 지면 라인
    ctx.strokeStyle = 'rgba(235, 238, 245, 0.8)';
    ctx.lineWidth = 2.5;
    for (let x = 0; x < RVW + 30; x += 4) { // 구덩이 위는 선을 끊음
      const inGap = R.gaps.some((g) => x > g.x && x < g.x + g.w);
      if (!inGap) {
        ctx.beginPath();
        ctx.moveTo(x, R_GROUND);
        ctx.lineTo(x + 3, R_GROUND);
        ctx.stroke();
      }
    }

    // --- 장애물 ---
    for (const o of R.obstacles) {
      if (o.gone) continue;
      ctx.save();
      if (o.kind === 'rock') {
        ctx.translate(o.x + o.w / 2, o.y + o.h);
        ctx.fillStyle = '#7b8494';
        ctx.strokeStyle = '#59606e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.lineTo(-9, -20);
        ctx.lineTo(0, -28);
        ctx.lineTo(10, -18);
        ctx.lineTo(14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(-4, -16, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.kind === 'crystal') {
        ctx.translate(o.x + o.w / 2, o.y + o.h);
        ctx.globalAlpha = 0.92;
        ctx.shadowColor = 'rgba(72, 201, 229, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#7fdcef';
        ctx.strokeStyle = '#2f9ab8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(-6, -34);
        ctx.lineTo(0, -48);
        ctx.lineTo(7, -30);
        ctx.lineTo(12, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -46);
        ctx.lineTo(-3, 0);
        ctx.stroke();
      } else if (o.kind === 'beam') {
        // 레이저 게이트: 슬라이드로 통과!
        const pulse = 0.7 + Math.sin(frame * 0.3 + o.ph) * 0.3;
        for (const bx of [o.x, o.x + o.w]) { // 드론 2대
          ctx.fillStyle = '#57606f';
          ctx.beginPath();
          ctx.ellipse(bx, o.y + 10, 9, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#e74c3c';
          ctx.beginPath();
          ctx.arc(bx, o.y + 10, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = pulse;
        ctx.shadowColor = '#ff4d4d';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ff5b5b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(o.x + 8, o.y + 10);
        ctx.lineTo(o.x + o.w - 8, o.y + 10);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff0f0';
        ctx.stroke();
      } else if (o.kind === 'drone') {
        // 정찰 드론: 점프하지 말고 밑으로!
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
        ctx.fillStyle = '#8395a7';
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c8d6e5';
        ctx.beginPath();
        ctx.ellipse(0, -5, 8.5, 5.5, 0, Math.PI, 0);
        ctx.fill();
        const blink = Math.floor(frame / 8 + o.ph) % 3;
        for (let i = -1; i <= 1; i++) {
          ctx.fillStyle = i === blink - 1 ? '#ff6b6b' : 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(i * 9, 2.5, 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.5)';
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.lineTo(0, R_GROUND - (o.y + o.h / 2));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (o.kind === 'meteor') {
        if (o.phase === 'warn') {
          // 낙하 경고: 지면에 빨간 표시 + 상단 ⚠
          const bl = Math.floor(frame / 6) % 2 === 0;
          ctx.globalAlpha = bl ? 0.9 : 0.45;
          ctx.strokeStyle = '#ff4d4d';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(o.x + o.w / 2, R_GROUND + 3, 20, 6, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '900 20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ff4d4d';
          ctx.fillText('⚠', o.x + o.w / 2, 46);
          ctx.globalAlpha = 1;
        } else {
          // 불타는 운석
          ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
          if (o.phase === 'fall') {
            ctx.fillStyle = 'rgba(255, 159, 67, 0.55)';
            ctx.beginPath();
            ctx.ellipse(3, -26, 7, 22, 0.15, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowColor = 'rgba(255, 120, 40, 0.8)';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#8d6e63';
          ctx.strokeStyle = '#5d4037';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-11, 10);
          ctx.lineTo(-9, -8);
          ctx.lineTo(0, -13);
          ctx.lineTo(10, -6);
          ctx.lineTo(11, 10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255, 159, 67, 0.9)';
          ctx.beginPath();
          ctx.arc(-3, 0, 2.6, 0, Math.PI * 2);
          ctx.arc(5, 3, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (o.kind === 'alien') {
        const bob = Math.sin(frame * 0.25 + o.ph) * 2.5;
        ctx.translate(o.x + o.w / 2, o.y + o.h + bob * 0.3);
        ctx.fillStyle = '#6ddb6d';
        ctx.strokeStyle = '#3e9e3e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -13, 13, 13 + bob * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 더듬이 + 눈
        ctx.beginPath();
        ctx.moveTo(-5, -24);
        ctx.lineTo(-8, -31);
        ctx.moveTo(5, -24);
        ctx.lineTo(8, -31);
        ctx.stroke();
        ctx.fillStyle = '#3e9e3e';
        ctx.beginPath();
        ctx.arc(-8, -31, 2.4, 0, Math.PI * 2);
        ctx.arc(8, -31, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(-4.5, -15, 3.2, 0, Math.PI * 2);
        ctx.arc(4.5, -15, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-5.5, -16, 1.1, 0, Math.PI * 2);
        ctx.arc(3.5, -16, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- 🚀 클리어 우주선 ---
    if (R.ship) {
      const shipY = R_GROUND - 34 - (R.ship.lift || 0);
      ctx.save();
      ctx.translate(R.ship.x, shipY);
      ctx.shadowColor = 'rgba(130, 200, 255, 0.7)';
      ctx.shadowBlur = 14;
      // 몸체
      const sg3 = ctx.createLinearGradient(0, -26, 0, 26);
      sg3.addColorStop(0, '#eef3fb');
      sg3.addColorStop(0.6, '#b9c6da');
      sg3.addColorStop(1, '#8fa0b8');
      ctx.fillStyle = sg3;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.quadraticCurveTo(16, -10, 14, 14);
      ctx.lineTo(-14, 14);
      ctx.quadraticCurveTo(-16, -10, 0, -30);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 창문 (탑승하면 캐릭터 얼굴!)
      ctx.fillStyle = '#48c9e5';
      ctx.beginPath();
      ctx.arc(0, -6, 7.5, 0, Math.PI * 2);
      ctx.fill();
      if (R.ship.boarded && charImgs.left) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, -6, 6.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(charImgs.left, -8, -14, 16, 16);
        ctx.restore();
      }
      // 다리 + 불꽃
      ctx.strokeStyle = '#6b7a90';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 14);
      ctx.lineTo(-14, 26);
      ctx.moveTo(10, 14);
      ctx.lineTo(14, 26);
      ctx.stroke();
      if (R.ship.boarded) {
        ctx.fillStyle = 'rgba(255, 159, 67, 0.9)';
        ctx.beginPath();
        ctx.moveTo(-8, 16);
        ctx.lineTo(0, 30 + Math.random() * 14);
        ctx.lineTo(8, 16);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // --- 픽업 ---
    for (const c of R.pickups) {
      ctx.save();
      ctx.translate(c.x, c.y);
      if (c.kind === 'coin') {
        const sq = Math.max(Math.abs(Math.sin(c.spin)), 0.3);
        ctx.scale(sq, 1);
        ctx.shadowColor = 'rgba(241, 196, 15, 0.8)';
        ctx.shadowBlur = 8;
        const cg = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
        cg.addColorStop(0, '#ffe98a');
        cg.addColorStop(1, '#e0a800');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (c.kind === 'heart') {
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('❤️', 0, Math.sin(frame * 0.1) * 3);
      } else {
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, Math.sin(frame * 0.1) * 3);
      }
      ctx.restore();
    }

    // --- 파티클 ---
    for (const pt of particles) {
      ctx.globalAlpha = clamp(pt.life / 20, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // --- 확장 링 이펙트 (더블 점프·운석 충격) ---
    for (const rg of R.rings) {
      ctx.save();
      ctx.globalAlpha = clamp(rg.life / 16, 0, 1) * 0.8;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(rg.x, rg.y, rg.r, rg.r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 플레이어 그림자 (점프 높이에 따라 작아지고 옅어짐)
    if (!runnerOverGap() && R.py < R_VH) {
      const air = clamp((R_GROUND - R.py) / 160, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - air * 0.7);
      ctx.fillStyle = '#111726';
      ctx.beginPath();
      ctx.ellipse(R_PX, R_GROUND + 5, 20 * (1 - air * 0.45), 5 * (1 - air * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // --- 플레이어 (오른쪽 보기 = 좌우 반전) ---
    ctx.save();
    ctx.translate(R_PX, R.py - (R.sliding ? 12 : 23));
    if (R.starT > 0) { // 무적 오라
      ctx.shadowColor = 'rgba(255, 216, 50, 0.9)';
      ctx.shadowBlur = 16;
    }
    if (R.inv > 0 && R.starT <= 0 && Math.floor(R.inv / 6) % 2 === 0) ctx.globalAlpha = 0.35;
    const img = (R.vy < -1 && charImgs.fly) ? charImgs.fly : charImgs.left;
    ctx.scale(-1, 1); // 왼쪽 보기 스프라이트 → 오른쪽 질주
    if (R.sliding) {
      ctx.rotate(0.35);
      if (img) ctx.drawImage(img, -26, -14, 52, 33);
    } else {
      drawAccessoriesBack();
      if (img) ctx.drawImage(img, -23, -23, 46, 46);
      drawAccessoriesFront();
    }
    ctx.restore();
  }

  // --- HUD ---
  if (!photoMode && R && (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN)) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(8, 8, 118, 34, 17);
    roundRect(8, 48, 92, 28, 14);
    ctx.fillStyle = '#2c3e50';
    ctx.font = '900 19px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.floor(R.dist)}m`, 22, 26);
    ctx.font = '800 15px sans-serif';
    ctx.fillStyle = '#b7791f';
    ctx.fillText('🪙 ' + R.coins, 18, 63);
    ctx.font = '17px sans-serif';
    ctx.fillText('❤️'.repeat(R.hearts) + '🖤'.repeat(3 - R.hearts), 10, 92);
    if (best2 > 0) {
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`BEST ${best2}m`, 12, 114);
    }
    // ⏳ 스타 무적 남은 시간 바
    drawTimerBars([
      { icon: '⭐', frac: R.starT > 0 ? R.starT / 250 : 0, color: '#f6b93b' },
    ], 66, RVW - 60);
  }

  // 떠오르는 텍스트
  for (const f of floatTexts) {
    const fy = f.screen ? f.y : f.y - cameraY;
    ctx.save();
    ctx.globalAlpha = clamp(f.life / 40, 0, 1);
    ctx.font = `900 ${f.size}px sans-serif`;
    const halfW2 = ctx.measureText(f.text).width / 2;
    const fx2 = clamp(f.x, halfW2 + 4, RVW - halfW2 - 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, fx2, fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, fx2, fy);
    ctx.restore();
  }
  if (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN) drawAnnounce();

  // 카운트다운
  if (state === State.COUNTDOWN) {
    const remain = Math.max(0, countdownUntil - performance.now());
    const n = Math.ceil(remain / 1000);
    ctx.fillStyle = 'rgba(10, 12, 38, 0.55)';
    ctx.fillRect(0, 0, RVW, VH);
    ctx.fillStyle = '#fff';
    ctx.font = '900 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), RVW / 2, R_VH / 2 - 52);
    ctx.font = '800 19px sans-serif';
    ctx.fillText('🌕 시리즈2 · 문 런', RVW / 2, R_VH / 2 + 22);
    ctx.font = '700 15px sans-serif';
    ctx.fillStyle = '#cdd3ff';
    ctx.fillText('⬆️ 점프 버튼 · ⬇️ 슬라이드 버튼', RVW / 2, R_VH / 2 + 52);
    ctx.fillText('(화면 좌/우 탭, 방향키 ↑↓도 가능)', RVW / 2, R_VH / 2 + 76);
  }
  ctx.restore();
}

$('btn-start').addEventListener('click', () => { runnerMode = false; fighterMode = false; dailyMode = false; startGame(); });
$('btn-run3').addEventListener('click', () => {
  if (!series3Unlocked()) {
    const b = $('btn-run3');
    b.innerHTML = '🔒 문 런 3,000m 우주선 탑승 시 해금!';
    setTimeout(() => refreshMenu(), 1700);
    beep(200, 0.1, 'square', 0.1);
    return;
  }
  runnerMode = false;
  startFighter();
});
$('btn-run2').addEventListener('click', () => {
  if (!series2Unlocked()) { // 시리즈1 10,000점 달성 시 해금
    const b = $('btn-run2');
    b.textContent = '🔒 시리즈1에서 10,000점 달성 시 해금!';
    setTimeout(() => refreshMenu(), 1600);
    beep(200, 0.1, 'square', 0.1);
    return;
  }
  fighterMode = false;
  startRunner();
});
$('btn-daily').addEventListener('click', () => { runnerMode = false; fighterMode = false; dailyMode = true; startGame(); });
$('btn-retry').addEventListener('click', () => { if (runnerMode) startRunner(); else if (fighterMode) startFighter(); else beginCountdown(); });
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
document.querySelectorAll('.rps-btn').forEach((btn) => {
  btn.addEventListener('click', () => playRps(Number(btn.dataset.hand)));
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
$('lb-ser-1').addEventListener('click', () => { lbSeries = 1; renderLeaderboard(); });
$('lb-ser-2').addEventListener('click', () => { lbSeries = 2; renderLeaderboard(); });
$('lb-ser-3').addEventListener('click', () => { lbSeries = 3; renderLeaderboard(); });
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
  if (!askNickname()) return;
  if (runnerMode && R) autoSubmitScore(Math.floor(R.dist), 'runner');
  else if (fighterMode && F) autoSubmitScore(F.score, 'fighter');
  else autoSubmitScore();
});

$('btn-settings').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  refreshSettingsUI();
  $('settings-screen').classList.remove('hidden');
});
$('btn-settings-back').addEventListener('click', goHome);
$('btn-me').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  renderMe();
  $('me-screen').classList.remove('hidden');
  if (meTimer) clearInterval(meTimer);
  meTimer = setInterval(renderMePreview, 70); // 망토·날개 팔랑임
});
$('me-tab-base').addEventListener('click', () => { meTab = 'base'; renderMe(); });
$('me-tab-gear').addEventListener('click', () => { meTab = 'gear'; renderMe(); });
$('me-tab-rec').addEventListener('click', () => { meTab = 'rec'; renderMe(); });
$('btn-me-back').addEventListener('click', () => {
  if (meTimer) { clearInterval(meTimer); meTimer = null; }
  goHome();
});
$('btn-dex').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  renderDex();
  $('dex-screen').classList.remove('hidden');
});
$('btn-dex-back').addEventListener('click', goHome);
const SETTING_BTNS = {
  'set-sfx-on': () => { settings.sfx = true; },
  'set-sfx-off': () => { settings.sfx = false; },
  'set-music-on': () => { settings.music = true; },
  'set-music-off': () => { settings.music = false; bgm.stop(); },
  'set-vib-on': () => { settings.vib = true; vib(60); },
  'set-vib-off': () => { settings.vib = false; },
  'set-tilt-low': () => { settings.tilt = 'low'; },
  'set-tilt-mid': () => { settings.tilt = 'mid'; },
  'set-tilt-high': () => { settings.tilt = 'high'; },
  'set-hand-r': () => { settings.lefty = false; },
  'set-hand-l': () => { settings.lefty = true; },
};
for (const [id, fn] of Object.entries(SETTING_BTNS)) {
  $(id).addEventListener('click', () => {
    fn();
    saveSettings();
    refreshSettingsUI();
    sfx.buy();
  });
}
applySettings();

// 탭 전환 시 자동 일시정지
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === State.PLAYING) pauseGame();
});

// ---------- 시작 ----------
newGame(); // 메뉴 뒤 배경용
refreshMenu();
loop();

// ---------- 🔑 치트 코드 & 운영자 패널 ----------
function mpStatus(msg) {
  const el = $('mp-status');
  el.textContent = msg;
  sfx.buy();
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2200);
}

// 🕹️ 운영자 샌드박스: 켜면 실계정 보관 + 전부 해금, 끄면 원상 복귀
const OP_KEYS = [...CLOUD_KEYS, 'jump-ghost'];

function enterOpMode() {
  if (opMode) return;
  // 1) 실계정 데이터 보관
  const snap = {};
  for (const k of OP_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  localStorage.setItem('jump-op-backup', JSON.stringify(snap));
  localStorage.setItem('jump-op-mode', '1');
  // 2) 샌드박스 풀해금 상태 기록
  localStorage.setItem('jump-coins', '999999');
  const maxUpg = {};
  for (const k of Object.keys(UPGRADES)) maxUpg[k] = UPGRADES[k].max;
  localStorage.setItem('jump-upg', JSON.stringify(maxUpg));
  localStorage.setItem('jump-chars', JSON.stringify(Object.keys(CHARACTERS)));
  const allInv = { life: 3, rocket: 9, magnet: 9 };
  for (const k of COSMETICS) allInv[k] = 1;
  localStorage.setItem('jump-inv', JSON.stringify(allInv));
  localStorage.setItem('jump-dex', JSON.stringify(Object.keys(DEX)));
  const dn = {};
  for (const [id, d] of Object.entries(DEX)) dn[id] = d[2];
  localStorage.setItem('jump-dexn', JSON.stringify(dn));
  localStorage.setItem('jump-ach', JSON.stringify(ACHIEVEMENTS.map((a) => a.id)));
  const st = Object.assign({}, stats, { moon: true, run2Clear: true });
  localStorage.setItem('jump-stats', JSON.stringify(st));
  location.reload(); // 깨끗하게 재시작
}

function exitOpMode() {
  if (!opMode) return;
  let snap = {};
  try { snap = JSON.parse(localStorage.getItem('jump-op-backup') || '{}'); } catch (e) {}
  for (const k of OP_KEYS) localStorage.removeItem(k); // 샌드박스 흔적 제거
  for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v); // 내 계정 복귀
  localStorage.removeItem('jump-op-mode');
  localStorage.removeItem('jump-op-backup');
  location.reload();
}

$('mp-op').addEventListener('click', () => {
  if (!opMode) {
    if (confirm('🕹️ 운영자 모드를 켤까요?\n\n· 모든 캐릭터·아이템·강화·도감이 해금된 테스트 상태가 됩니다\n· 현재 내 계정 데이터는 안전하게 보관됩니다\n· 켜져 있는 동안 클라우드 백업·랭킹 등록은 중단됩니다\n· 끄면 내 계정 그대로 돌아옵니다')) enterOpMode();
  } else {
    if (confirm('운영자 모드를 끄고 내 계정으로 돌아갈까요?\n(샌드박스에서 바꾼 내용은 사라집니다)')) exitOpMode();
  }
});

$('btn-cheat').addEventListener('click', () => {
  const code = $('cheat-input').value.trim().toLowerCase();
  $('cheat-input').value = '';
  if (code === 'master') {
    masterMode = true;
    localStorage.setItem('jump-master', '1');
    refreshSettingsUI();
    sfx.bonus();
    vib(80);
    mpStatus('🛠️ 운영자 모드 활성화!');
  } else if (code) {
    $('cheat-input').placeholder = '❌ 잘못된 코드';
    beep(180, 0.12, 'square', 0.12);
    setTimeout(() => { $('cheat-input').placeholder = '🔑 치트 코드'; }, 1500);
  }
});

$('mp-coin').addEventListener('click', () => {
  wallet += 100000;
  saveWallet();
  refreshMenu();
  mpStatus(`💰 +100,000 (잔액 ${wallet.toLocaleString()})`);
});
$('mp-chars').addEventListener('click', () => {
  ownedChars = new Set(Object.keys(CHARACTERS));
  saveChars();
  checkAchievements();
  mpStatus('🐾 캐릭터 9종 전부 해금!');
});
$('mp-cos').addEventListener('click', () => {
  for (const k of COSMETICS) inv[k] = 1;
  saveInv();
  checkAchievements();
  mpStatus('👒 꾸미기 25종 전부 해금!');
});
$('mp-upgmax').addEventListener('click', () => {
  for (const k of Object.keys(UPGRADES)) upg[k] = UPGRADES[k].max;
  saveUpg();
  checkAchievements();
  mpStatus('💪 모든 강화 Lv50!');
});
$('mp-upg0').addEventListener('click', () => {
  for (const k of Object.keys(UPGRADES)) upg[k] = 0;
  saveUpg();
  mpStatus('💪 강화 초기화 완료');
});
$('mp-dex').addEventListener('click', () => {
  for (const [id, d] of Object.entries(DEX)) {
    dexN[id] = Math.max(dexN[id] || 0, d[2]);
    dex.add(id);
  }
  localStorage.setItem('jump-dex', JSON.stringify([...dex]));
  localStorage.setItem('jump-dexn', JSON.stringify(dexN));
  checkAchievements();
  mpStatus('📖 도감 32종 완성!');
});
$('mp-ach').addEventListener('click', () => {
  for (const a of ACHIEVEMENTS) unlockedAch.add(a.id);
  saveAch();
  mpStatus('🏆 도전과제 전부 달성!');
});
$('mp-moon').addEventListener('click', () => {
  stats.moon = true;
  stats.run2Clear = true;
  saveStats();
  refreshMenu();
  mpStatus('🌕🛸 시리즈2·3 전부 해금!');
});
$('mp-god').addEventListener('click', () => {
  cheatGod = !cheatGod;
  $('mp-god').textContent = `🛡️ 무적 모드: ${cheatGod ? 'ON' : 'OFF'}`;
  $('mp-god').classList.toggle('on', cheatGod);
  mpStatus(cheatGod ? '🛡️ 무적 ON (이번 접속 동안)' : '무적 OFF');
});
$('mp-score-set').addEventListener('click', () => {
  const v = parseInt($('mp-score').value, 10) || 0;
  cheatStartScore = Math.max(0, v);
  mpStatus(cheatStartScore > 0 ? `🚀 다음 판 ${cheatStartScore.toLocaleString()}점부터 시작` : '시작 점수 해제');
});
$('mp-reset').addEventListener('click', () => {
  if (!confirm('정말 모든 데이터를 초기화할까요? (코인·기록·해금 전부 삭제)')) return;
  localStorage.clear();
  location.reload();
});

// ---------- 버전 표시 & 최신 버전 유도 ----------
const GAME_VERSION = 69; // 배포 때마다 sw.js CACHE_VERSION과 함께 올림
const verLabel = $('version-label');
function setVerLabel(txt, cls) {
  if (!verLabel) return;
  verLabel.textContent = txt;
  verLabel.className = 'version-label' + (cls ? ' ' + cls : '');
}
setVerLabel(`버전 v${GAME_VERSION} · 탭해서 업데이트 확인`);
let verBusy = false;
if (verLabel) {
  verLabel.addEventListener('click', async () => {
    if (verLabel.classList.contains('has-new')) { location.reload(); return; }
    if (verBusy) return;
    verBusy = true;
    setVerLabel('🔄 최신 버전 확인 중...');
    let found = false;
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          await new Promise((r) => setTimeout(r, 2200));
          found = !!(reg.waiting || reg.installing);
        }
      }
    } catch (e) { /* 오프라인 등은 무시 */ }
    if (found || !$('update-banner').classList.contains('hidden')) {
      setVerLabel('🆕 새 버전 발견! 탭해서 적용', 'has-new');
    } else {
      setVerLabel(`✅ 최신 버전입니다 (v${GAME_VERSION})`);
      setTimeout(() => {
        if (!verLabel.classList.contains('has-new')) setVerLabel(`버전 v${GAME_VERSION} · 탭해서 업데이트 확인`);
      }, 2600);
    }
    verBusy = false;
  });
}
if ('serviceWorker' in navigator) {
  // 새 버전이 감지되면 버전 라벨도 함께 강조
  let verHadCtl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!verHadCtl) { verHadCtl = true; return; }
    setVerLabel('🆕 새 버전 발견! 탭해서 적용', 'has-new');
  });
  navigator.serviceWorker.getRegistration()
    .then((reg) => { if (reg && reg.waiting) setVerLabel('🆕 새 버전 발견! 탭해서 적용', 'has-new'); })
    .catch(() => {});
}
