// corinth.js — コリントゲーム風「ビットコリント」。
// 右下の発射台から玉を上に弾く。玉は重力に従う自由物体で、台の枠(右上・左上はRカーブ)に
// 当たって跳ねる。弱いと上がって落ちて戻り、強いと上をぐるっと回って左(上位ビット)へ。
// 入ったスロット(=ビット)が立ち、同じ桁に2回入ると桁上げ。10球の8ビット値がスコア。
import { dropBall, valueToBits, formatHex, placeValues } from "./logic.js";
import { success, fail, vibrate, screenFlash, beep } from "./fx.js";

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
const LAUNCH_LANE = 34; // 右の発射レーン幅（ピンを置かない）

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
  binW = W / BITS;
  const slotH = Math.min(84, H * 0.16);
  slotTop = H - slotH;

  // スロットの仕切り（下部の縦壁）
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
  // 右端は発射レーンを空ける。
  pegs = [];
  const top = Math.max(ctrY + 40, slotTop - 200);
  const bottom = slotTop - 24;
  const rowGap = Math.max(40, (bottom - top) / 4);
  let row = 0;
  for (let y = top; y <= bottom; y += rowGap, row++) {
    const off = row % 2 ? binW * 0.5 : 0;
    for (let x = binW * 0.5 + off; x < W - LAUNCH_LANE; x += binW) {
      pegs.push({ x, y });
    }
  }
}

// --- ゲーム進行 ---
function launchOrigin() {
  return { x: W - frameInset - BALL_R - 3, y: slotTop - BALL_R - 2 };
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
  state.ballsLeft -= 1;
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
    if (b.x > right) {
      b.x = right;
      b.vx = -Math.abs(b.vx) * FRAME_REST;
    } else if (b.x < left) {
      b.x = left;
      b.vx = Math.abs(b.vx) * FRAME_REST;
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

function settleBall(bit) {
  state.lastBit = bit;
  const prev = state.value;
  const res = dropBall(prev, bit, BITS);
  state.value = res.value;

  // 変化したビットを下位から順に光らせる（繰り上がりの連鎖）
  const changed = prev ^ state.value;
  const now = performance.now();
  for (let p = 0; p < BITS; p++) {
    if ((changed >> p) & 1) state.flash[p] = now + p * 80;
  }

  const carried = (prev >> bit) & 1; // 既に立っていた=桁上げ発生
  if (res.overflow) {
    showBigMsg("MAX! 0xFF");
    screenFlash("win");
    success(9);
    vibrate([20, 40, 80]);
  } else if (carried) {
    showBigMsg("桁上がり！");
    screenFlash("win");
    success(6);
    vibrate([20, 40, 60]);
  } else {
    success(2);
    vibrate(15);
  }

  state.ball = null;
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
  const b = state.ball;
  if (!b || state.phase !== "inplay") return;

  b.age = (b.age || 0) + 1;
  b.vy += GRAVITY;
  b.x += b.vx;
  b.y += b.vy;

  // ピンの上などで止まりかけたら軽く突いて詰まりを防ぐ
  if (Math.abs(b.vx) < 0.3 && Math.abs(b.vy) < 0.5) {
    b.vx += (Math.random() - 0.5) * 1.6;
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
  const restingInSlot = b.y > slotTop + 6 && Math.abs(b.vy) < 0.6 && Math.abs(b.vx) < 0.6;
  const tooLong = b.age > 600; // ~10秒で強制確定（詰まり保険）
  if (landed || restingInSlot || tooLong) {
    const col = Math.max(0, Math.min(BITS - 1, Math.floor(b.x / binW)));
    const bit = BITS - 1 - col; // 左端(col0)=MSB=bit7
    settleBall(bit);
  }
}

// --- 描画 ---
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 台の枠（右上・左上がRカーブの角丸フレーム。下は開放）
  const rightX = W - frameInset;
  const leftX = frameInset;
  ctx.strokeStyle = "#5b6690";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(rightX, slotTop);
  ctx.lineTo(rightX, ctrY); // 右の壁
  ctx.arc(ctrX, ctrY, cornerR, 0, -Math.PI / 2, true); // 右上のRカーブ
  ctx.lineTo(ctlX, frameTopY); // 天井
  ctx.arc(ctlX, ctlY, cornerR, -Math.PI / 2, -Math.PI, true); // 左上のRカーブ
  ctx.lineTo(leftX, slotTop); // 左の壁
  ctx.stroke();

  // ピン
  ctx.fillStyle = "#4a5680";
  for (const p of pegs) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // スロット（8ビット）
  const bits = valueToBits(state.value, BITS); // MSB→LSB
  const now = performance.now();
  for (let col = 0; col < BITS; col++) {
    const bit = BITS - 1 - col;
    const on = bits[col] === 1;
    const x = col * binW;
    let bg = on ? "#facc15" : "#222c49";
    const ft = state.flash[bit];
    if (ft != null) {
      const dt = now - ft;
      if (dt >= 0 && dt < 420) bg = "#22c55e";
      if (dt >= 420) delete state.flash[bit];
    }
    ctx.fillStyle = bg;
    roundRect(x + 2, slotTop + 2, binW - 4, H - slotTop - 4, 8);
    ctx.fill();
    ctx.fillStyle = on ? "#1a1730" : "#8b97c4";
    ctx.font = `700 ${Math.min(22, binW * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(on ? "1" : "0", x + binW / 2, slotTop + (H - slotTop) * 0.42);
    ctx.fillStyle = on ? "#1a1730" : "#5b6690";
    ctx.font = `600 ${Math.min(11, binW * 0.28)}px system-ui, sans-serif`;
    ctx.fillText(String(WEIGHTS[col]), x + binW / 2, slotTop + (H - slotTop) * 0.8);
  }

  // パワーメーター（右端の細バー）＋発射台
  const o = launchOrigin();
  const meterTop = Math.max(frameTopY + 8, slotTop - 120);
  const meterBot = slotTop - 8;
  ctx.fillStyle = "#2a3358";
  roundRect(W - 6, meterTop, 4, meterBot - meterTop, 2);
  ctx.fill();
  if (state.phase === "charging" || state.charge > 0) {
    const h = (meterBot - meterTop) * state.charge;
    ctx.fillStyle = state.charge > 0.75 ? "#ef4444" : "#38bdf8";
    roundRect(W - 6, meterBot - h, 4, h, 2);
    ctx.fill();
  }
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.moveTo(o.x - 9, slotTop - 2);
  ctx.lineTo(o.x + 9, slotTop - 2);
  ctx.lineTo(o.x, slotTop - 18);
  ctx.closePath();
  ctx.fill();

  // 玉
  if (state.ball) {
    ctx.fillStyle = "#e6ecff";
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.phase === "ready") {
    ctx.fillStyle = "rgba(230,236,255,0.6)";
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
  state.phase = "ready";
  renderHud();
}

function endGame() {
  state.phase = "over";
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
};

resize();
renderHud();
requestAnimationFrame(loop);
