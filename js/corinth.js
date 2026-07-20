// corinth.js — コリントゲーム風「ビットコリント」。
// 右下の発射台から玉を上に弾く。玉は重力に従う自由物体で、台の枠(右上・左上はRカーブ)に
// 当たって跳ねる。弱いと上がって落ちて戻り、強いと上をぐるっと回って左(上位ビット)へ。
// 入ったスロット(=ビット)が立ち、同じ桁に2回入ると桁上げ。10球の8ビット値がスコア。
import { dropBall, valueToBits, formatHex, placeValues } from "./logic.js";
import {
  success,
  vibrate,
  screenFlash,
  beep,
  startMusic,
  stopMusic,
  setMusicEnabled,
  musicState,
} from "./fx.js";

const BITS = 8;
const BALLS = 10;
const BEST_KEY = "corinth.best";
const WEIGHTS = placeValues(BITS); // [128,64,...,1]（左=MSB）

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const wrap = document.getElementById("boardWrap");

const els = {
  value: document.getElementById("value"),
  hex: document.getElementById("hex"),
  balls: document.getElementById("balls"),
  overlay: document.getElementById("overlay"),
  overlayText: document.getElementById("overlayText"),
  startBtn: document.getElementById("startBtn"),
  bigmsg: document.getElementById("bigmsg"),
};

// --- レイアウト（cssピクセル単位で物理する） ---
let W = 0,
  H = 0,
  dpr = 1;
let pegs = [];
let dividers = [];
let slotTop = 0;
let binW = 0;
let fieldW = 0; // ビット穴が並ぶ幅（発射レーンを除いた盤面）
let laneW = 0; // 右端の発射/戻りレーン幅
let laneWallX = 0; // レーン内側の仕切り壁 x（= fieldW）
let stars = []; // 背景の星
const trail = []; // 玉の残像
const particles = []; // 火花パーティクル
const PEG_R = 5;
const BALL_R = 7;
const GRAVITY = 0.3;
const REST = 0.7; // ピン・仕切りの反発
const FRAME_REST = 0.55; // 台の枠の反発（そこそこ弾む）

// 台の枠（角丸長方形。上部の左右コーナーがRカーブ、下は開いてスロットへ）
let frameInset = 6;
let frameTopY = 0;
let cornerR = 0;
let ctrX = 0,
  ctrY = 0; // 右上コーナー円の中心
let ctlX = 0,
  ctlY = 0; // 左上コーナー円の中心

const state = {
  phase: "idle", // idle | ready | charging | inplay | over
  value: 0,
  ballsLeft: BALLS,
  charge: 0,
  ball: null, // {x,y,vx,vy}
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  flash: {}, // bit -> t0 繰り上がり連鎖の発光
  lastBit: -1,
};

function resize() {
  const rect = wrap.getBoundingClientRect();
  W = Math.max(240, rect.width);
  H = Math.max(320, rect.height);
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout();
}

