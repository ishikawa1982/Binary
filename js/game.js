// game.js — UI・状態管理・入力処理。ロジックは logic.js に委譲する。
import {
  bitsToValue,
  placeValues,
  formatTarget,
  getLevelConfig,
  computeScore,
  randomTarget,
} from "./logic.js";

const BEST_KEY = "bitbuilder.best";
const WEIGHTS_KEY = "bitbuilder.weights";

const els = {
  level: document.getElementById("level"),
  score: document.getElementById("score"),
  streak: document.getElementById("streak"),
  best: document.getElementById("best"),
  target: document.getElementById("target"),
  bits: document.getElementById("bits"),
  current: document.getElementById("current"),
  progress: document.getElementById("progress"),
  weightsToggle: document.getElementById("weightsToggle"),
  clearBtn: document.getElementById("clearBtn"),
  flash: document.getElementById("flash"),
};

const state = {
  level: 1,
  roundInLevel: 0,
  score: 0,
  streak: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  width: 4,
  mode: "dec",
  target: 0,
  bits: [],
  roundStartMs: 0,
  locked: false, // 成功演出中の二度押し防止
};

/** セル要素を width 個生成して #bits に敷き詰める。 */
function buildBitCells() {
  const weights = placeValues(state.width);
  els.bits.innerHTML = "";
  weights.forEach((weight, index) => {
    const wrap = document.createElement("div");
    wrap.className = "bit";

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "bit__cell";
    cell.dataset.index = String(index);
    cell.dataset.on = "0";
    cell.textContent = "0";
    cell.setAttribute("aria-label", `桁の重み ${weight}、現在 0`);
    cell.addEventListener("click", () => toggleBit(index));

    const w = document.createElement("span");
    w.className = "bit__weight";
    w.textContent = String(weight);

    wrap.append(cell, w);
    els.bits.append(wrap);
  });
}

/** ビットを反転し、表示と正解判定を更新する。 */
function toggleBit(index) {
  if (state.locked) return;
  state.bits[index] = state.bits[index] ? 0 : 1;

  const cell = els.bits.querySelector(`.bit__cell[data-index="${index}"]`);
  const weight = placeValues(state.width)[index];
  cell.dataset.on = String(state.bits[index]);
  cell.textContent = String(state.bits[index]);
  cell.setAttribute("aria-label", `桁の重み ${weight}、現在 ${state.bits[index]}`);

  updateCurrent();
}

/** ライブ現在値を更新し、一致していれば正解処理へ。 */
function updateCurrent() {
  const value = bitsToValue(state.bits);
  els.current.textContent = String(value);
  const match = value === state.target;
  els.current.classList.toggle("match", match);
  if (match) onSolved();
}

/** 正解時：スコア加算・演出・進行・次問題。 */
function onSolved() {
  if (state.locked) return;
  state.locked = true;

  const elapsedMs = Date.now() - state.roundStartMs;
  state.streak += 1;
  state.score += computeScore({ streak: state.streak, elapsedMs });
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(BEST_KEY, String(state.best));
  }

  // 成功演出
  els.bits.querySelectorAll(".bit__cell").forEach((c) => c.classList.add("win"));
  vibrate(30);

  const config = getLevelConfig(state.level);
  state.roundInLevel += 1;
  const leveledUp = state.roundInLevel >= config.roundsToAdvance;

  renderHud();
  renderProgress();

  setTimeout(() => {
    if (leveledUp) {
      state.level += 1;
      state.roundInLevel = 0;
      showFlash(`レベル ${state.level}!`);
      vibrate([20, 40, 20]);
    }
    els.bits.querySelectorAll(".bit__cell").forEach((c) => c.classList.remove("win"));
    state.locked = false;
    nextRound();
  }, 650);
}

/** 新しい問題を出題する。 */
function nextRound() {
  const config = getLevelConfig(state.level);
  state.width = config.width;
  state.mode = config.mode;
  state.bits = new Array(state.width).fill(0);

  // 全ゼロ（現在値0）の問題を避ける。
  let target = randomTarget(state.width);
  if (target === 0) target = 1;
  state.target = target;

  els.target.textContent = formatTarget(state.target, state.mode, state.width);
  buildBitCells();
  updateCurrent();
  state.roundStartMs = Date.now();
  renderHud();
  renderProgress();
}

/** 現在の盤面をすべて0に戻す。 */
function clearBits() {
  if (state.locked) return;
  state.bits = new Array(state.width).fill(0);
  els.bits.querySelectorAll(".bit__cell").forEach((cell) => {
    cell.dataset.on = "0";
    cell.textContent = "0";
  });
  updateCurrent();
}

function renderHud() {
  els.level.textContent = String(state.level);
  els.score.textContent = String(state.score);
  els.streak.textContent = String(state.streak);
  els.best.textContent = String(state.best);
}

function renderProgress() {
  const config = getLevelConfig(state.level);
  const pct = Math.min(100, (state.roundInLevel / config.roundsToAdvance) * 100);
  els.progress.style.width = `${pct}%`;
}

function showFlash(text) {
  els.flash.textContent = text;
  els.flash.classList.remove("show");
  // reflow して再アニメーション
  void els.flash.offsetWidth;
  els.flash.classList.add("show");
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* 非対応環境は無視 */
    }
  }
}

function applyWeightsVisibility(show) {
  els.bits.classList.toggle("hide-weights", !show);
}

// --- 初期化 ---
function init() {
  // 桁の重み表示設定を復元
  const savedWeights = localStorage.getItem(WEIGHTS_KEY);
  const showWeights = savedWeights === null ? true : savedWeights === "1";
  els.weightsToggle.checked = showWeights;

  els.weightsToggle.addEventListener("change", () => {
    applyWeightsVisibility(els.weightsToggle.checked);
    localStorage.setItem(WEIGHTS_KEY, els.weightsToggle.checked ? "1" : "0");
  });
  els.clearBtn.addEventListener("click", clearBits);

  renderHud();
  nextRound();
  applyWeightsVisibility(showWeights);
}

init();
