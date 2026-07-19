// ui-bits.js — 共通の「4bitセル行」UIコンポーネント。
// 両モード(Blitz / Drop)で使い回す心臓部。
import { placeValues, bitsToValue } from "./logic.js";

/**
 * container に width 個のタップ可能なビットセル＋桁の重みラベルを生成する。
 * @param {HTMLElement} container
 * @param {number} width
 * @param {(value:number, bits:number[]) => void} [onChange] 反転のたびに呼ばれる
 * @returns {{
 *   getValue():number, getBits():number[], reset():void,
 *   setEnabled(on:boolean):void, flashWin():void, setWeightsVisible(v:boolean):void,
 *   cells: HTMLButtonElement[]
 * }}
 */
export function createBitRow(container, width, onChange) {
  const bits = new Array(width).fill(0);
  const weights = placeValues(width);
  container.innerHTML = "";
  container.classList.add("bits");
  const cells = [];

  weights.forEach((weight, i) => {
    const wrap = document.createElement("div");
    wrap.className = "bit";

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "bit__cell";
    cell.dataset.on = "0";
    cell.textContent = "0";
    cell.setAttribute("aria-label", `重み${weight} 現在0`);
    cell.addEventListener("click", () => {
      bits[i] ^= 1;
      cell.dataset.on = String(bits[i]);
      cell.textContent = String(bits[i]);
      cell.setAttribute("aria-label", `重み${weight} 現在${bits[i]}`);
      if (onChange) onChange(bitsToValue(bits), bits.slice());
    });

    const w = document.createElement("span");
    w.className = "bit__weight";
    w.textContent = String(weight);

    wrap.append(cell, w);
    container.append(wrap);
    cells.push(cell);
  });

  return {
    getValue: () => bitsToValue(bits),
    getBits: () => bits.slice(),
    reset() {
      for (let i = 0; i < width; i++) {
        bits[i] = 0;
        cells[i].dataset.on = "0";
        cells[i].textContent = "0";
      }
      if (onChange) onChange(0, bits.slice());
    },
    /** ビット列を任意の値にセットする(MSB→LSB)。 */
    setValue(v) {
      for (let i = 0; i < width; i++) {
        bits[i] = (v >> (width - 1 - i)) & 1;
        cells[i].dataset.on = String(bits[i]);
        cells[i].textContent = String(bits[i]);
      }
      if (onChange) onChange(bitsToValue(bits), bits.slice());
    },
    setEnabled(on) {
      cells.forEach((c) => (c.disabled = !on));
    },
    flashWin() {
      cells.forEach((c) => c.classList.add("win"));
      setTimeout(() => cells.forEach((c) => c.classList.remove("win")), 450);
    },
    setWeightsVisible(v) {
      container.classList.toggle("hide-weights", !v);
    },
    cells,
  };
}