function layout() {
  const slotH = Math.min(84, H * 0.16);
  slotTop = H - slotH;

  // 右端に発射/戻りレーン。ビット穴はそれを除いた fieldW に8つ並べる。
  laneW = Math.max(34, Math.min(48, W * 0.11));
  fieldW = W - laneW;
  laneWallX = fieldW;
  binW = fieldW / BITS;

  // スロットの仕切り（下部の縦壁）— フィールド内のみ
  dividers = [];
  for (let i = 1; i < BITS; i++) dividers.push(i * binW);

  // 枠（角丸長方形の上部）
  frameInset = 6;
  frameTopY = Math.max(10, H * 0.05);
  cornerR = Math.min(W * 0.34, (slotTop - frameTopY) * 0.42);
  ctrX = W - frameInset - cornerR;
  ctrY = frameTopY + cornerR;
  ctlX = frameInset + cornerR;
  ctlY = frameTopY + cornerR;

  // ピン（千鳥格子）。上部を大きく空けて、回り込んだ玉が左まで飛べるように。
  // 右端は発射レーンを空ける。左(上位ビット)側ほど釘を密にして難しく。
  pegs = [];
  const top = Math.max(ctrY + 40, slotTop - 200);
  const bottom = slotTop - 24;
  const rowGap = Math.max(40, (bottom - top) / 4);
  let row = 0;
  for (let y = top; y <= bottom; y += rowGap, row++) {
    const off = row % 2 ? binW * 0.5 : 0;
    for (let x = binW * 0.5 + off; x < fieldW - 6; x += binW) {
      pegs.push({ x, y });
    }
    // 左半分(上位側)は中間列を足して倍密度に
    const off2 = off ? 0 : binW * 0.5;
    for (let x = binW * 0.5 + off2; x < fieldW * 0.5; x += binW) {
      pegs.push({ x, y: y + rowGap * 0.5 });
    }
  }
  // ディフレクター釘:左上から右下への斜めライン。左に来た玉を右へ転がして
  // 上位ビット(左)への直行を防ぐ。釘間はぎりぎり玉が抜けられる間隔(運が良ければ通る)。
  const defN = 8;
  const defX0 = frameInset + 12;
  const defY0 = ctlY + 26;
  for (let i = 0; i < defN; i++) {
    pegs.push({ x: defX0 + i * binW * 0.62, y: defY0 + i * 15 });
  }
  // ガード釘:上位3スロット(bit7,6,5)の口の上に各2本
  for (let col = 0; col < 3; col++) {
    pegs.push({ x: col * binW + binW * 0.32, y: slotTop - 14 });
    pegs.push({ x: col * binW + binW * 0.68, y: slotTop - 14 });
  }

  // 背景の星(パララックス用)
  stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.5 + Math.random() * 1.3,
      p: Math.random() * Math.PI * 2, // 明滅位相
      s: 0.3 + Math.random() * 0.7, // 明滅速度
    });
  }
}

// --- ゲーム進行 ---
function launchOrigin() {
  return { x: fieldW + laneW / 2, y: slotTop - BALL_R - 2 };
}

function fire(charge) {
  if (state.phase !== "ready" && state.phase !== "charging") return;
  const c = Math.max(0, Math.min(1, charge));
  const o = launchOrigin();
  const s = H / 560;
  state.ball = {
    x: o.x,
    y: o.y,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -(12 + 12 * c) * s, // 真上に弾く。ごく弱い=上がって落ちて戻る、強い=上を回って左へ
    age: 0,
  };
  state.phase = "inplay";
  // のこり玉はビット穴に着弾したときだけ減らす（戻り球は消費しない）
  state.charge = 0;
  beep(300 + c * 500, 0.08);
  vibrate(10);
  renderHud();
}

// 角丸長方形の枠との衝突（左右の壁・天井・上部の丸コーナー）。
function frameCollide(b) {
  const left = frameInset + BALL_R;
  const right = W - frameInset - BALL_R;
  const ceil = frameTopY + BALL_R;
  if (b.y < ctrY) {
    if (b.x > ctrX) {
      arcConstrain(b, ctrX, ctrY);
    } else if (b.x < ctlX) {
      arcConstrain(b, ctlX, ctlY);
    } else if (b.y < ceil) {
      b.y = ceil;
      b.vy = Math.abs(b.vy) * FRAME_REST;
    }
  } else {
    // 外壁(左壁は強めに弾いて、上位ビット側への張り付きを防ぐ)
    if (b.x > right) {
      b.x = right;
      b.vx = -Math.abs(b.vx) * FRAME_REST;
    } else if (b.x < left) {
      b.x = left;
      b.vx = Math.abs(b.vx) * 0.85;
    }
    // 内側の仕切り壁（発射/戻りレーン ⇔ フィールド）。ctrY より下だけ塞ぐ。
    if (b.x >= laneWallX && b.x - BALL_R < laneWallX) {
      b.x = laneWallX + BALL_R;
      b.vx = Math.abs(b.vx) * FRAME_REST;
    } else if (b.x < laneWallX && b.x + BALL_R > laneWallX) {
      b.x = laneWallX - BALL_R;
      b.vx = -Math.abs(b.vx) * FRAME_REST;
    }
  }
}

