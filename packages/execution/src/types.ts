export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'open' | 'live' | 'matched' | 'delayed' | 'unmatched' | 'done' | 'canceled';

/** Params de placement d'ordre consommes par le client (le signe est signe a part). */
export interface OrderParams {
  marketId: string;
  price: number;
  size: number;
  side: OrderSide;
  /** token_id cible (yes/non). */
  tokenId?: string | null;
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