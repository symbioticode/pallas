import { getIsDryRun } from './dryRun.js';
import { getGlobalKillSwitch, KillSwitchEngagedError } from './killSwitch.js';
import { assertSignatureSchemaValidated, SignatureSchemaNotValidatedError } from './schemaGate.js';
import { buildL1Headers, buildL2Headers, type ClobApiCredentials } from './clobAuth.js';
import { privateKeyToAddress, signClobAuth, calculateOrderAmounts } from './polymarketSigner.js';
import type { SignedOrderPayload } from './polymarketSigner.js';
import type { OrderParams, OrderStatus, Market } from './types.js';
import { z } from 'zod';
import {
  ClobValidationError,
  parseClob,
  CancelAllResponseSchema,
  ClobOrderSchema,
  DeriveApiKeyResponseSchema,
  MarketsResponseSchema,
  OpenOrdersResponseSchema,
  OrderbookSchema,
  PlaceOrderResponseSchema,
} from './clobSchema.js';

export {
  SignatureSchemaNotValidatedError,
  ClobValidationError,
  KillSwitchEngagedError,
};

export interface PolymarketClientConfig {
  /** URL de base de l'API CLOB. Par defaut la prod publique. */
  baseUrl?: string;
  /** Deleguee pour les opens HTTP (injectable pour les tests). */
  fetcher?: typeof fetch;
  /**
   * Controle dry-run ; par defaut lit le flag global de @pallas/core.
   * PALLAS-M10 (decision, reserve devient explicite) : cette injection est
   * RESERVEE AUX TESTS. Aucun appelant de production ne doit fournir ce
   * delegate ; la politique d'assemblage de la Phase 3 (gateway/agent, cf.
   * PLAN.md) devra INTERDIRE cette injection hors tests (SECURITY.md §
   * « isDryRun injectable »).
   */
  isDryRun?: () => boolean;
  /**
   * Controle kill switch au point d'emission ; par defaut lit le flag global de
   * @pallas/execution (killSwitch.ts). PALLAS-M14 : defense en profondeur —
   * en PLUS de la porte KILL_SWITCH du risk engine, placeOrder refuse d'emettre
   * si le kill switch est engage.
   */
  isKillSwitchEngaged?: () => boolean;
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
  /** Statut HTTP brut de la réponse (pour le journal d'audit, PALLAS-M16). */
  httpStatus: number;
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

/** Un ordre tel que lu par `getOpenOrders`/`getOrder` (PALLAS-M14). */
export interface ReadOrder {
  orderId: string;
  assetId: string;
  side: 'BUY' | 'SELL' | null;
  price: number | null;
  size: number | null;
  originalSize: number | null;
  status: string | null;
  maker: string | null;
}

/**
 * PALLAS-M04 — l'API CLOB n'a AUCUNE cle d'idempotence (docs place-orders : le
 * corps POST n'a que deferExec/order/orderType/owner/postOnly). Un timeout ou
 * un 5xx sur placeOrder laisse donc le resultat INDETERMINE : re-emettre
 * automatiquement peut placer DEUX ordres. On ne reessaye jamais un POST ; on
 * leve une erreur "ambiguë" que l'appelant DOIT reconcilier (verifier ordres
 * ouverts / balances) avant toute nouvelle emission.
 */
export class AmbiguousOrderError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `placeOrder: reponse indeterminee (requete envoyee, resultat inconnu) — l'ordre PEUT avoir ete place; ` +
        `ne pas re-emettre sans reconciliation. detail: ${detail}`,
    );
    this.name = 'AmbiguousOrderError';
  }
}

/**
 * PALLAS-M10 — le payload signe ne correspond PAS a l'intention declaree.
 * `placeOrder` recoit les deux (params + signed) : une divergence ici signifie
 * qu'un bug ailleurs dans la chaine a construit un ordre different de ce que
 * l'appelant croit envoyer. Rejet avant tout appel reseau.
 */