// コーナー円の内側に閉じ込める（外側へ出たら法線反射）。
function arcConstrain(b, cx, cy) {
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const maxD = cornerR - BALL_R;
  if (d > maxD) {
    const nx = dx / d;
    const ny = dy / d;
    b.x = cx + nx * maxD;
    b.y = cy + ny * maxD;
    const dot = b.vx * nx + b.vy * ny;
    if (dot > 0) {
      b.vx = (b.vx - 2 * dot * nx) * FRAME_REST;
      b.vy = (b.vy - 2 * dot * ny) * FRAME_REST;
    }
  }
}

// 火花パーティクルを発生させる
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3.5;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1.5,
      life: 1,
      decay: 0.02 + Math.random() * 0.03,
      color,
      r: 1.5 + Math.random() * 2,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += GRAVITY * 0.35;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// 玉が発射/戻りレーンの底に達した = 発射台に戻る。消費せず撃ち直せる。
function returnBall() {
  state.ball = null;
  trail.length = 0;
  beep(180, 0.12, "sine", 0.04);
  vibrate(8);
  state.phase = "ready";
}

function settleBall(bit) {
  state.lastBit = bit;
  state.ballsLeft -= 1; // ビット穴に入った時だけ消費
  const prev = state.value;
  const res = dropBall(prev, bit, BITS);
  state.value = res.value;

  // 変化したビットを下位から順に光らせる（繰り上がりの連鎖）
  const changed = prev ^ state.value;
  const now = performance.now();
  for (let p = 0; p < BITS; p++) {
    if ((changed >> p) & 1) state.flash[p] = now + p * 80;
  }

  const px = state.ball ? state.ball.x : (BITS - 1 - bit) * binW + binW / 2;
  const py = state.ball ? Math.min(state.ball.y, H - 20) : slotTop + 20;
  const carried = (prev >> bit) & 1; // 既に立っていた=桁上げ発生
  if (res.overflow) {
    showBigMsg("MAX! 0xFF");
    screenFlash("win");
    success(9);
    vibrate([20, 40, 80]);
    spawnParticles(px, py, "#facc15", 40);
    spawnParticles(px, py, "#22c55e", 24);
  } else if (carried) {
    showBigMsg("桁上がり！");
    screenFlash("win");
    success(6);
    vibrate([20, 40, 60]);
    spawnParticles(px, py, "#22c55e", 28);
  } else {
    success(2);
    vibrate(15);
    spawnParticles(px, py, "#facc15", 14);
  }

  state.ball = null;
  trail.length = 0;
  renderHud();

  if (state.ballsLeft <= 0) {
    setTimeout(endGame, 500);
  } else {
    state.phase = "ready";
  }
}

