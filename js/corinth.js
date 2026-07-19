// corinth.js — コリントゲーム風「ビットコリント」。
// 右の発射台からパチンコ式に玉を弾き、8つのスロット(=8ビット)に着弾させて値を大きくする。
// 同じ桁に2回入ると桁上げ(繰り上がり)。10球撃ち切った時の8ビット値がスコア。
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
const REST = 0.7; // ピンの反発
const WALL_REST = 0.32; // 壁は横の勢いを吸収（強い玉が跳ね返らず落ちる）

const state = {
  phase: "idle", // idle | ready | charging | inplay | over
  value: 0,
  ballsLeft: BALLS,
  charge: 0,
  ball: null, // {x,y,vx,vy}
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  flash: {}, // bit -> {t0} 繰り上がり連鎖の発光
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

  // ピン（千鳥格子）。上部は「空」にして玉が弧を描いて左へ届くようにし、
  // 下半分にピンを置いて散らす。
  pegs = [];
  const top = H * 0.46;
  const bottom = slotTop - 24;
  const rowGap = Math.max(40, (bottom - top) / 4);
  let row = 0;
  for (let y = top; y <= bottom; y += rowGap, row++) {
    const off = row % 2 ? binW * 0.5 : 0;
    for (let x = binW * 0.5 + off; x < W - 6; x += binW) {
      pegs.push({ x, y });
    }
  }
}

// --- ゲーム進行 ---
function launchOrigin() {
  return { x: W - 20, y: H - 30 };
}

function fire(charge) {
  if (state.phase !== "ready" && state.phase !== "charging") return;
  const o = launchOrigin();
  const c = Math.max(0, Math.min(1, charge));
  const s = H / 560; // 画面サイズでスケール
  state.ball = {
    x: o.x,
    y: o.y,
    vx: -(0.6 + 7.6 * c) * s, // 弱=ほぼ真下(右/下位)、強=左端(上位)
    vy: -(10.5 + 9.0 * c) * s, // 滞空。左への到達距離を調整
  };
  state.phase = "inplay";
  state.ballsLeft -= 1;
  state.charge = 0;
  beep(300 + c * 500, 0.08);
  vibrate(10);
  renderHud();
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
  if (b && state.phase === "inplay") {
    b.vy += GRAVITY;
    b.x += b.vx;
    b.y += b.vy;

    // 壁（横の勢いを吸収 = 強い玉が跳ね返らず左に落ちる）
    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx) * WALL_REST;
    }
    if (b.x > W - BALL_R) {
      b.x = W - BALL_R;
      b.vx = -Math.abs(b.vx) * WALL_REST;
    }
    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy) * WALL_REST;
    }

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
          // 押し出し
          b.x = p.x + nx * min;
          b.y = p.y + ny * min;
          // 反射
          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * REST;
          b.vy = (b.vy - 2 * dot * ny) * REST;
          // ほんの少しの散らし
          b.vx += (Math.random() - 0.5) * 0.3;
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

    // 着地
    if (b.y >= H - BALL_R) {
      const col = Math.max(0, Math.min(BITS - 1, Math.floor(b.x / binW)));
      const bit = BITS - 1 - col; // 左端(col0)=MSB=bit7
      settleBall(bit);
    }
  }
}

// --- 描画 ---
function draw() {
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H);

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
    // セル背景
    let bg = on ? "#facc15" : "#222c49";
    // 繰り上がり連鎖の発光
    const ft = state.flash[bit];
    if (ft != null) {
      const dt = now - ft;
      if (dt >= 0 && dt < 420) bg = "#22c55e";
      if (dt >= 420) delete state.flash[bit];
    }
    ctx.fillStyle = bg;
    roundRect(x + 2, slotTop + 2, binW - 4, H - slotTop - 4, 8);
    ctx.fill();
    // 0/1
    ctx.fillStyle = on ? "#1a1730" : "#8b97c4";
    ctx.font = `700 ${Math.min(22, binW * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(on ? "1" : "0", x + binW / 2, slotTop + (H - slotTop) * 0.42);
    // 重み
    ctx.fillStyle = on ? "#1a1730" : "#5b6690";
    ctx.font = `600 ${Math.min(11, binW * 0.28)}px system-ui, sans-serif`;
    ctx.fillText(String(WEIGHTS[col]), x + binW / 2, slotTop + (H - slotTop) * 0.8);
  }

  // パワーメーター（スロットの上・右端。スロットに被らない位置）
  const o = launchOrigin();
  const meterTop = Math.max(20, slotTop - 120);
  const meterBot = slotTop - 10;
  ctx.fillStyle = "#2a3358";
  roundRect(W - 15, meterTop, 9, meterBot - meterTop, 5);
  ctx.fill();
  if (state.phase === "charging" || state.charge > 0) {
    const h = (meterBot - meterTop) * state.charge;
    ctx.fillStyle = state.charge > 0.75 ? "#ef4444" : "#38bdf8";
    roundRect(W - 14, meterBot - h, 7, h, 4);
    ctx.fill();
  }
  // 発射台（小さなプランジャー）
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.moveTo(o.x - 9, H - 5);
  ctx.lineTo(o.x + 9, H - 5);
  ctx.lineTo(o.x, H - 22);
  ctx.closePath();
  ctx.fill();

  // 玉
  if (state.ball) {
    ctx.fillStyle = "#e6ecff";
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.phase === "ready") {
    // 次弾のプレビュー
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
  state: () => ({ value: state.value, ballsLeft: state.ballsLeft, phase: state.phase, lastBit: state.lastBit }),
};

resize();
renderHud();
requestAnimationFrame(loop);
