// tower.js — 主役ゲーム「ビットタワー」:2進カウンター(＋1固定)＋対話式チュートリアル。
// ＋1 のたびに繰り上がりが下の桁から連鎖し、1111=F を超えると上の16進桁へ桁あふれ。
import { addWithCarry } from "./logic.js";
import { createBitRow } from "./ui-bits.js";
import { success, fail, vibrate, screenFlash, beep } from "./fx.js";

const WIDTH = 4;
const BEST_KEY = "tower.best";
const TUT_KEY = "tower.tutDone";
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
  tutBtn: document.getElementById("tutBtn"),
  bigmsg: document.getElementById("bigmsg"),
  coach: document.getElementById("coach"),
  coachText: document.getElementById("coachText"),
  coachNext: document.getElementById("coachNext"),
  coachSkip: document.getElementById("coachSkip"),
};

const state = {
  phase: "ready", // ready | tutorial | countdown | playing | result
  floor: 0,
  nibble: 0,
  target: 1,
  willCarry: 0,
  score: 0,
  combo: 1,
  lives: 3,
  timePerRound: 5000,
  remaining: 5000,
  lastFrame: 0,
  resolving: false,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  // tutorial
  tutIndex: 0,
  tutTarget: null,
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

  if (state.phase === "tutorial") {
    if (state.tutTarget !== null) {
      if (value === state.tutTarget) completeTutMake();
      else setTargetHint(state.tutTarget);
    }
    return;
  }

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

function showBigMsg(text) {
  els.bigmsg.textContent = text;
  els.bigmsg.classList.remove("show");
  void els.bigmsg.offsetWidth;
  els.bigmsg.classList.add("show");
}

// ===================== 通常プレイ =====================
function newRound() {
  const r = addWithCarry(state.nibble, 1, WIDTH);
  state.target = r.value;
  state.willCarry = r.carry;
  state.timePerRound = timeForFloor(state.floor);
  state.remaining = state.timePerRound;
  state.resolving = false;
  renderChallenge();
  row.setValue(state.nibble);
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
    state.score += (100 + state.floor * 50) * state.combo;
    success(state.combo + 5);
    vibrate([20, 40, 80]);
    screenFlash("win");
    showBigMsg(`桁上がり！ 0x${totalValue().toString(16).toUpperCase()}`);
  } else if (next === FMAX) {
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
  if (state.lives <= 0) endGame();
  else newRound();
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
  els.hint.style.display = "";
  els.overlay.hidden = false; // チュートリアル後など、隠れていても確実に表示
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  els.startBtn.style.display = "none";
  els.tutBtn.style.display = "none";
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
  els.hint.style.display = "";
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
  els.tutBtn.style.display = "";
  els.overlay.hidden = false;
}

function showStartOverlay() {
  const big = els.overlay.querySelector(".overlay__big");
  const title = els.overlay.querySelector(".overlay__title");
  big.textContent = "🗼";
  big.style.display = "";
  title.style.display = "";
  title.textContent = "ビットタワー";
  els.overlayText.style.display = "";
  els.overlayText.innerHTML =
    "＋1 して2進を1つずつ数え上げよう。0011 の次は 0100 —— 1111（F）まで来たら桁上がりでレベルアップ！";
  els.startBtn.style.display = "";
  els.startBtn.textContent = "スタート";
  els.tutBtn.style.display = "";
  els.overlay.hidden = false;
  els.hint.style.display = "";
  state.phase = "ready";
}

// ===================== チュートリアル =====================
const TUT = [
  { say: "これは「2進数」。下のボタンをタップすると 0 ↔ 1 が切りかわるよ。ボタンの下の数字は「桁の重み」（8・4・2・1）。" },
  { say: "光っているボタンを押して、数を1つずつ増やしていこう。まずは 1 を作ってみて！", make: { start: 0, target: 1 } },
  { say: "＋1すると 2。1の位が繰り上がって、2の位が立つよ（0001 → 0010）。", make: { start: 1, target: 2 } },
  { say: "＋1すると 3。1の位を足すだけ（0010 → 0011）。", make: { start: 2, target: 3 } },
  { say: "ここが山場！＋1すると 0011 → 0100。下の桁が連鎖して繰り上がる！", make: { start: 3, target: 4 } },
  { say: "この「パタパタ繰り上がり」がビットタワーの気持ちよさ。" },
  { say: "もっと大きな連鎖も。0111 → 1000、3つ一気に繰り上がるよ。", make: { start: 7, target: 8 } },
  { say: "あと1つで満タン。＋1して 1111 = F（15）を作ろう。", make: { start: 14, target: 15 } },
  { say: "F の次に＋1すると…ぜんぶ繰り上がって桁が増える！0x0F → 0x10（=16）。", make: { start: 15, target: 0, carry: true } },
  { say: "これでバッチリ！あとは制限時間内に、できるだけ高く登ろう。", cta: "ゲーム開始" },
];

function setTargetHint(target) {
  const bits = row.getBits();
  row.cells.forEach((cell, i) => {
    const weight = 1 << (WIDTH - 1 - i);
    const want = target & weight ? 1 : 0;
    cell.classList.toggle("hint-target", want !== bits[i]);
  });
}
function clearTargetHint() {
  row.cells.forEach((c) => c.classList.remove("hint-target"));
}

function startTutorial() {
  state.phase = "tutorial";
  state.tutIndex = 0;
  state.floor = 0;
  state.nibble = 0;
  state.score = 0;
  state.combo = 1;
  state.lives = 3;
  els.overlay.hidden = true;
  els.hint.style.display = "none";
  els.timefill.style.transform = "scaleX(1)";
  els.timefill.classList.remove("low");
  renderHud();
  renderTotal(false);
  showTutStep(0);
}

function showTutStep(i) {
  const step = TUT[i];
  els.coach.hidden = false;
  els.coachText.textContent = step.say;

  if (step.make) {
    state.floor = 0;
    state.nibble = step.make.start;
    state.tutTarget = step.make.target;
    renderTotal(false);
    row.setValue(step.make.start);
    setTargetHint(step.make.target);
    els.coachNext.style.display = "none"; // 正解で自動的に次へ
  } else {
    state.tutTarget = null;
    clearTargetHint();
    els.coachNext.style.display = "";
    els.coachNext.textContent = step.cta || "つぎへ";
  }
}

function completeTutMake() {
  const step = TUT[state.tutIndex];
  clearTargetHint();
  state.tutTarget = null;
  rippleCarry(step.make.start, step.make.target);
  success(3);
  vibrate(20);

  if (step.make.carry) {
    state.floor = 1;
    state.nibble = 0;
    renderTotal(true);
    renderHud();
    screenFlash("win");
    showBigMsg("桁上がり！ 0x10");
  } else {
    state.nibble = step.make.target;
    renderTotal(step.make.target === FMAX);
    if (step.make.target === FMAX) showBigMsg("F！満タン");
  }
  setTimeout(nextTutStep, step.make.carry ? 950 : 680);
}

function nextTutStep() {
  state.tutIndex += 1;
  if (state.tutIndex >= TUT.length) endTutorial(true);
  else showTutStep(state.tutIndex);
}

function endTutorial(goPlay) {
  localStorage.setItem(TUT_KEY, "1");
  els.coach.hidden = true;
  clearTargetHint();
  state.tutTarget = null;
  if (goPlay) startCountdown();
  else showStartOverlay();
}

// ===================== init =====================
els.startBtn.addEventListener("click", startCountdown);
els.tutBtn.addEventListener("click", startTutorial);
els.coachNext.addEventListener("click", nextTutStep);
els.coachSkip.addEventListener("click", () => endTutorial(false));
els.weights.addEventListener("change", () => row.setWeightsVisible(els.weights.checked));
row.setWeightsVisible(true);
renderHud();
renderTotal(false);

// 初回は自動でチュートリアル、以降はスタート画面。
if (!localStorage.getItem(TUT_KEY)) {
  startTutorial();
}
