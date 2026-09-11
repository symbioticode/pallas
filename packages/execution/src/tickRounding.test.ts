import { test, expect } from 'vitest';
import {
  calculateTickedOrderAmounts,
  decimalPlaces,
  roundDown,
  roundNormal,
  roundUp,
  roundingConfigForTickSize,
  ROUNDING_CONFIG,
} from './tickRounding.js';

// Valeurs de reference calculées avec l'algorithme Decimal EXACT de
// py-clob-client-v2 (main, py_clob_client_v2/order_builder/helpers.py) —
// l'impl. flottante du module doit produire la MÊME sortie.

test('ROUNDING_CONFIG : table officielle par tick_size (builder.py)', () => {
  expect(ROUNDING_CONFIG).toEqual({
    '0.1': { price: 1, size: 2, amount: 3 },
    '0.01': { price: 2, size: 2, amount: 4 },
    '0.005': { price: 3, size: 2, amount: 5 },
    '0.0025': { price: 4, size: 2, amount: 6 },
    '0.001': { price: 3, size: 2, amount: 5 },
    '0.0001': { price: 4, size: 2, amount: 6 },
  });
});

test('roundingConfigForTickSize rejette un tick_size hors table (fail-closed)', () => {
  expect(() => roundingConfigForTickSize('0.5')).toThrow(/non supporté/);
  expect(() => roundingConfigForTickSize('0.02')).toThrow(/non supporté/);
});

test('helpers : round_down/round_normal/round_up suivent floor/round/ceil a 10^-sig', () => {
  expect(roundDown(1.23999, 2)).toBe(1.23);
  expect(roundNormal(1.235, 2)).toBe(1.24); // Math.round (demi vers +inf)
  expect(roundUp(1.23001, 2)).toBe(1.24);
  expect(decimalPlaces(0.02)).toBe(2);
  expect(decimalPlaces(2e-7)).toBe(7); // 2e-7 => "2e-7"
  expect(decimalPlaces(5)).toBe(0);
});

test('tick 0.01 : la taille est arrondie DOWN meme si le prix l amene a 3 decimales', () => {
  // BUY price=0.29 size=0.07 : 0.07×0.29 = 0.0203 -> 20300 / 70000.
  // (piège flottant 0.020300000000000002 corrigé par la séquence up/down bornée.)
  expect(calculateTickedOrderAmounts('BUY', 0.29, 0.07, '0.01')).toEqual({
    makerAmount: 20_300n,
    takerAmount: 70_000n,
  });
});

test('tick 0.01 : plus de fabrication de centimes fantomes (0.333x3 -> 0.99, pas 1.00)', () => {
  // L ancien Math.round((0.333333...×3)×1e6) = 1.00 USD ; l algorithme officiel
  // arrondit le PRIX d abord a 0.33 puis 0.99 -> 990000.
  expect(calculateTickedOrderAmounts('BUY', 0.333333333, 3, '0.01')).toEqual({
    makerAmount: 990_000n,
    takerAmount: 3_000_000n,
  });
  expect(calculateTickedOrderAmounts('SELL', 0.333333333, 3, '0.01')).toEqual({
    makerAmount: 3_000_000n,
    takerAmount: 990_000n,
  });
});

test('tick 0.1 : prix arrondi a 1 decimale (round_normal), maker 3 dp', () => {
  expect(calculateTickedOrderAmounts('BUY', 0.87, 50, '0.1')).toEqual({
    makerAmount: 45_000_000n, // 50 × 0.9
    takerAmount: 50_000_000n,
  });
});

test('tick 0.0001 : prix a 4 decimales, montant 6 dp', () => {
  expect(calculateTickedOrderAmounts('BUY', 0.3333, 2, '0.0001')).toEqual({
    makerAmount: 666_600n,
    takerAmount: 2_000_000n,
  });
  expect(calculateTickedOrderAmounts('SELL', 0.3333, 2, '0.0001')).toEqual({
    makerAmount: 2_000_000n,
    takerAmount: 666_600n,
  });
});

test('tick 0.001 : prix a 3 decimales', () => {
  expect(calculateTickedOrderAmounts('BUY', 0.123456789, 4, '0.001')).toEqual({
    makerAmount: 492_000n, // 4 × 0.123
    takerAmount: 4_000_000n,
  });
});

test('tick 0.005 : prix a 3 decimales, montant 5 dp', () => {
  expect(calculateTickedOrderAmounts('BUY', 0.017, 100, '0.005')).toEqual({
    makerAmount: 1_700_000n, // 100 × 0.017 (= tick 0.005 multiple)
    takerAmount: 100_000_000n,
  });
});

test('calculateTickedOrderAmounts exige price et size strictement positifs', () => {
  expect(() => calculateTickedOrderAmounts('BUY', 0, 10, '0.01')).toThrow(/positifs/);
  expect(() => calculateTickedOrderAmounts('BUY', 0.5, -1, '0.01')).toThrow(/positifs/);
});