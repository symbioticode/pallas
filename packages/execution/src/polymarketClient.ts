import { getIsDryRun } from './dryRun.js';
import type { OrderParams, OrderStatus, Market } from './types.js';
import type { SignedOrderPayload } from './polymarketSigner.js';

export interface PolymarketClientConfig {
  /** URL de base de l'API CLOB. Par defaut la prod publique. */
  baseUrl?: string;
  /** Deleguee pour les opens HTTP (injectable pour les tests). */
  fetcher?: typeof fetch;
  /** Controle dry-run ; par defaut lit le flag global de @pallas/core. */
  isDryRun?: () => boolean;
  /**
   * Passe a true UNIQUEMENT apres avoir valide le schema EIP-712 et le format
   * wire contre l'API CLOB live. Tant que false, placeOrder refuse (fail-closed).
   */
  signedOrdersValidated?: boolean;
}

export class SignatureSchemaNotValidatedError extends Error {
  constructor() {
    super('schema de signature Polymarket non valide en live : ordre refusé (fail-closed)');
    this.name = 'SignatureSchemaNotValidatedError';
  }
}

export interface MarketSummary {
  id: string;
  question: string;
  endDate: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  active: boolean;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  marketId: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  fetchedAt: string;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  dryRun: boolean;
}

export interface CancelResult {
  orderId: string;
  cancelled: boolean;
  dryRun: boolean;
}

function boolOf(v: unknown, fallback = true): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  return String(v) === 'true';
}

function mapMarket(raw: unknown): Market {
  const r = raw as Record<string, unknown>;
  const bestBid = r['best_bid'] != null ? Number(r['best_bid']) : null;
  const bestAsk = r['best_ask'] != null ? Number(r['best_ask']) : null;
  const ids = Array.isArray(r['clob_token_ids']) ? (r['clob_token_ids'] as Array<string>) : [];
  return {
    id: String(r['id'] ?? ''),
    question: String(r['question'] ?? ''),
    endDate: typeof r['end_date_iso'] === 'string' ? r['end_date_iso'] : null,
    yesTokenId: ids[0] ?? null,
    noTokenId: ids[1] ?? null,
    bestBid,
    bestAsk,
    active: boolOf(r['active'], true) && !boolOf(r['closed'], false),
  };
}

async function handleResponse(res: globalThis.Response): Promise<unknown> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Polymarket HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Construit un client Polymarket. Toute ecriture est dry-run par defaut. */
export class PolymarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly isDryRunFn: () => boolean;
  private readonly signedOrdersValidated: boolean;
  private readonly maxRetries: number;

  constructor(config: PolymarketClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://clob.polymarket.com';
    this.fetcher = config.fetcher ?? fetch;
    this.isDryRunFn = config.isDryRun ?? getIsDryRun;
    this.signedOrdersValidated = config.signedOrdersValidated ?? false;
    this.maxRetries = 2;
  }

  private async get<T>(path: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetcher(`${this.baseUrl}${path}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        return (await handleResponse(res)) as T;
      } catch (err) {
        lastErr = err;
        // retry sur erreurs transitoires seulement
        if (!(err instanceof TypeError)) throw err;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    }
    throw lastErr;
  }

  /** Cote passive. Ne fait AUCUN appel en dry-run (on arrete avant le fetch). */
  private async dryRunBlock(label: string): Promise<never> {
    throw new Error(`${label} blocked in dry-run (global dryRun active)`);
  }

  /** Liste les marches. Lecture : autorisee en dry-run. */
  async listMarkets(limit = 10): Promise<MarketSummary[]> {
    const data = await this.get<Record<string, unknown>>(`/markets?limit=${limit}&active=true&closed=false`);
    const arr = Array.isArray(data['data']) ? (data['data'] as unknown[]) : [];
    return arr.map((m) => this.toMarketSummary(m));
  }

  /** Orderbook d'un marche. Lecture : autorisee en dry-run. */
  async getOrderbook(marketId: string): Promise<Orderbook> {
    const data = await this.get<Record<string, unknown>>(`/book?token_id=${marketId}`);
    const bids = Array.isArray(data['bids']) ? (data['bids'] as unknown[]) : [];
    const asks = Array.isArray(data['asks']) ? (data['asks'] as unknown[]) : [];
    const parse = (levels: unknown[]): OrderbookLevel[] =>
      levels.map((l) => {
        const row = l as [string, string];
        return { price: Number(row[0]), size: Number(row[1]) };
      });
    return {
      marketId,
      bids: parse(bids),
      asks: parse(asks),
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Place un ordre. ECRITURE : dry-run par defaut (ne part jamais en dry-run).
   * En mode live, un payload signe (`buildSignedOrderPayload`) est requis et le
   * flag `signedOrdersValidated` doit etre a true (fail-closed sinon).
   */
  async placeOrder(params: OrderParams, signed?: SignedOrderPayload): Promise<OrderResult> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('placeOrder');
    }
    if (!this.signedOrdersValidated || !signed) {
      throw new SignatureSchemaNotValidatedError();
    }
    const res = await this.fetcher(`${this.baseUrl}/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedOrderWire(signed, params)),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await handleResponse(res) as Record<string, unknown>;
    return {
      orderId: String(data['orderID'] ?? data['id'] ?? ''),
      status: (data['status'] as OrderStatus) ?? 'open',
      dryRun: false,
    };
  }

  /** Annule un ordre. ECRITURE : dry-run par defaut. */
  async cancelOrder(orderId: string): Promise<CancelResult> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('cancelOrder');
    }
    const res = await this.fetcher(`${this.baseUrl}/order/${orderId}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket cancel HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return { orderId, cancelled: true, dryRun: false };
  }

  private toMarketSummary(raw: unknown): MarketSummary {
    const m = mapMarket(raw);
    return {
      id: m.id,
      question: m.question,
      endDate: m.endDate,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId,
      bestBid: m.bestBid,
      bestAsk: m.bestAsk,
      active: m.active,
    };
  }
}

/** Format wire attendu par l'API CLOB pour un ordre signe (EIP-712). */
function signedOrderWire(s: SignedOrderPayload, p: OrderParams): Record<string, unknown> {
  return {
    order: s.order,
    signature: s.signature,
    owner: s.owner,
    side: s.side,
    price: s.price,
    size: s.size,
    token_id: p.tokenId ?? s.order.tokenId,
  };
}