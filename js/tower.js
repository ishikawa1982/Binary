// tower.js — 主役ゲーム「ビットタワー」:2進カウンター(＋1固定)。
// ＋1 のたびに繰り上がりが下の桁から連鎖し、1111=F を超えると上の16進桁へ桁あふれ。
import { addWithCarry } from "./logic.js";
import { createBitRow } from "./ui-bits.js";
import { success, fail, vibrate, screenFlash, beep } from "./fx.js";

const WIDTH = 4;
const BEST_KEY = "tower.best";
const FMAX = (1 << WIDTH) - 1; // 15 = 0xF = 1111

const els = {
  score: document.getElementById("score"),
  floor: document.getElementById("floor"),
  lives: document.getElementById("lives"),
  timefill: document.getElementById("timefill"),
  hexview: document.getElementById("hexview"),
  decview: document.getElementById("decview"),
  addchip: document.getElementById("addchip"),
  hint: document.getElementById("hint"),
  bits: document.getElementById("bits"),
  current: document.getElementById("current"),
  weights: document.getElementById("weights"),
  overlay: document.getElementById("overlay"),
  overlayText: document.getElementById("overlayText"),
  startBtn: document.getElementById("startBtn"),
  bigmsg: document.getElementById("bigmsg"),
};

const state = {
  phase: "ready", // ready | countdown | playing | result
  floor: 0, // 繰り上がった上位桁の値（=（total-nibble)/16）
  nibble: 0, // 確定済みの下位4bit（=16進の末桁 / カウンターの現在値）
  target: 1, // つねに nibble+1 の下位4bit
  willCarry: 0,
  score: 0,
  combo: 1,
  lives: 3,
  timePerRound: 5000,
  remaining: 5000,
  lastFrame: 0,
  resolving: false,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
};

const row = createBitRow(els.bits, WIDTH, onBitsChange);

function totalValue() {
  return state.floor * 16 + state.nibble;
}

function timeForFloor(floor) {
  return Math.max(2500, 5000 - floor * 300);
}

function onBitsChange(value) {
  els.current.innerHTML = `いまの入力 <b>${value}</b>`;
  const match = value === state.target;
  els.current.classList.toggle("match", state.phase === "playing" && match);
  if (state.phase === "playing" && !state.resolving && match) onCorrect();
}

function renderTotal(pulse) {
  const total = totalValue();
  const hex = total.toString(16).toUpperCase();
  const prefix = hex.length > 1 ? hex.slice(0, -1) : "";
  const last = hex.slice(-1);
  els.hexview.innerHTML =
    `<span class="hex__prefix">0x${prefix}</span>` +
    `<span class="hex__last">${last}</span>`;
  els.decview.textContent = `= ${total}`;
  if (pulse) {
    els.hexview.classList.remove("carry");
    void els.hexview.offsetWidth;
    els.hexview.classList.add("carry");
  }
}

function renderChallenge() {
  els.addchip.textContent = "＋1";
  els.hint.textContent = `${state.nibble} の 2進を、1つ数えて作ろう`;
}

function renderHud() {
  els.score.textContent = String(state.score);
  els.floor.textContent = String(state.floor + 1);
  els.lives.textContent = "❤".repeat(Math.max(0, state.lives)) || "―";
}

function newRound() {
  const r = addWithCarry(state.nibble, 1, WIDTH);
  state.target = r.value;
  state.willCarry = r.carry;
  state.timePerRound = timeForFloor(state.floor);
  state.remaining = state.timePerRound;
  state.resolving = false;
  renderChallenge();
  row.setValue(state.nibble); // 現在値からスタート → プレイヤーが +1 する
}

// 変化したビットを、下の桁(LSB)から順に光らせて「繰り上がりの連鎖」を見せる。
function rippleCarry(prevNibble, newNibble) {
  const changed = prevNibble ^ newNibble;
  for (let p = 0; p < WIDTH; p++) {
    if ((changed >> p) & 1) {
      const cell = row.cells[WIDTH - 1 - p]; // p=0 が LSB
      setTimeout(() => {
        cell.classList.remove("ripple");
        void cell.offsetWidth;
        cell.classList.add("ripple");
        setTimeout(() => cell.classList.remove("ripple"), 420);
      }, p * 95);
    }
  }
}

function onCorrect() {
  state.resolving = true;
  const prev = state.nibble;
  const carry = state.willCarry;
  const next = state.target;

  rippleCarry(prev, next);
  state.nibble = next;
  state.floor += carry;

  if (carry > 0) {
    // 1111 → 桁あふれ:最上位の快感
    state.score += (100 + state.floor * 50) * state.combo;
    success(state.combo + 5);
    vibrate([20, 40, 80]);
    screenFlash("win");
    showBigMsg(`桁上がり！ 0x${totalValue().toString(16).toUpperCase()}`);
  } else if (next === FMAX) {
    // F(1111) 到達:1桁の最高値
    state.score += FMAX * 5 * state.combo;
    success(state.combo + 2);
    vibrate([15, 30, 15]);
    screenFlash("win");
    showBigMsg("F！満タン");
  } else {
    state.score += next * 5 * state.combo;
    success(state.combo);
    vibrate(12);
  }
  state.combo += 1;

  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(BEST_KEY, String(state.best));
  }

  renderHud();
  renderTotal(carry > 0 || next === FMAX);
  const delay = carry > 0 ? 780 : next === FMAX ? 560 : 360;
  setTimeout(() => {
    if (state.phase === "playing") newRound();
  }, delay);
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
    newRound();
  }
}

function showBigMsg(text) {
  els.bigmsg.textContent = text;
  els.bigmsg.classList.remove("show");
  void els.bigmsg.offsetWidth;
  els.bigmsg.classList.add("show");
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
  const ratio = Math.max(0, state.remaining / state.timePerRound);
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
  state.floor = 0;
  state.nibble = 0;
  state.score = 0;
  state.combo = 1;
  state.lives = 3;
  state.lastFrame = 0;
  renderHud();
  renderTotal(false);
  newRound();
  requestAnimationFrame(loop);
}

function endGame() {
  state.phase = "result";
  const total = totalValue();
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem(BEST_KEY, String(state.best));
  }
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  big.textContent = "🏁";
  big.style.display = "";
  title.style.display = "";
  title.textContent = "ゲームオーバー";
  els.overlayText.style.display = "";
  els.overlayText.innerHTML =
    `到達 <b>0x${total.toString(16).toUpperCase()}</b>（${total}）<br>` +
    `SCORE <b>${state.score}</b> ／ BEST <b>${state.best}</b>`;
  els.startBtn.style.display = "";
  els.startBtn.textContent = "もう1回";
  els.overlay.hidden = false;
}

// --- init ---
els.startBtn.addEventListener("click", startCountdown);
els.weights.addEventListener("change", () => row.setWeightsVisible(els.weights.checked));
row.setWeightsVisible(true);
renderHud();
renderTotal(false);
