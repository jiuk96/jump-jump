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
const PRICES = { life: 150, rocket: 50, magnet: 75 };
const MAX_OWN = { life: 3, rocket: 9, magnet: 9 };

// ---------- 발판 ----------
const PLAT_W = 62;
const PLAT_H = 14;

const PlatType = {
  NORMAL: 'normal',     // 초록: 일반
  MOVING: 'moving',     // 파랑: 좌우 이동
  BREAKING: 'breaking', // 갈색: 밟으면 부서짐 (점프 불가)
  ONESHOT: 'oneshot',   // 흰색: 한 번 밟으면 사라짐
};

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
(async () => {
  charImgs.left = await tryLoadImage('assets/character/jump-left.png');
  charImgs.fly = await tryLoadImage('assets/character/fly-left.png');
  charImgs.right = await tryLoadImage('assets/character/jump-right.png');
  charImgs.shoot = await tryLoadImage('assets/character/shoot.png');
})();

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
let inv = { life: 0, rocket: 0, magnet: 0 };
try {
  inv = Object.assign(inv, JSON.parse(localStorage.getItem('jump-inv') || '{}'));
} catch (e) { /* 손상된 저장값은 무시 */ }

function saveWallet() { localStorage.setItem('jump-coins', String(wallet)); }
function saveInv() { localStorage.setItem('jump-inv', JSON.stringify(inv)); }

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
  invincible = Math.max(invincible, BONUS_INVINCIBLE);
  sfx.bonus();
  addBurst(player.x, player.y, '#f1c40f');
}