function step() {
  if (state.phase === "charging") {
    state.charge = Math.min(1, state.charge + 0.9 / 60);
  }
  updateParticles();
  const b = state.ball;
  if (!b || state.phase !== "inplay") return;

  b.age = (b.age || 0) + 1;
  b.vy += GRAVITY;
  b.x += b.vx;
  b.y += b.vy;

  // 残像トレイル
  trail.push({ x: b.x, y: b.y });
  if (trail.length > 14) trail.shift();

  // ピンの上などで止まりかけたら軽く突いて詰まりを防ぐ(長引くほど強め・下向きに)
  if (Math.abs(b.vx) < 0.3 && Math.abs(b.vy) < 0.5) {
    b.vx += (Math.random() - 0.5) * 1.6;
    if (b.age > 240) b.vy += 0.8;
  }

  // 台の枠
  frameCollide(b);

  // スロット領域より上ではピンに当たる
  if (b.y < slotTop) {
    for (const p of pegs) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      const min = BALL_R + PEG_R;
      if (d > 0 && d < min) {
        const nx = dx / d;
        const ny = dy / d;
        b.x = p.x + nx * min;
        b.y = p.y + ny * min;
        const dot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * dot * nx) * REST;
        b.vy = (b.vy - 2 * dot * ny) * REST;
        b.vx += (Math.random() - 0.5) * 0.3; // ほんの少し散らす
        p.hit = performance.now(); // 発光パルス用
      }
    }
  } else {
    // スロット内は仕切り壁で誘導
    for (const dx0 of dividers) {
      if (Math.abs(b.x - dx0) < BALL_R) {
        if (b.x < dx0) {
          b.x = dx0 - BALL_R;
          b.vx = -Math.abs(b.vx) * REST;
        } else {
          b.x = dx0 + BALL_R;
          b.vx = Math.abs(b.vx) * REST;
        }
      }
    }
  }

  // 着地（最下部に到達、またはスロット内で静止、または長時間経過で強制確定）
  const landed = b.y >= H - BALL_R;
  const restingLow = b.y > slotTop + 6 && Math.abs(b.vy) < 0.6 && Math.abs(b.vx) < 0.6;
  const tooLong = b.age > 420; // ~7秒で強制確定（詰まり保険）
  if (landed || restingLow || tooLong) {
    if (b.x >= laneWallX) {
      returnBall(); // 発射/戻りレーンの底 → 発射台に戻る（ビット穴に入らない）
    } else {
      const col = Math.max(0, Math.min(BITS - 1, Math.floor(b.x / binW)));
      settleBall(BITS - 1 - col); // 左端(col0)=MSB=bit7
    }
  }
}

// --- 描画 ---
function drawFramePath() {
  const rightX = W - frameInset;
  const leftX = frameInset;
  ctx.beginPath();
  ctx.moveTo(rightX, slotTop);
  ctx.lineTo(rightX, ctrY); // 右の壁
  ctx.arc(ctrX, ctrY, cornerR, 0, -Math.PI / 2, true); // 右上のRカーブ
  ctx.lineTo(ctlX, frameTopY); // 天井
  ctx.arc(ctlX, ctlY, cornerR, -Math.PI / 2, -Math.PI, true); // 左上のRカーブ
  ctx.lineTo(leftX, slotTop); // 左の壁
}

