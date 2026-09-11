/**
 * Arrondi officiel des montants d'ordre Polymarket CLOB (PALLAS-M17).
 *
 * PORT FIDÈLE de `py-clob-client-v2` (Polymarket/py-clob-client-v2 @ main,
 * vérifié le 2026-09-11 — `py_clob_client_v2/order_builder/builder.py`
 * `ROUNDING_CONFIG` + `helpers.py` round_down/round_normal/round_up/
 * to_token_decimals/decimal_places). Le client TS officiel
 * (`Polymarket/clob-client-v2`) délègue les montants à l'appelant : seul le
 * client Python applique cette règle de rounding ; c'est donc lui la
 * référence canonique (l'ordre signé doit lui être identique).
 *
 * Règles (limite, ordres GTC) :
 *  - prix : `round_normal(price, price_dp)` où price_dp dépend du tick_size ;
 *  - taille (shares) : `round_down(size, size_dp)` (toujours 2 décimales) ;
 *  - BUY  : maker = shares×price, taker = shares ;
 *  - SELL : maker = shares, taker = shares×price ;
 *  - le montant monétaire est arrondi en deux temps bornés (up à amount+4,
 *    puis down à amount) pour ne jamais le laisser dépasser le plafond.
 *
 * NOTE : on parle ici de "tick" au sens rounding (0.1 / 0.01 / 0.005 / 0.0025
 * / 0.001 / 0.0001) — c'est le tick_size du marché Polymarket.
 */

export interface RoundingConfig {
  /** décimales de prix après round_normal. */
  price: number;
  /** décimales de taille après round_down. */
  size: number;
  /** décimales cibles du montant monétaire (bornes up/down). */
  amount: number;
}

/** Table officielle (py-clob-client-v2 builder.py ROUNDING_CONFIG). */
export const ROUNDING_CONFIG: Readonly<Record<string, RoundingConfig>> = {
  '0.1': { price: 1, size: 2, amount: 3 },
  '0.01': { price: 2, size: 2, amount: 4 },
  '0.005': { price: 3, size: 2, amount: 5 },
  '0.0025': { price: 4, size: 2, amount: 6 },
  '0.001': { price: 3, size: 2, amount: 5 },
  '0.0001': { price: 4, size: 2, amount: 6 },
};

/** tick_size (string de marché Polymarket) → config de rounding officielle. */
export function roundingConfigForTickSize(tickSize: string): RoundingConfig {
  const config = ROUNDING_CONFIG[tickSize];
  if (!config) {
    throw new Error(
      `tick_size "${tickSize}" non supporté par l'algorithme officiel ` +
        `(valeurs: ${Object.keys(ROUNDING_CONFIG).join(', ')})`,
    );
  }
  return config;
}

/**
 * Nombre de décimales de la représentation courte — équivalent de
 * `abs(Decimal(x.__str__()).as_tuple().exponent)` (helpers.py
 * `decimal_places`). `Number.toString` donne la repr. décimale la plus courte.
 */
export function decimalPlaces(x: number): number {
  const s = String(x);
  const exponentIdx = s.indexOf('e');
  if (exponentIdx >= 0) {
    const exponent = Number.parseInt(s.slice(exponentIdx + 1), 10);
    const dotIdx = s.indexOf('.');
    const fractionDigits = dotIdx >= 0 ? exponentIdx - dotIdx - 1 : 0;
    return Math.max(0, fractionDigits - exponent);
  }
  const dotIdx = s.indexOf('.');
  return dotIdx >= 0 ? s.length - dotIdx - 1 : 0;
}

export function roundDown(x: number, sigDigits: number): number {
  return Math.floor(x * 10 ** sigDigits) / 10 ** sigDigits;
}

export function roundNormal(x: number, sigDigits: number): number {
  return Math.round(x * 10 ** sigDigits) / 10 ** sigDigits;
}

export function roundUp(x: number, sigDigits: number): number {
  return Math.ceil(x * 10 ** sigDigits) / 10 ** sigDigits;
}

/** `to_token_decimals` : ×1e6 puis arrondi normal si besoin (helpers.py). */
export function toTokenDecimals(x: number): bigint {
  const scaled = 1_000_000 * x;
  return BigInt(decimalPlaces(scaled) > 0 ? roundNormal(scaled, 0) : scaled);
}

/**
 * Montants maker/taker officiels pour un ordre LIMITE (GTC) à tick_size donné.
 * Retourne les entiers CLOB en unités 6 décimales.
 */
export function calculateTickedOrderAmounts(
  side: 'BUY' | 'SELL',
  price: number,
  size: number,
  tickSize: string,
): { makerAmount: bigint; takerAmount: bigint } {
  if (!(price > 0) || !(size > 0)) throw new Error('price et size doivent etre positifs');
  const rc = roundingConfigForTickSize(tickSize);
  const rawPrice = roundNormal(price, rc.price);

  if (side === 'BUY') {
    const rawTakerAmount = roundDown(size, rc.size);
    let rawMakerAmount = rawTakerAmount * rawPrice;
    if (decimalPlaces(rawMakerAmount) > rc.amount) {
      rawMakerAmount = roundUp(rawMakerAmount, rc.amount + 4);
      if (decimalPlaces(rawMakerAmount) > rc.amount) {
        rawMakerAmount = roundDown(rawMakerAmount, rc.amount);
      }
    }
    return { makerAmount: toTokenDecimals(rawMakerAmount), takerAmount: toTokenDecimals(rawTakerAmount) };
  }

  const rawMakerAmount = roundDown(size, rc.size);
  let rawTakerAmount = rawMakerAmount * rawPrice;
  if (decimalPlaces(rawTakerAmount) > rc.amount) {
    rawTakerAmount = roundUp(rawTakerAmount, rc.amount + 4);
    if (decimalPlaces(rawTakerAmount) > rc.amount) {
      rawTakerAmount = roundDown(rawTakerAmount, rc.amount);
    }
  }
  return { makerAmount: toTokenDecimals(rawMakerAmount), takerAmount: toTokenDecimals(rawTakerAmount) };
}