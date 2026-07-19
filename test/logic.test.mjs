import { test } from "node:test";
import assert from "node:assert/strict";
import {
  valueToBits,
  bitsToValue,
  placeValues,
  formatHex,
  formatTarget,
  getLevelConfig,
  levelCount,
  computeScore,
  randomTarget,
  addWithCarry,
} from "../js/logic.js";

test("valueToBits produces MSB-first bit arrays", () => {
  assert.deepEqual(valueToBits(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(valueToBits(13, 4), [1, 1, 0, 1]);
  assert.deepEqual(valueToBits(15, 4), [1, 1, 1, 1]);
  assert.deepEqual(valueToBits(255, 8), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("bitsToValue is the inverse of valueToBits", () => {
  for (const width of [4, 6, 8]) {
    for (const value of [0, 1, 2, (1 << width) - 1, Math.floor((1 << width) / 2)]) {
      assert.equal(bitsToValue(valueToBits(value, width)), value);
    }
  }
});

test("placeValues returns descending powers of two", () => {
  assert.deepEqual(placeValues(4), [8, 4, 2, 1]);
  assert.deepEqual(placeValues(8), [128, 64, 32, 16, 8, 4, 2, 1]);
});

test("formatHex is uppercase, zero-padded, 0x-prefixed", () => {
  assert.equal(formatHex(13, 4), "0xD");
  assert.equal(formatHex(0, 8), "0x00");
  assert.equal(formatHex(255, 8), "0xFF");
  assert.equal(formatHex(10, 8), "0x0A");
});

test("formatTarget honors each mode", () => {
  assert.equal(formatTarget(13, "dec", 4), "13");
  assert.equal(formatTarget(13, "hex", 4), "0xD");
  assert.equal(formatTarget(13, "both", 4), "13 / 0xD");
  assert.equal(formatTarget(255, "both", 8), "255 / 0xFF");
});

test("getLevelConfig returns expected width/mode and clamps", () => {
  assert.deepEqual(getLevelConfig(1), { width: 4, mode: "dec", roundsToAdvance: 5 });
  assert.equal(getLevelConfig(2).mode, "both");
  assert.equal(getLevelConfig(3).width, 6);
  assert.equal(getLevelConfig(4).width, 8);
  assert.equal(getLevelConfig(5).mode, "hex");
  // out of range clamps to the final level
  assert.deepEqual(getLevelConfig(99), getLevelConfig(levelCount()));
  assert.deepEqual(getLevelConfig(0), getLevelConfig(1));
});

test("computeScore increases with streak and with speed", () => {
  const slow = computeScore({ streak: 1, elapsedMs: 10000 });
  const fast = computeScore({ streak: 1, elapsedMs: 0 });
  assert.ok(fast > slow, "faster answers score higher");

  const lowStreak = computeScore({ streak: 1, elapsedMs: 5000 });
  const highStreak = computeScore({ streak: 5, elapsedMs: 5000 });
  assert.ok(highStreak > lowStreak, "longer streaks score higher");

  // base score floor
  assert.equal(computeScore({ streak: 1, elapsedMs: 999999 }), 100);
});

test("addWithCarry splits a nibble sum into value and carry", () => {
  // no carry
  assert.deepEqual(addWithCarry(3, 5, 4), { value: 8, carry: 0 });
  assert.deepEqual(addWithCarry(0, 15, 4), { value: 15, carry: 0 }); // reach F, no carry
  // exactly one carry (F + 1 -> 0x10)
  assert.deepEqual(addWithCarry(15, 1, 4), { value: 0, carry: 1 });
  assert.deepEqual(addWithCarry(10, 8, 4), { value: 2, carry: 1 }); // 18 -> 0x12
  // multiple carries
  assert.deepEqual(addWithCarry(0, 32, 4), { value: 0, carry: 2 });
  // 8-bit width
  assert.deepEqual(addWithCarry(255, 1, 8), { value: 0, carry: 1 });
});

test("randomTarget stays within range for the given width", () => {
  for (const width of [4, 6, 8]) {
    const max = 1 << width;
    // deterministic edges via injected rng
    assert.equal(randomTarget(width, () => 0), 0);
    assert.equal(randomTarget(width, () => 0.999999), max - 1);
    // sampled
    for (let i = 0; i < 200; i++) {
      const v = randomTarget(width);
      assert.ok(v >= 0 && v < max, `value ${v} out of range for width ${width}`);
    }
  }
});
