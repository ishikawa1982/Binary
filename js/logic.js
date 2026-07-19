// logic.js — 二進数・16進数パズルの純粋ロジック（ES module）
// UI から切り離しておくことで node:test でユニットテストできる。

/**
 * 整数を width 桁の 0/1 配列（MSB→LSB）に変換する。
 * @param {number} value 0 以上 2^width-1 以下の整数
 * @param {number} width ビット幅
 * @returns {number[]} 長さ width の 0/1 配列
 */
export function valueToBits(value, width) {
  const bits = [];
  for (let i = width - 1; i >= 0; i--) {
    bits.push((value >> i) & 1);
  }
  return bits;
}

/**
 * 0/1 配列（MSB→LSB）を整数に変換する。
 * @param {number[]} bits
 * @returns {number}
 */
export function bitsToValue(bits) {
  return bits.reduce((acc, bit) => (acc << 1) | (bit ? 1 : 0), 0);
}

/**
 * 各桁の重み（MSB→LSB）を返す。例: width=4 → [8,4,2,1]
 * @param {number} width
 * @returns {number[]}
 */
export function placeValues(width) {
  const values = [];
  for (let i = width - 1; i >= 0; i--) {
    values.push(1 << i);
  }
  return values;
}

/**
 * 16進の桁数を width から求める（4bit ごとに1桁、最低1桁）。
 * @param {number} width
 * @returns {number}
 */
function hexDigits(width) {
  return Math.max(1, Math.ceil(width / 4));
}

/**
 * 値を16進文字列（大文字・0埋め・0x 接頭辞）に整形する。
 * @param {number} value
 * @param {number} width
 * @returns {string}
 */
export function formatHex(value, width) {
  return "0x" + value.toString(16).toUpperCase().padStart(hexDigits(width), "0");
}

/**
 * お題の表示文字列を作る。
 * @param {number} value
 * @param {'dec'|'hex'|'both'} mode
 * @param {number} width 16進の0埋め桁数計算に使用
 * @returns {string}
 */
export function formatTarget(value, mode, width) {
  const dec = String(value);
  const hex = formatHex(value, width);
  switch (mode) {
    case "dec":
      return dec;
    case "hex":
      return hex;
    case "both":
      return `${dec} / ${hex}`;
    default:
      return dec;
  }
}

// 難易度テーブル。level は 1 始まり。最終レベルを超えたら最後の設定を継続（周回）。
const LEVELS = [
  { width: 4, mode: "dec", roundsToAdvance: 5 }, // Lv1: 4bit / 10進
  { width: 4, mode: "both", roundsToAdvance: 5 }, // Lv2: 4bit / 10進+16進
  { width: 6, mode: "both", roundsToAdvance: 5 }, // Lv3: 6bit
  { width: 8, mode: "both", roundsToAdvance: 5 }, // Lv4: 8bit
  { width: 8, mode: "hex", roundsToAdvance: 5 }, // Lv5: 8bit / 16進のみ
];

/**
 * 指定レベルの設定を返す。範囲外は最終レベルにクランプ。
 * @param {number} level 1 始まり
 * @returns {{width:number, mode:'dec'|'hex'|'both', roundsToAdvance:number}}
 */
export function getLevelConfig(level) {
  const index = Math.min(Math.max(level, 1), LEVELS.length) - 1;
  return { ...LEVELS[index] };
}

/**
 * レベル総数。
 * @returns {number}
 */
export function levelCount() {
  return LEVELS.length;
}

// スコア計算のパラメータ。
const BASE_POINTS = 100;
const STREAK_BONUS = 10; // 連続正解1回ごとの加点
const SPEED_MAX_BONUS = 100; // 速答ボーナスの最大値
const SPEED_WINDOW_MS = 10000; // これ以内なら速答ボーナスが付く

/**
 * 1問正解時のスコアを計算する。
 * 基礎点 + 連続ボーナス + 速度ボーナス。
 * @param {{streak:number, elapsedMs:number}} params
 *   streak: この正解を含めた連続正解数（1 始まり）
 *   elapsedMs: 出題から正解までの経過ミリ秒
 * @returns {number} 整数スコア
 */
export function computeScore({ streak, elapsedMs }) {
  const safeStreak = Math.max(1, streak);
  const streakBonus = (safeStreak - 1) * STREAK_BONUS;
  const remaining = Math.max(0, SPEED_WINDOW_MS - Math.max(0, elapsedMs));
  const speedBonus = Math.round((remaining / SPEED_WINDOW_MS) * SPEED_MAX_BONUS);
  return BASE_POINTS + streakBonus + speedBonus;
}

/**
 * 0..2^width-1 の一様乱数。rng は 0..1 を返す関数（テスト時に差し替え可能）。
 * @param {number} width
 * @param {() => number} [rng]
 * @returns {number}
 */
export function randomTarget(width, rng = Math.random) {
  const max = 1 << width; // 2^width
  return Math.floor(rng() * max);
}
