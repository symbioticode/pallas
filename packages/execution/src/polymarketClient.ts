import { getIsDryRun } from './dryRun.js';
import { assertSignatureSchemaValidated, SignatureSchemaNotValidatedError } from './schemaGate.js';
import { buildL1Headers, buildL2Headers, type ClobApiCredentials } from './clobAuth.js';
import { privateKeyToAddress, signClobAuth } from './polymarketSigner.js';
import type { SignedOrderPayload } from './polymarketSigner.js';
import type { OrderParams, OrderStatus, Market } from './types.js';

export { SignatureSchemaNotValidatedError };

export interface PolymarketClientConfig {
  /** URL de base de l'API CLOB. Par defaut la prod publique. */
  baseUrl?: string;
  /** Deleguee pour les opens HTTP (injectable pour les tests). */
  fetcher?: typeof fetch;
  /** Controle dry-run ; par defaut lit le flag global de @pallas/core. */
  isDryRun?: () => boolean;
  /**
   * Credentials API + adresse du signataire pour les ECRITURES et endpoints
   * prives (L2 HMAC, docs getting-started/api). Aucune ecriture n'est possible
   * sans elles, meme en mode live valide.
   */
  auth?: ClobApiCredentials;
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

export interface ApiCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
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
  private readonly auth?: ClobApiCredentials;
  private readonly maxRetries: number;

  constructor(config: PolymarketClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://clob.polymarket.com';
    this.fetcher = config.fetcher ?? fetch;
    this.isDryRunFn = config.isDryRun ?? getIsDryRun;
    this.auth = config.auth;
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

  private requireAuth(label: string): ClobApiCredentials {
    if (!this.auth) {
      throw new Error(`${label}: credentials API requises (config.auth) en mode live`);
    }
    return this.auth;
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
   * Place un ordre CLOB V2 signe. ECRITURE : dry-run par defaut.
   * En live : auth (L2) + preuve de validation du schema (`schemaGate`) requis,
   * sinon fail-closed. Corps conforme aux docs : { deferExec, order, orderType,
   * owner (apiKey), postOnly? }.
   */
  async placeOrder(
    params: OrderParams,
    signed: SignedOrderPayload,
    opts: { postOnly?: boolean } = {},
  ): Promise<OrderResult> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('placeOrder');
    }
    assertSignatureSchemaValidated();
    const creds = this.requireAuth('placeOrder');

    const body = JSON.stringify({
      deferExec: false,
      order: signed.order,
      orderType: signed.orderType,
      owner: creds.apiKey,
      ...(opts.postOnly ? { postOnly: true } : {}),
    });
    const headers = await buildL2Headers(creds, 'POST', '/order', body);
    const res = await this.fetcher(`${this.baseUrl}/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await handleResponse(res)) as Record<string, unknown>;
    if (data['success'] === false) {
      throw new Error(`Polymarket placeOrder refuse: ${String(data['errorMsg'] ?? 'unknown')}`);
    }
    return {
      orderId: String(data['orderID'] ?? data['id'] ?? ''),
      status: (data['status'] as OrderStatus) ?? 'open',
      dryRun: false,
    };
  }

  /** Annule un ordre. ECRITURE : dry-run par defaut ; auth L2 requise en live (pas de gate ordre). */
  async cancelOrder(orderId: string): Promise<CancelResult> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('cancelOrder');
    }
    const creds = this.requireAuth('cancelOrder');
    const path = `/order/${orderId}`;
    const headers = await buildL2Headers(creds, 'DELETE', path);
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket cancel HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return { orderId, cancelled: true, dryRun: false };
  }

  /**
   * Derive les credentials API L2 depuis le wallet (EIP-712 ClobAuth + headers L1).
   * ECRITURE D'IDENTITE : dry-run par defaut. Ne necessite PAS le gate de schema
   * d'ordre (pas d'ordre signe ici).
   */
  async deriveApiKey(privKey: Uint8Array | string, nonce: bigint | number = 0n): Promise<ApiCreds> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('deriveApiKey');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = signClobAuth(privateKeyToAddress(privKey), timestamp, nonce, privKey);
    const headers = buildL1Headers(signed);
    const res = await this.fetcher(`${this.baseUrl}/auth/derive-api-key`, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await handleResponse(res)) as Record<string, unknown>;
    return {
      apiKey: String(data['apiKey'] ?? ''),
      secret: String(data['secret'] ?? ''),
      passphrase: String(data['passphrase'] ?? ''),
    };
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