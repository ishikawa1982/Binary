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

// ===================== BGM(チップチューン) =====================
// WebAudioのみで生成するループBGM(約128BPM)。ベース＋アルペジオ＋ハイハット。
// lookaheadスケジューラで途切れなくループする。外部アセットなし。

const BPM = 128;
const STEP = 60 / BPM / 4; // 16分音符の長さ(秒)
const MUSIC_GAIN = 0.055;

// コード進行(2小節×4コード=64ステップでループ): C → G → Am → F(王道の明るい進行)
const CHORDS = [
  { root: 130.81, tones: [261.63, 329.63, 392.0] }, // C3 / C4,E4,G4
  { root: 98.0, tones: [246.94, 293.66, 392.0] }, // G2 / B3,D4,G4
  { root: 110.0, tones: [220.0, 261.63, 329.63] }, // A2 / A3,C4,E4
  { root: 87.31, tones: [220.0, 261.63, 349.23] }, // F2 / A3,C4,F4
];
const STEPS_PER_CHORD = 16;
const TOTAL_STEPS = CHORDS.length * STEPS_PER_CHORD;

const music = {
  enabled: true,
  playing: false,
  step: 0,
  nextTime: 0,
  timer: null,
  gain: null,
};

function musicCtx() {
  const ac = ctx();
  if (!ac) return null;
  if (!music.gain) {
    music.gain = ac.createGain();
    music.gain.gain.value = MUSIC_GAIN;
    music.gain.connect(ac.destination);
  }
  return ac;
}

function noteAt(ac, freq, t, dur, type, vol) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(music.gain);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

function hatAt(ac, t, open) {
  const len = open ? 0.09 : 0.03;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = ac.createGain();
  g.gain.value = open ? 0.5 : 0.3;
  src.connect(hp);
  hp.connect(g);
  g.connect(music.gain);
  src.start(t);
}

function scheduleStep(ac, step, t) {
  const chord = CHORDS[Math.floor(step / STEPS_PER_CHORD) % CHORDS.length];
  const s16 = step % 16;

  // ベース:8分でルートをドンドン、後半にオクターブ上を混ぜて跳ねさせる
  if (s16 % 2 === 0) {
    const oct = s16 === 12 || s16 === 14 ? 2 : 1;
    noteAt(ac, chord.root * oct, t, STEP * 1.8, "triangle", 0.9);
  }
  // アルペジオ:16分でコードトーンを駆け上がる
  const tone = chord.tones[[0, 1, 2, 1][s16 % 4]];
  const up = s16 % 8 >= 4 ? 2 : 1;
  noteAt(ac, tone * up, t, STEP * 0.9, "square", 0.28);
  // ハイハット:裏拍にオープン
  if (s16 % 2 === 0) hatAt(ac, t, s16 % 4 === 2);
}

function musicTick() {
  const ac = musicCtx();
  if (!ac || !music.playing) return;
  while (music.nextTime < ac.currentTime + 0.25) {
    scheduleStep(ac, music.step, music.nextTime);
    music.step = (music.step + 1) % TOTAL_STEPS;
    music.nextTime += STEP;
  }
}

/** BGMを開始する(ユーザー操作後に呼ぶこと)。 */
export function startMusic() {
  if (!music.enabled || music.playing) return;
  const ac = musicCtx();
  if (!ac) return;
  if (ac.state === "suspended") ac.resume();
  music.playing = true;
  music.step = 0;
  music.nextTime = ac.currentTime + 0.06;
  music.timer = setInterval(musicTick, 90);
}

/** BGMを停止する。 */
export function stopMusic() {
  music.playing = false;
  if (music.timer) {
    clearInterval(music.timer);
    music.timer = null;
  }
}

/** BGMの有効/無効。無効化時は即停止。再生開始は startMusic()(ユーザー操作後)で行う。 */
export function setMusicEnabled(on) {
  music.enabled = on;
  if (!on) stopMusic();
}

/** テスト/デバッグ用:BGMの状態。 */
export function musicState() {
  const ac = audioCtx;
  return { enabled: music.enabled, playing: music.playing, ctxState: ac ? ac.state : "none" };
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
