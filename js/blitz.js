// blitz.js — 案A:スピード変換アーケード。
import { formatTarget, randomTarget } from "./logic.js";
import { createBitRow } from "./ui-bits.js";
import { success, fail, vibrate, screenFlash, beep } from "./fx.js";

const WIDTH = 4;
const START_TIME = 6000; // お題ごとの持ち時間(ms)
const TIME_DECAY = 0.95; // 正解ごとに短縮
const MIN_TIME = 2500;
const BEST_KEY = "blitz.best";

const els = {
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  lives: document.getElementById("lives"),
  timefill: document.getElementById("timefill"),
  base: document.getElementById("base"),
  target: document.getElementById("target"),
  current: document.getElementById("current"),
  bits: document.getElementById("bits"),
  weights: document.getElementById("weights"),
  overlay: document.getElementById("overlay"),
  overlayText: document.getElementById("overlayText"),
  startBtn: document.getElementById("startBtn"),
};

const state = {
  phase: "ready", // ready | countdown | playing | result
  score: 0,
  combo: 1,
  lives: 3,
  timePerTarget: START_TIME,
  remaining: START_TIME,
  target: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  lastFrame: 0,
  resolving: false,
};

const row = createBitRow(els.bits, WIDTH, onBitsChange);

function onBitsChange(value) {
  els.current.innerHTML = `いま <b>${value}</b>`;
  const match = value === state.target;
  els.current.classList.toggle("match", match);
  if (state.phase === "playing" && !state.resolving && match) onCorrect();
}

function newTarget() {
  let v = randomTarget(WIDTH);
  if (v === 0) v = 1; // 全ゼロは出さない
  state.target = v;
  const mode = Math.random() < 0.5 ? "dec" : "hex";
  els.base.textContent = mode === "dec" ? "10進" : "16進";
  els.target.textContent = formatTarget(v, mode, WIDTH);
  row.reset();
  state.remaining = state.timePerTarget;
  state.resolving = false;
}

function onCorrect() {
  state.resolving = true;
  state.score += 100 * state.combo;
  state.combo += 1;
  row.flashWin();
  success(state.combo);
  vibrate(25);
  screenFlash("win");
  bumpCombo();
  renderHud();
  // 少し待って次のお題(演出を見せる)
  state.timePerTarget = Math.max(MIN_TIME, state.timePerTarget * TIME_DECAY);
  setTimeout(() => {
    if (state.phase === "playing") newTarget();
  }, 380);
}

function onTimeout() {
  state.lives -= 1;
  state.combo = 1;
  fail();
  vibrate([40, 30, 40]);
  screenFlash("bad");
  renderHud();
  if (state.lives <= 0) {
    endGame();
  } else {
    newTarget();
  }
}

function bumpCombo() {
  els.combo.classList.remove("bump");
  void els.combo.offsetWidth;
  els.combo.classList.add("bump");
}

function renderHud() {
  els.score.textContent = String(state.score);
  els.combo.textContent = `×${state.combo}`;
  els.lives.textContent = "❤".repeat(Math.max(0, state.lives)) || "―";
}

function loop(ts) {
  if (state.phase !== "playing") return;
  if (!state.lastFrame) state.lastFrame = ts;
  const dt = ts - state.lastFrame;
  state.lastFrame = ts;

  if (!state.resolving) {
    state.remaining -= dt;
    if (state.remaining <= 0) {
      state.remaining = 0;
      onTimeout();
    }
  }

  const ratio = Math.max(0, state.remaining / state.timePerTarget);
  els.timefill.style.transform = `scaleX(${ratio})`;
  els.timefill.classList.toggle("low", ratio < 0.3);

  requestAnimationFrame(loop);
}

function startCountdown() {
  state.phase = "countdown";
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  els.startBtn.style.display = "none";
  els.overlayText.style.display = "none";
  title.style.display = "none";
  let n = 3;
  big.textContent = String(n);
  beep(440, 0.1);
  const iv = setInterval(() => {
    n -= 1;
    if (n > 0) {
      big.textContent = String(n);
      beep(440, 0.1);
    } else if (n === 0) {
      big.textContent = "GO!";
      beep(880, 0.15);
    } else {
      clearInterval(iv);
      beginPlay();
    }
  }, 700);
}

function beginPlay() {
  els.overlay.hidden = true;
  state.phase = "playing";
  state.score = 0;
  state.combo = 1;
  state.lives = 3;
  state.timePerTarget = START_TIME;
  state.lastFrame = 0;
  renderHud();
  newTarget();
  requestAnimationFrame(loop);
}

function endGame() {
  state.phase = "result";
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(BEST_KEY, String(state.best));
  }
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  big.textContent = "💥";
  big.style.display = "";
  title.style.display = "";
  title.textContent = "ゲームオーバー";
  els.overlayText.style.display = "";
  els.overlayText.innerHTML = `SCORE <b>${state.score}</b> ／ BEST <b>${state.best}</b>`;
  els.startBtn.style.display = "";
  els.startBtn.textContent = "もう1回";
  els.overlay.hidden = false;
}

// --- init ---
els.startBtn.addEventListener("click", startCountdown);
els.weights.addEventListener("change", () => row.setWeightsVisible(els.weights.checked));
row.setWeightsVisible(true);
renderHud();
