export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'open' | 'live' | 'matched' | 'delayed' | 'unmatched' | 'done' | 'canceled';

/**
 * Params de placement d'ordre consommes par le client (le signe est signe a part).
 *
 * PALLAS-M17 : `marketId` est DEFINI PRECISEMENT comme l'actif CLOB echange
 * (le CLOB cote des actifs/tokens, pas des conditions) ; un ordre doit cibler
 * UN token. L'invariant est une egalite triple :
 *   params.marketId === params.tokenId === signed.order.tokenId
 * Un appelant avec un `marketId` different du token (par ex. une condition_id
 * au lieu du token) est rejete avant tout appel reseau.
 */
export interface OrderParams {
  /** Actif CLOB echange — obligatoire, doit egaler `tokenId`. */
  marketId: string;
  price: number;
  size: number;
  side: OrderSide;
  /** token_id cible (yes/non) — OBLIGATOIRE (audit v0.3 F-07). */
  tokenId: string;
  /**
   * tick_size du marche : utilise pour recalculer les montants avec
   * l'algorithme officiel de rounding par tick lors du cross-check.
   */
  tickSize?: string;
}

export interface Market {
  id: string;
  question: string;
  endDate: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  active: boolean;
}

export interface Trade {
  orderId: string;
  marketId: string;
  side: OrderSide;
  size: number;
  price: number;
  timestamp: string;
  status: OrderStatus;
}