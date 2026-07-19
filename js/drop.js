// drop.js — 案B:落ちものパズル。
import { formatTarget, randomTarget } from "./logic.js";
import { createBitRow } from "./ui-bits.js";
import { success, fail, vibrate, screenFlash, beep } from "./fx.js";

const WIDTH = 4;
const DANGER = 6; // これだけ積むとゲームオーバー
const ROW = 25; // スタック1段の高さ(CSS: 22px + gap 3px)
const START_SPEED = 80; // px/秒
const SPEED_PER_CLEAR = 6; // クリアごとの加速
const MAX_SPEED = 280;

const els = {
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  next: document.getElementById("next"),
  field: document.getElementById("field"),
  dangerline: document.getElementById("dangerline"),
  block: document.getElementById("block"),
  stack: document.getElementById("stack"),
  current: document.getElementById("current"),
  bits: document.getElementById("bits"),
  weights: document.getElementById("weights"),
  overlay: document.getElementById("overlay"),
  overlayText: document.getElementById("overlayText"),
  startBtn: document.getElementById("startBtn"),
};

const state = {
  phase: "ready", // ready | playing | result
  score: 0,
  combo: 1,
  cleared: 0,
  stack: 0,
  block: null, // {value, mode, y}
  next: null,
  active: false,
  fieldH: 0,
  blockH: 0,
  lastFrame: 0,
  best: Number(localStorage.getItem("drop.best") || 0),
};

const row = createBitRow(els.bits, WIDTH, onBitsChange);

function genPiece() {
  let v = randomTarget(WIDTH);
  if (v === 0) v = 1;
  return { value: v, mode: Math.random() < 0.5 ? "dec" : "hex" };
}

function measureField() {
  state.fieldH = els.field.clientHeight;
  els.dangerline.style.top = `${state.fieldH - DANGER * ROW}px`;
}

function onBitsChange(value) {
  els.current.innerHTML = `合わせろ！ いま <b>${value}</b>`;
  const match = state.block && value === state.block.value;
  els.current.classList.toggle("match", !!match);
  if (state.phase === "playing" && state.active && match) clearBlock();
}

function speed() {
  return Math.min(MAX_SPEED, START_SPEED + state.cleared * SPEED_PER_CLEAR);
}

function spawn() {
  const piece = state.next || genPiece();
  state.block = { ...piece, y: 0 };
  els.block.textContent = formatTarget(piece.value, piece.mode, WIDTH);
  els.block.hidden = false;
  els.block.classList.remove("clear");
  els.block.style.top = "0px";
  state.blockH = els.block.offsetHeight;
  state.active = true;
  row.reset();

  state.next = genPiece();
  els.next.textContent = formatTarget(state.next.value, state.next.mode, WIDTH);
}

function clearBlock() {
  state.active = false;
  state.score += 100 * state.combo;
  state.combo += 1;
  state.cleared += 1;
  els.block.classList.add("clear");
  success(state.combo);
  vibrate(25);
  screenFlash("win");
  bumpCombo();
  renderHud();
  setTimeout(() => {
    if (state.phase === "playing") spawn();
  }, 220);
}

function landBlock() {
  state.active = false;
  state.combo = 1;
  addStackRow();
  state.stack += 1;
  fail();
  vibrate([40, 30, 40]);
  screenFlash("bad");
  els.field.classList.remove("shake");
  void els.field.offsetWidth;
  els.field.classList.add("shake");
  renderHud();
  if (state.stack >= DANGER) {
    endGame();
  } else {
    els.block.hidden = true;
    setTimeout(() => {
      if (state.phase === "playing") spawn();
    }, 220);
  }
}

function addStackRow() {
  const r = document.createElement("div");
  r.className = "stack__row";
  els.stack.append(r);
}

function bumpCombo() {
  els.combo.classList.remove("bump");
  void els.combo.offsetWidth;
  els.combo.classList.add("bump");
}

function renderHud() {
  els.score.textContent = String(state.score);
  els.combo.textContent = `×${state.combo}`;
}

function loop(ts) {
  if (state.phase !== "playing") return;
  if (!state.lastFrame) state.lastFrame = ts;
  const dt = ts - state.lastFrame;
  state.lastFrame = ts;

  if (state.active && state.block) {
    state.block.y += (speed() * dt) / 1000;
    const landingTop = state.fieldH - state.blockH - state.stack * ROW;
    if (state.block.y >= landingTop) {
      state.block.y = landingTop;
      els.block.style.top = `${landingTop}px`;
      landBlock();
    } else {
      els.block.style.top = `${state.block.y}px`;
    }
  }
  requestAnimationFrame(loop);
}

function beginPlay() {
  els.overlay.hidden = true;
  measureField();
  state.phase = "playing";
  state.score = 0;
  state.combo = 1;
  state.cleared = 0;
  state.stack = 0;
  state.lastFrame = 0;
  state.next = null;
  els.stack.innerHTML = "";
  renderHud();
  spawn();
  requestAnimationFrame(loop);
}

function endGame() {
  state.phase = "result";
  state.active = false;
  els.block.hidden = true;
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("drop.best", String(state.best));
  }
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  big.textContent = "💥";
  title.textContent = "ゲームオーバー";
  els.overlayText.innerHTML = `SCORE <b>${state.score}</b> ／ BEST <b>${state.best}</b>`;
  els.startBtn.textContent = "もう1回";
  els.overlay.hidden = false;
}

// --- init ---
els.startBtn.addEventListener("click", () => {
  beep(660, 0.1);
  beginPlay();
});
els.weights.addEventListener("change", () => row.setWeightsVisible(els.weights.checked));
row.setWeightsVisible(true);
window.addEventListener("resize", () => {
  if (state.phase === "playing") measureField();
});
renderHud();
