// fx.js — 共通の「ジュース」:効果音(WebAudio)・振動・画面フラッシュ。
// 依存ゼロ。音声はユーザー操作後に鳴らせるよう遅延生成する。

let audioCtx;

function ctx() {
  if (audioCtx === undefined) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = AC ? new AC() : null;
    } catch {
      audioCtx = null;
    }
  }
  return audioCtx;
}

/** 短いブリップ音を鳴らす。 */
export function beep(freq = 660, duration = 0.08, type = "square", gain = 0.05) {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === "suspended") ac.resume();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(ac.destination);
  const t = ac.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

/** 正解音:コンボが伸びるほど高く。 */
export function success(combo = 1) {
  const c = Math.min(combo, 12);
  beep(520 + c * 40, 0.09, "square", 0.06);
  setTimeout(() => beep(780 + c * 40, 0.07, "square", 0.05), 55);
}

/** 失敗音。 */
export function fail() {
  beep(200, 0.18, "sawtooth", 0.06);
  setTimeout(() => beep(150, 0.2, "sawtooth", 0.05), 70);
}

/** 端末振動(非対応は無視)。 */
export function vibrate(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* noop */
    }
  }
}

/** 画面全体を一瞬フラッシュさせる。kind: 'win' | 'bad'。 */
export function screenFlash(kind = "win") {
  const el = document.getElementById("screenflash");
  if (!el) return;
  el.classList.remove("on", "win", "bad");
  void el.offsetWidth; // reflow でアニメ再始動
  el.classList.add("on", kind);
  setTimeout(() => el.classList.remove("on", kind), 220);
}