export class OrderMismatchError extends Error {
  constructor(detail: string) {
    super(`placeOrder: le payload signe ne correspond pas aux params declares (${detail})`);
    this.name = 'OrderMismatchError';
  }
}

/**
 * Compare `params` (l'intention) au `signed.order` (ce qui sera transmis).
 * Tolérance de 1 unite (1e-6 USD ou share) : l'arithmetique flottante refaite
 * ici et dans `calculateOrderAmounts` doit donner le meme entier, 1 unite
 * absorbe un quelconque arrondi de recopie — jamais plus.
 */
function assertOrderMatchesParams(signed: SignedOrderPayload, params: OrderParams): void {
  const o = signed.order;
  const absBig = (x: bigint): bigint => (x < 0n ? -x : x);
  const sideMatches = o.side === params.side;
  const tokenMatches = params.tokenId == null || o.tokenId === params.tokenId;
  const expected = calculateOrderAmounts(params.side, params.price, params.size);
  const tol = 1n;
  const mDiff = absBig(BigInt(o.makerAmount) - expected.makerAmount);
  const tDiff = absBig(BigInt(o.takerAmount) - expected.takerAmount);
  if (!sideMatches || !tokenMatches || mDiff > tol || tDiff > tol) {
    throw new OrderMismatchError(
      `side(match=${sideMatches}) tokenId(match=${tokenMatches}) makerAmount(Δ=${mDiff} unités 1e-6, tol=${tol}) ` +
        `takerAmount(Δ=${tDiff} unités 1e-6, tol=${tol})`,
    );
  }
}

/** Erreur HTTP 5xx : reponse de "failover" reçue, retrable sans danger. */
class RetryableHttpError extends Error {}

function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const name = (err as Error | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function boolOf(v: unknown, fallback = true): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  return String(v) === 'true';
}

function mapMarket(raw: unknown): Market {
  const r = raw as Record<string, unknown>;
  const tokens = Array.isArray(r['tokens']) ? (r['tokens'] as Array<Record<string, unknown>>) : [];
  const pick = (outcome: 'Yes' | 'No'): string | null => {
    const found = tokens.find((t) => t['outcome'] === outcome);
    const id = found?.['token_id'];
    // token_id vide (marches pas encore nes) => null, jamais '' exploitable.
    return typeof id === 'string' && id.length > 0 ? id : null;
  };
  return {
    id: String(r['condition_id'] ?? ''),
    question: String(r['question'] ?? ''),
    endDate: typeof r['end_date_iso'] === 'string' ? r['end_date_iso'] : null,
    yesTokenId: pick('Yes'),
    noTokenId: pick('No'),
    // La refonte API (verifiee 2026-09-09) a retire best_bid/best_ask de la
    // liste des marches : le prix d'une option se lit via /book?token_id=...
    bestBid: null,
    bestAsk: null,
    active: boolOf(r['active'], true) && !boolOf(r['closed'], false),
  };
}