// 별 10개 → 스타 파워: 짧은 무적 비행
function starPower() {
  starCount = 0;
  missionFlash = 140;
  flashMain = '⭐ 스타 파워!';
  flashSub = '무적 비행!';
  jetpackTimer = Math.max(jetpackTimer, 0) + STAR_FLIGHT;
  invincible = Math.max(invincible, STAR_FLIGHT + 60);
  sfx.bonus();
  addBurst(player.x, player.y, '#ffd832');
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
      const type = score > 8000 ? 'snow' : (Math.random() < 0.55 ? 'rain' : 'snow');
      weather = { type, t: Math.round(rand(480, 750)) };
    }
  }
  for (const w of weatherDrops) {
    w.x += w.vx + (w.rain ? 0 : Math.sin(frame * 0.04 + w.swayPhase) * 0.7);
    w.y += w.vy;
  }
  weatherDrops = weatherDrops.filter((w) => w.y < H + 20);
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
  if (state !== State.PLAYING) return;
  if (controlMode === 'tilt') {
    shoot();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const t = e.changedTouches[0];
  const x = t.clientX - rect.left;
  const y = t.clientY - rect.top;
  if (y < rect.height * 0.25) {
    shoot();
    return;
  }
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
window.addEventListener('deviceorientation', (e) => {
  if (controlMode !== 'tilt') { input.tilt = 0; return; }
  if (e.gamma != null) input.tilt = clamp(e.gamma / 15, -1, 1);
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

  // 들고 들어가는 아이템: 생명은 보유분 그대로, 로켓/자석은 있으면 1개 자동 사용
  lives = inv.life;
  magnetActive = false;
  if (state === State.COUNTDOWN) { // 메뉴 배경용 초기화 때는 소비하지 않음
    if (inv.rocket > 0) {
      inv.rocket--;
      jetpackTimer = JETPACK_TIME;
      sfx.jetpack();
    }
    if (inv.magnet > 0) {
      inv.magnet--;
      magnetActive = true;
    }
    saveInv();
  }

  // 시작 발판: 바닥 근처에 촘촘히
  platforms.push(makePlatform(W / 2 - PLAT_W / 2, H - 60, PlatType.NORMAL));
  highestPlatY = H - 60;
  while (highestPlatY > -H) spawnPlatformRow();
}

function makePlatform(x, y, type) {
  const d = difficulty();
  // 높이 올라갈수록 발판이 작아짐 (62 → 최소 ~44)
  const w = clamp(PLAT_W - d * 18 + rand(-3, 3), 40, PLAT_W + 3);
  // 일부 발판은 늘었다 줄었다 (난이도 오를수록 자주)
  const pulse = type !== PlatType.BREAKING && Math.random() < 0.05 + d * 0.12;
  return {
    x, y, w, h: PLAT_H, type,
    baseW: w,
    pulse,
    pulsePhase: rand(0, Math.PI * 2),
    vx: type === PlatType.MOVING ? rand(0.8, 1.4 + d * 1.2) * (Math.random() < 0.5 ? -1 : 1) : 0,
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
  const gap = rand(30 + d * 58, 44 + d * 76);
  const y = highestPlatY - gap;
  const x = rand(0, W - PLAT_W);

  // 특수 발판 비율: 초반 6% → 후반 45%
  let type = PlatType.NORMAL;
  const r = Math.random();
  if (r < 0.03 + d * 0.24) type = PlatType.MOVING;
  else if (r < 0.06 + d * 0.39) type = PlatType.ONESHOT;

  const p = makePlatform(x, y, type);
  p.x = rand(0, W - p.w);

  // 아이템: 일반 발판 위에만
  if (type === PlatType.NORMAL) {
    const ir = Math.random();
    if (ir < 0.06) p.spring = true;
    else if (ir < 0.075) p.jetpack = true;
  }
  platforms.push(p);

  // 부서지는 발판은 근처에 보너스로 추가 (단독 경로가 되지 않게)
  if (Math.random() < 0.06 + d * 0.2) {
    const bx = rand(0, W - PLAT_W);
    const by = y - rand(15, 35);
    if (Math.abs(bx - x) > PLAT_W * 0.8) {
      platforms.push(makePlatform(bx, by, PlatType.BREAKING));
    }
  }

  // 몬스터: 1500점부터 등장, 후반으로 갈수록 잦아짐
  if (score > 1500 && Math.random() < 0.02 + d * 0.07) {
    monsters.push({
      x: rand(30, W - 30), y: y - 40,
      w: 40, h: 34,
      vx: rand(0.5, 1.2 + d * 0.8) * (Math.random() < 0.5 ? -1 : 1),
      dead: false,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  highestPlatY = y;
}

// ---------- 발사 ----------
function shoot() {
  bullets.push({ x: player.x, y: player.y - player.h / 2, vy: BULLET_VY });
  shootPose = 20;
  sfx.shoot();
  missionEvent('Shoot');
}

// ---------- 죽음 처리: 생명이 있으면 부활 ----------
function tryRevive() {
  if (lives > 0) {
    lives--;
    inv.life = lives;
    saveInv();
    // 화면 아래에서 크게 튀어오르며 부활 + 잠시 무적
    player.x = clamp(player.x, 30, W - 30);
    player.y = cameraY + H - 4;
    player.vy = SPRING_VY * 1.2;
    player.vx = 0;
    invincible = REVIVE_INVINCIBLE;
    jetpackTimer = 0;
    sfx.revive();
    addBurst(player.x, player.y, '#e74c3c');
    return true;
  }
  gameOver();
  return false;
}

// ---------- 업데이트 ----------
function update() {
  frame++;
  if (invincible > 0) invincible--;

  // --- 좌우 이동 ---
  let ax = 0;
  if (input.left) ax -= MOVE_ACC;
  if (input.right) ax += MOVE_ACC;
  ax += input.tilt * MOVE_ACC * 1.6;
  player.vx = clamp((player.vx + ax) * (ax === 0 ? MOVE_FRICTION : 1), -MOVE_MAX, MOVE_MAX);
  player.x += player.vx;
  if (Math.abs(player.vx) > 0.3) player.facing = player.vx < 0 ? 'left' : 'right';

  // 화면 좌우 랩어라운드
  if (player.x < -player.w / 2) player.x = W + player.w / 2;
  if (player.x > W + player.w / 2) player.x = -player.w / 2;

  // --- 중력/제트팩 ---
  if (jetpackTimer > 0) {
    jetpackTimer--;
    player.vy = JETPACK_VY;
    if (frame % 3 === 0) {
      particles.push({
        x: player.x + rand(-6, 6), y: player.y + player.h / 2,
        vx: rand(-1, 1), vy: rand(2, 4), life: 20, color: '#e67e22',
      });
    }
  } else {
    player.vy += GRAVITY;
  }
  player.y += player.vy;

  // --- 발판 충돌 (하강 중일 때만) ---
  if (player.vy > 0 && jetpackTimer <= 0) {
    for (const p of platforms) {
      if (p.broken) continue;
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
        const usedSpring = !p.jetpack && p.spring;
        if (p.jetpack) {
          p.jetpack = false;
          jetpackTimer = JETPACK_TIME;
          sfx.jetpack();
        } else if (p.spring) {
          player.vy = SPRING_VY;
          sfx.spring();
        } else {
          player.vy = JUMP_VY;
          sfx.jump();
        }
        if (p.type === PlatType.ONESHOT) p.broken = true;
        // 미션 훅: 처음 밟는 발판인지 + 스프링 여부
        const fresh = !landedSet.has(p);
        landedSet.add(p);
        missionEvent('Land', p, { fresh, spring: usedSpring });
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
    const isStar = Math.random() < 0.16;
    coinsArr.push({
      x: rand(20, W - 20), y: cameraY - 30,
      vy: rand(1.0, 2.1),
      swayPhase: rand(0, Math.PI * 2),
      spin: rand(0, Math.PI * 2),
      type: isStar ? 'star' : 'coin',
    });
  }
  for (const c of coinsArr) {
    c.spin += 0.15;
    c.y += c.vy;                                     // 아래로 낙하
    c.x += Math.sin(frame * 0.05 + c.swayPhase) * 0.6; // 하늘하늘
    // 자석: 범위 내 코인을 끌어당김
    if (magnetActive) {
      const dx = player.x - c.x, dy = player.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < MAGNET_RANGE && dist > 1) {
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
        if (starCount >= STAR_GOAL) starPower();
      } else {
        runCoins++;
        wallet++;
        saveWallet();
        sfx.coin();
        particles.push({ x: c.x, y: c.y, vx: 0, vy: -1.5, life: 18, color: '#f1c40f' });
        missionEvent('Coin');
      }
    }
  }
  coinsArr = coinsArr.filter((c) => !c.taken && c.y < cameraY + H + 40);

  // --- 날씨 (비/눈) ---
  updateWeather();

  // --- 몬스터 ---
  for (const m of monsters) {
    if (m.dead) continue;
    m.x += m.vx;
    m.wobble += 0.1;
    if (m.x < 20 || m.x > W - 20) m.vx *= -1;

    // 플레이어 충돌 (무적 중엔 통과)
    if (invincible > 0) continue;
    const dx = Math.abs(player.x - m.x);
    const dy = player.y - m.y;
    if (dx < (player.w + m.w) / 2 - 8 && Math.abs(dy) < (player.h + m.h) / 2 - 6) {
      if (player.vy > 0 && dy < -4) {
        // 위에서 밟으면 처치
        m.dead = true;
        player.vy = JUMP_VY;
        sfx.hit();
        addBurst(m.x, m.y, '#9b59b6');
        missionEvent('Kill');
      } else {
        m.dead = true; // 부활 직후 같은 몬스터에 또 죽지 않게 제거
        addBurst(m.x, m.y, '#9b59b6');
        if (!tryRevive()) return;
      }
    }
  }

  // --- 총알 ---
  for (const b of bullets) {
    b.y += b.vy;
    for (const m of monsters) {
      if (m.dead) continue;
      if (Math.abs(b.x - m.x) < m.w / 2 && Math.abs(b.y - m.y) < m.h / 2) {
        m.dead = true;
        b.y = -9999;
        sfx.hit();
        addBurst(m.x, m.y, '#9b59b6');
        missionEvent('Kill');
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

  // --- 카메라 스크롤 & 점수 ---
  const threshold = cameraY + H * 0.4;
  if (player.y < threshold) {
    const diff = threshold - player.y;
    cameraY -= diff;
    score += Math.round(diff);
  }

  // --- 새 발판 생성 / 화면 아래 정리 ---
  while (highestPlatY > cameraY - 100) spawnPlatformRow();
  platforms = platforms.filter((p) => p.y < cameraY + H + 60 && !(p.broken && p.breakAnim > 30));
  monsters = monsters.filter((m) => m.y < cameraY + H + 80 && !m.dead);

  // --- 미션 진행 ---
  if (missionFlash > 0) missionFlash--;
  if (!mission) {
    if (missionCooldown > 0) missionCooldown--;
    else pickMission();
  } else if (mission.def.tick) {
    mission.def.tick(mission.s);
    if (mission.def.done(mission.s)) completeMission();
  }

  // --- 낙사 ---
  if (player.y > cameraY + H + player.h) {
    tryRevive();
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

  const colors = {
    [PlatType.NORMAL]: ['#2ecc71', '#27ae60'],
    [PlatType.MOVING]: ['#3498db', '#2980b9'],
    [PlatType.BREAKING]: ['#a0693a', '#8B5A2B'],
    [PlatType.ONESHOT]: ['#ffffff', '#dcdde1'],
  };
  const [c1, c2] = colors[p.type];
  const g = ctx.createLinearGradient(0, y, 0, y + p.h);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  roundRect(p.x, y, p.w, p.h, 7);

  // 스프링
  if (p.spring) {
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(p.x + p.w / 2 - 8, y - 10, 16, 10);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(p.x + p.w / 2 - 10, y - 12, 20, 4);
  }
  // 제트팩
  if (p.jetpack) {
    ctx.fillStyle = '#f39c12';
    roundRect(p.x + p.w / 2 - 9, y - 22, 18, 22, 4);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(p.x + p.w / 2 - 4, y - 26, 8, 6);
  }
  ctx.restore();
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
    // 반짝이는 별
    ctx.rotate(c.spin * 0.35);
    const R = 13, r = 5.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd832';
    ctx.strokeStyle = '#e0a800';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(-3, -4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const squeeze = Math.abs(Math.sin(c.spin)); // 회전하는 느낌
    ctx.scale(Math.max(squeeze, 0.25), 1);
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d4a017';
    ctx.font = '900 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₩', 0, 1);
  }
  ctx.restore();
}

function drawPlayer() {
  const x = player.x, y = player.y - cameraY;
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
    ctx.drawImage(img, -player.w / 2, -player.h / 2, player.w, player.h);
  } else {
    drawDefaultCharacter();
  }
  ctx.restore();
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
  ctx.save();
  ctx.translate(m.x, y);
  // 몸통
  ctx.fillStyle = '#9b59b6';
  ctx.strokeStyle = '#71368a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 날개
  ctx.fillStyle = '#be90d4';
  const flap = Math.sin(m.wobble * 3) * 6;
  ctx.beginPath();
  ctx.ellipse(-m.w / 2 - 4, -4 + flap, 8, 5, -0.4, 0, Math.PI * 2);
  ctx.ellipse(m.w / 2 + 4, -4 + flap, 8, 5, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // 눈
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-7, -4, 5, 0, Math.PI * 2);
  ctx.arc(7, -4, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(-7, -3, 2, 0, Math.PI * 2);
  ctx.arc(7, -3, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function draw() {
  ctx.save();
  ctx.scale(scale, scale);

  drawBackground();

  for (const p of platforms) drawPlatform(p);
  for (const c of coinsArr) drawCoin(c);
  for (const m of monsters) drawMonster(m);

  // 총알
  ctx.fillStyle = '#f1c40f';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y - cameraY, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 파티클
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life / 20, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 2, pt.y - cameraY - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawPlayer();
  drawWeather();

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

  // HUD: 점수 / 코인 / 별 / 생명
  if (state === State.PLAYING || state === State.PAUSED || state === State.COUNTDOWN) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(8, 8, 110, 34, 17);
    roundRect(8, 48, 86, 28, 14);
    roundRect(100, 48, 92, 28, 14);
    ctx.fillStyle = '#2c3e50';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(score), 24, 26);
    ctx.font = '800 15px sans-serif';
    ctx.fillStyle = '#b7791f';
    ctx.fillText('🪙 ' + runCoins, 18, 63);
    ctx.fillStyle = '#c78a00';
    ctx.fillText(`⭐ ${starCount}/${STAR_GOAL}`, 110, 63);

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
let rafId = null;
function loop() {
  if (state === State.COUNTDOWN && performance.now() >= countdownUntil) {
    state = State.PLAYING;
  }
  if (state === State.PLAYING) update();
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

function refreshMenu() {
  $('best-score-label').textContent = best > 0 ? `최고 기록 ${best}` : '';
  $('wallet-label').textContent = `🪙 ${wallet}`;
  refreshControlUI();
}

function refreshControlUI() {
  $('ctrl-touch').classList.toggle('active', controlMode === 'touch');
  $('ctrl-tilt').classList.toggle('active', controlMode === 'tilt');
  $('control-desc').innerHTML = controlMode === 'touch'
    ? '화면 좌/우 터치(또는 ← → 방향키)로 이동<br>화면 위쪽 탭(또는 스페이스바)으로 발사'
    : '핸드폰을 좌우로 기울여 이동<br>화면 아무 곳이나 탭하면 발사';
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
    btn.disabled = wallet < PRICES[item] || inv[item] >= MAX_OWN[item];
    btn.textContent = inv[item] >= MAX_OWN[item] ? '최대 보유' : `🪙 ${PRICES[item]}`;
  });
}

function buyItem(item) {
  if (wallet < PRICES[item] || inv[item] >= MAX_OWN[item]) return;
  wallet -= PRICES[item];
  inv[item]++;
  saveWallet();
  saveInv();
  sfx.buy();
  refreshShop();
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
  pauseBtn.classList.remove('hidden');
}

function showHelp() {
  startScreen.classList.add('hidden');
  helpScreen.classList.remove('hidden');
}

function pauseGame() {
  if (state !== State.PLAYING) return;
  state = State.PAUSED;
  pauseScreen.classList.remove('hidden');
}

function resumeGame() {
  state = State.PLAYING;
  pauseScreen.classList.add('hidden');
}

function gameOver() {
  if (state !== State.PLAYING) return;
  state = State.OVER;
  sfx.die();
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    localStorage.setItem('jump-best', String(best));
  }
  $('final-score').textContent = String(score);
  $('final-coins').textContent = String(runCoins);
  $('final-best').textContent = `최고 기록 ${best}`;
  $('new-record').classList.toggle('hidden', !isRecord);
  overScreen.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
}

function goHome() {
  state = State.MENU;
  overScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  helpScreen.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  startScreen.classList.remove('hidden');
  refreshMenu();
}

$('btn-start').addEventListener('click', startGame);
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

// 탭 전환 시 자동 일시정지
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === State.PLAYING) pauseGame();
});

// ---------- 시작 ----------
newGame(); // 메뉴 뒤 배경용
refreshMenu();
loop();
