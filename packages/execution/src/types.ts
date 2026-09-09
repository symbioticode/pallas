export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'open' | 'done' | 'canceled' | 'matched';

export interface OrderParams {
  marketId: string;
  price: number;
  size: number;
  side: OrderSide;
  /** token_id cible (yes/non). Facultatif si exporter par marketId. */
  tokenId?: string | null;
  lifetime?: number | null;
  feeRateBps?: number | null;
  nonce?: number | null;
  expireTime?: number | null;
  signature?: string | null;
  signatureType?: number | null;
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