/** Construit un client Polymarket. Toute ecriture est dry-run par defaut. */
export class PolymarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly isDryRunFn: () => boolean;
  private readonly isKillSwitchEngagedFn: () => boolean;
  private readonly auth?: ClobApiCredentials;
  private readonly maxRetries: number;

  constructor(config: PolymarketClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://clob.polymarket.com';
    this.fetcher = config.fetcher ?? fetch;
    this.isDryRunFn = config.isDryRun ?? getIsDryRun;
    this.isKillSwitchEngagedFn = config.isKillSwitchEngaged ?? getGlobalKillSwitch;
    this.auth = config.auth;
    this.maxRetries = 2;
  }

  private async get(path: string): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.fetcher(`${this.baseUrl}${path}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const http = new Error(`Polymarket HTTP ${res.status}: ${body.slice(0, 200)}`);
          if (res.status >= 500) throw new RetryableHttpError(http.message);
          throw http;
        }
        return await res.json();
      } catch (err) {
        const transient = isTransientNetworkError(err) || err instanceof RetryableHttpError;
        if (!transient) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          await sleep(200 * 2 ** attempt);
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
    const data = await this.get(`/markets?limit=${limit}&active=true&closed=false`);
    const parsed = parseClob(MarketsResponseSchema, 'listMarkets', data);
    return parsed.data.map((m) => this.toMarketSummary(m));
  }

  /** Orderbook d'un marche. Lecture : autorisee en dry-run. */
  async getOrderbook(marketId: string): Promise<Orderbook> {
    const data = await this.get(`/book?token_id=${marketId}`);
    const parsed = parseClob(OrderbookSchema, 'getOrderbook', data);
    const parse = (levels: { price: string | number; size: string | number }[]): OrderbookLevel[] =>
      levels.map((l) => ({ price: Number(l.price), size: Number(l.size) }));
    return {
      marketId,
      bids: parse(parsed.bids),
      asks: parse(parsed.asks),
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
    // PALLAS-M14 : defense en profondeur — le kill switch bloque l'EMISSION
    // directement, en plus de la porte KILL_SWITCH du risk engine.
    if (this.isKillSwitchEngagedFn()) {
      throw new KillSwitchEngagedError();
    }
    assertSignatureSchemaValidated();
    // PALLAS-M10 : l'intention declaree doit correspondre a ce qui est signe,
    // AVANT tout appel reseau (une divergence = bug ailleurs dans la chaine).
    assertOrderMatchesParams(signed, params);
    const creds = this.requireAuth('placeOrder');

    const body = JSON.stringify({
      deferExec: false,
      order: signed.order,
      orderType: signed.orderType,
      owner: creds.apiKey,
      ...(opts.postOnly ? { postOnly: true } : {}),
    });
    const headers = await buildL2Headers(creds, 'POST', '/order', body);

    let res: globalThis.Response;
    try {
      res = await this.fetcher(`${this.baseUrl}/order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // Timeout/reseau : resultat INDETERMINE — pas de retry (double-placement).
      throw new AmbiguousOrderError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status >= 500) {
        // 5xx = reponse serveur "failover", mais l'ordre a pu etre accepte avant.
        throw new AmbiguousOrderError(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`));
      }
      throw new Error(`Polymarket HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = parseClob(PlaceOrderResponseSchema, 'placeOrder', await res.json().catch(() => null));
    if (data.success === false) {
      throw new Error(`Polymarket placeOrder refuse: ${String(data.errorMsg ?? 'unknown')}`);
    }
    const orderId = data.orderID ?? '';
    if (!orderId) {
      throw new ClobValidationError('placeOrder: orderID absent de la reponse acceptee');
    }
    return {
      orderId,
      status: (data.status as OrderStatus) ?? 'open',
      dryRun: false,
      httpStatus: res.status,
    };
  }

  /** Annule un ordre. ECRITURE : dry-run par defaut ; auth L2 requise en live (pas de gate ordre). */
  async cancelOrder(orderId: string): Promise<CancelResult> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('cancelOrder');
    }
    const creds = this.requireAuth('cancelOrder');
    const path = `/order/${orderId}`;

    // DELETE est IDEMPOTENT par orderId : cancel d'un ordre deja annule/inconnu
    // est un no-op cote CLOB. On peut donc retenter les erreurs transitoires
    // (reseau, timeout, 5xx) — pas les 4xx qui sont definitives.
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const headers = await buildL2Headers(creds, 'DELETE', path);
        const res = await this.fetcher(`${this.baseUrl}${path}`, {
          method: 'DELETE',
          headers: { accept: 'application/json', ...headers },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          return { orderId, cancelled: true, dryRun: false };
        }
        const body = await res.text().catch(() => '');
        const http = new Error(`Polymarket cancel HTTP ${res.status}: ${body.slice(0, 200)}`);
        if (res.status >= 500) throw new RetryableHttpError(http.message);
        throw http;
      } catch (err) {
        const transient = isTransientNetworkError(err) || err instanceof RetryableHttpError;
        if (!transient) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          await sleep(200 * 2 ** attempt);
        }
      }
    }
    throw lastErr;
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
    // PALLAS-M10 : erreur HTTP explicite AVANT le parsing schema (un 401/500 ne
    // doit jamais devenir une erreur de schema JSON confuse).
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket deriveApiKey HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = parseClob(DeriveApiKeyResponseSchema, 'deriveApiKey', await res.json().catch(() => null));
    return {
      apiKey: data.apiKey,
      secret: data.secret,
      passphrase: data.passphrase,
    };
  }

  /**
   * Annule tous les ordres ouverts du maker (PALLAS-M14). ECRITURE : dry-run
   * par defaut. Primitive de securite : idempotente, aucune verification de
   * schema d'ordre requise — c'est le chemin de sortie du kill switch.
   */
  async cancelAllOrders(): Promise<{ cancelled: boolean; dryRun: boolean }> {
    if (this.isDryRunFn()) {
      await this.dryRunBlock('cancelAllOrders');
    }
    const creds = this.requireAuth('cancelAllOrders');
    const headers = await buildL2Headers(creds, 'DELETE', '/cancel-all');
    const res = await this.fetcher(`${this.baseUrl}/cancel-all`, {
      method: 'DELETE',
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket cancel-all HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = parseClob(CancelAllResponseSchema, 'cancelAllOrders', await res.json().catch(() => null));
    if (data.success === false) {
      throw new Error(`Polymarket cancel-all refuse: ${String(data.errorMsg ?? 'unknown')}`);
    }
    return { cancelled: data.success === true, dryRun: false };
  }

  /**
   * Lit les ordres OUVERTS d'un maker (`GET /data/orders`). Lecture
   * authentifiee L2, autorisee en dry-run (aucun effet de bord).
   */
  async getOpenOrders(maker: string, opts: { filterState?: string } = {}): Promise<ReadOrder[]> {
    const creds = this.requireAuth('getOpenOrders');
    const query = new URLSearchParams({ maker });
    if (opts.filterState) query.set('filter_state', opts.filterState);
    const path = `/data/orders?${query}`;
    const headers = await buildL2Headers(creds, 'GET', path);
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket getOpenOrders HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = parseClob(OpenOrdersResponseSchema, 'getOpenOrders', await res.json().catch(() => null));
    return data.data.map((o) => this.toReadOrder(o));
  }

  /** Lit UN ordre (`GET /data/order/<orderID>`). Lecture authentifiee L2. */
  async getOrder(orderId: string): Promise<ReadOrder> {
    const creds = this.requireAuth('getOrder');
    const path = `/data/order/${encodeURIComponent(orderId)}`;
    const headers = await buildL2Headers(creds, 'GET', path);
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polymarket getOrder HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = parseClob(ClobOrderSchema, 'getOrder', await res.json().catch(() => null));
    return this.toReadOrder(data);
  }

  private toReadOrder(raw: z.infer<typeof ClobOrderSchema>): ReadOrder {
    const side = String(raw.side ?? '').toUpperCase();
    return {
      orderId: raw.orderID,
      assetId: raw.asset_id,
      side: side === 'BUY' || side === 'SELL' ? side : null,
      price: typeof raw.price === 'number' ? raw.price : typeof raw.price === 'string' ? Number(raw.price) : null,
      size: typeof raw.size === 'number' ? raw.size : typeof raw.size === 'string' ? Number(raw.size) : null,
      originalSize:
        typeof raw.original_size === 'number'
          ? raw.original_size
          : typeof raw.original_size === 'string'
            ? Number(raw.original_size)
            : null,
      status: raw.status ?? null,
      maker: raw.maker ?? null,
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