function draw() {
  const now = performance.now();

  // 背景:縦グラデ＋明滅する星
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, "#101832");
  bgGrad.addColorStop(0.55, "#0b1226");
  bgGrad.addColorStop(1, "#070b18");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  for (const st of stars) {
    const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * st.s + st.p));
    ctx.fillStyle = `rgba(160,190,255,${tw})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 台の枠:ネオン発光の二重ストローク
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "rgba(56,189,248,0.85)";
  ctx.lineWidth = 3.5;
  drawFramePath();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(230,240,255,0.9)";
  ctx.lineWidth = 1.2;
  drawFramePath();
  ctx.stroke();

  // レーン仕切り壁(同トーンのネオン)
  ctx.shadowColor = "#7c3aed";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(167,139,250,0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(laneWallX, ctrY);
  ctx.lineTo(laneWallX, H - 4);
  ctx.stroke();
  ctx.restore();

  // 戻りガター
  ctx.fillStyle = "rgba(12,16,34,0.9)";
  roundRect(laneWallX + 3, slotTop + 2, W - laneWallX - 6, H - slotTop - 4, 8);
  ctx.fill();

  // 釘:金属質グラデ＋ヒット発光パルス
  for (const p of pegs) {
    const hitAge = p.hit ? now - p.hit : Infinity;
    if (hitAge < 260) {
      const a = 1 - hitAge / 260;
      ctx.fillStyle = `rgba(56,189,248,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PEG_R + 6 * a, 0, Math.PI * 2);
      ctx.fill();
    }
    const pg = ctx.createRadialGradient(p.x - 1.5, p.y - 1.5, 0.5, p.x, p.y, PEG_R);
    pg.addColorStop(0, "#c7d4ff");
    pg.addColorStop(0.5, "#6b7bb0");
    pg.addColorStop(1, "#39456e");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // スロット(8ビット):ON=金色に脈動、桁上げ連鎖=緑の波及発光
  const bits = valueToBits(state.value, BITS); // MSB→LSB
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
  for (let col = 0; col < BITS; col++) {
    const bit = BITS - 1 - col;
    const on = bits[col] === 1;
    const x = col * binW;
    const ft = state.flash[bit];
    let flashA = 0;
    if (ft != null) {
      const dt = now - ft;
      if (dt >= 0 && dt < 420) flashA = 1 - dt / 420;
      if (dt >= 420) delete state.flash[bit];
    }

    ctx.save();
    const cellGrad = ctx.createLinearGradient(0, slotTop, 0, H);
    if (flashA > 0) {
      cellGrad.addColorStop(0, "#34d97b");
      cellGrad.addColorStop(1, "#15803d");
      ctx.shadowColor = "#22c55e";
      ctx.shadowBlur = 22 * flashA;
    } else if (on) {
      cellGrad.addColorStop(0, "#ffe066");
      cellGrad.addColorStop(1, "#d99a06");
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 10 + 8 * pulse;
    } else {
      cellGrad.addColorStop(0, "#1d2745");
      cellGrad.addColorStop(1, "#141b33");
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = cellGrad;
    roundRect(x + 2, slotTop + 2, binW - 4, H - slotTop - 4, 8);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = on || flashA > 0 ? "#131022" : "#8b97c4";
    ctx.font = `800 ${Math.min(22, binW * 0.5)}px system-ui, sans-serif`;
    ctx.fillText(on ? "1" : "0", x + binW / 2, slotTop + (H - slotTop) * 0.42);
    ctx.fillStyle = on || flashA > 0 ? "rgba(19,16,34,0.75)" : "#5b6690";
    ctx.font = `700 ${Math.min(11, binW * 0.28)}px system-ui, sans-serif`;
    ctx.fillText(String(WEIGHTS[col]), x + binW / 2, slotTop + (H - slotTop) * 0.8);
  }

  // パワーメーター:グラデ＋先端の明滅
  const o = launchOrigin();
  const meterTop = Math.max(frameTopY + 8, slotTop - 120);
  const meterBot = slotTop - 8;
  ctx.fillStyle = "rgba(42,51,88,0.9)";
  roundRect(W - 6, meterTop, 4, meterBot - meterTop, 2);
  ctx.fill();
  if (state.phase === "charging" || state.charge > 0) {
    const h = (meterBot - meterTop) * state.charge;
    const mg = ctx.createLinearGradient(0, meterBot, 0, meterBot - h);
    mg.addColorStop(0, "#38bdf8");
    mg.addColorStop(1, state.charge > 0.75 ? "#ef4444" : "#a78bfa");
    ctx.save();
    ctx.shadowColor = state.charge > 0.75 ? "#ef4444" : "#38bdf8";
    ctx.shadowBlur = 8 + 6 * pulse;
    ctx.fillStyle = mg;
    roundRect(W - 6, meterBot - h, 4, h, 2);
    ctx.fill();
    ctx.restore();
  }

  // プランジャー(ネオン三角)
  ctx.save();
  ctx.shadowColor = "#a78bfa";
  ctx.shadowBlur = 12;
  const plGrad = ctx.createLinearGradient(0, slotTop - 18, 0, slotTop);
  plGrad.addColorStop(0, "#a78bfa");
  plGrad.addColorStop(1, "#6d28d9");
  ctx.fillStyle = plGrad;
  ctx.beginPath();
  ctx.moveTo(o.x - 9, slotTop - 2);
  ctx.lineTo(o.x + 9, slotTop - 2);
  ctx.lineTo(o.x, slotTop - 18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // パーティクル(加算合成で火花らしく)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // 玉:残像トレイル＋光沢球
  if (state.ball) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      const a = ((i + 1) / trail.length) * 0.35;
      ctx.fillStyle = `rgba(140,200,255,${a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.4 + (0.6 * (i + 1)) / trail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const b = state.ball;
    ctx.save();
    ctx.shadowColor = "#bfdbfe";
    ctx.shadowBlur = 12;
    const ballGrad = ctx.createRadialGradient(b.x - 2.5, b.y - 2.5, 1, b.x, b.y, BALL_R);
    ballGrad.addColorStop(0, "#ffffff");
    ballGrad.addColorStop(0.5, "#dbe6ff");
    ballGrad.addColorStop(1, "#8fa3d9");
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (state.phase === "ready") {
    ctx.fillStyle = "rgba(230,236,255,0.55)";
    ctx.beginPath();
    ctx.arc(o.x, o.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loop() {
  step();
  draw();
  requestAnimationFrame(loop);
}

// --- HUD / overlay ---
function renderHud() {
  els.value.textContent = String(state.value);
  els.hex.textContent = formatHex(state.value, BITS);
  els.balls.textContent = String(state.ballsLeft);
}

function showBigMsg(text) {
  els.bigmsg.textContent = text;
  els.bigmsg.classList.remove("show");
  void els.bigmsg.offsetWidth;
  els.bigmsg.classList.add("show");
}

function beginGame() {
  els.overlay.hidden = true;
  state.value = 0;
  state.ballsLeft = BALLS;
  state.ball = null;
  state.charge = 0;
  state.flash = {};
  trail.length = 0;
  particles.length = 0;
  state.phase = "ready";
  startMusic(); // ユーザー操作(スタートボタン)直後なので再生できる
  renderHud();
}

function endGame() {
  state.phase = "over";
  stopMusic();
  if (state.value > state.best) {
    state.best = state.value;
    localStorage.setItem(BEST_KEY, String(state.best));
  }
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  big.textContent = state.value === 255 ? "🏆" : "🏁";
  title.textContent = "ゲームおわり";
  els.overlayText.innerHTML =
    `スコア <b>${state.value}</b>（${formatHex(state.value, BITS)} / ` +
    `${valueToBits(state.value, BITS).join("")}）<br>BEST <b>${state.best}</b>`;
  els.startBtn.textContent = "もう1回";
  els.overlay.hidden = false;
}

// --- 入力（パチンコ式チャージ） ---
function onDown(e) {
  if (state.phase !== "ready") return;
  e.preventDefault();
  state.phase = "charging";
  state.charge = 0;
}
function onUp(e) {
  if (state.phase !== "charging") return;
  e.preventDefault();
  fire(state.charge);
}
canvas.addEventListener("pointerdown", onDown);
window.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);

els.startBtn.addEventListener("click", beginGame);
window.addEventListener("resize", resize);

// BGMトグル(設定を保存)
const MUSIC_KEY = "corinth.music";
const musicBtn = document.getElementById("musicBtn");
let musicOn = localStorage.getItem(MUSIC_KEY) !== "0";
function renderMusicBtn() {
  musicBtn.textContent = musicOn ? "🔊 BGM" : "🔇 BGM";
}
setMusicEnabled(musicOn);
renderMusicBtn();
musicBtn.addEventListener("click", () => {
  musicOn = !musicOn;
  localStorage.setItem(MUSIC_KEY, musicOn ? "1" : "0");
  setMusicEnabled(musicOn);
  // プレイ中にONへ戻したときは即再開
  if (musicOn && (state.phase === "ready" || state.phase === "inplay" || state.phase === "charging")) {
    startMusic();
  }
  renderMusicBtn();
});

// テスト用フック（物理に依存せず検証するため）
window.__corinth = {
  fire: (c) => fire(c),
  dropAt: (bit) => settleBall(bit),
  state: () => ({
    value: state.value,
    ballsLeft: state.ballsLeft,
    phase: state.phase,
    lastBit: state.lastBit,
    bx: state.ball ? Math.round(state.ball.x) : null,
    by: state.ball ? Math.round(state.ball.y) : null,
  }),
  music: () => musicState(),
};

resize();
renderHud();
requestAnimationFrame(loop);
