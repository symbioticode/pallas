import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ObservatoryRecord, ObservatorySnapshot } from './types.js';

const SECRET_KEY = /(private.?key|priv.?key|secret|passphrase|api.?key|credential|mnemonic|seed)/i;

export interface SnapshotOptions {
  rootDir: string;
  ledgerPath?: string;
  riskStatePath?: string;
  tokenId?: string;
  threshold?: number;
  size?: number;
  version?: string;
  commit?: string | null;
  fetcher?: typeof fetch;
  now?: () => Date;
  staleAfterMs?: number;
  marketQuestion?: string;
  marketOutcome?: string;
  demoOverride?: boolean;
  loopStatusPath?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function expectedHash(record: ObservatoryRecord): string {
  const content = canonicalJson({ index: record.index, event: record.event, timestamp: record.timestamp, payload: record.payload });
  return createHash('sha256').update(`${record.prev_hash}${content}`, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is ObservatoryRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return Number.isInteger(r['index']) && typeof r['event'] === 'string' && typeof r['timestamp'] === 'string'
    && typeof r['prev_hash'] === 'string' && typeof r['hash'] === 'string' && 'payload' in r;
}

export function readLedger(
  path: string,
): {
  status: 'VALID' | 'INVALID' | 'EMPTY';
  entries: ObservatoryRecord[];
  signed: 'SIGNED' | 'UNSIGNED' | 'INVALID';
} {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return { status: 'INVALID', entries: [], signed: checkpointSigned(path, []).signed }; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    return { status: 'INVALID', entries: [], signed: checkpointSigned(path, []).signed };
  }
  const entries = (parsed as { entries: unknown[] }).entries;
  if (entries.length === 0) return { status: 'EMPTY', entries: [], signed: checkpointSigned(path, []).signed };
  if (!entries.every(isRecord)) return { status: 'INVALID', entries: [], signed: checkpointSigned(path, entries as ObservatoryRecord[]).signed };
  for (let i = 0; i < entries.length; i += 1) {
    const current = entries[i] as ObservatoryRecord;
    if (current.index !== i || current.prev_hash !== (i === 0 ? '' : entries[i - 1]!.hash) || current.hash !== expectedHash(current)) {
      return { status: 'INVALID', entries: entries as ObservatoryRecord[], signed: checkpointSigned(path, entries as ObservatoryRecord[]).signed };
    }
  }
  return { status: 'VALID', entries: entries as ObservatoryRecord[], signed: checkpointSigned(path, entries as ObservatoryRecord[]).signed };
}

/** Présence et cohérence (ancrage) d'un checkpoint .sig — observatoire en lecture seule. */
function checkpointSigned(path: string, entries: readonly ObservatoryRecord[]): { signed: 'SIGNED' | 'UNSIGNED' | 'INVALID' } {
  let rawCp: unknown;
  try {
    rawCp = JSON.parse(readFileSync(`${path}.sig`, 'utf8'));
  } catch {
    return { signed: 'UNSIGNED' };
  }
  const cp = rawCp as { head_index?: unknown; head_hash?: unknown };
  if (
    typeof cp !== 'object' || cp === null ||
    typeof cp.head_index !== 'number' || typeof cp.head_hash !== 'string'
  ) {
    return { signed: 'INVALID' };
  }
  const anchor = entries[cp.head_index];
  if (anchor && anchor.hash === cp.head_hash && anchor.index === cp.head_index) {
    return { signed: 'SIGNED' };
  }
  // Le checkpoint n'ancre plus un maillon présent : SIGNEré mais chaîne réécrite -> on remonte INVALID.
  return { signed: 'INVALID' };
}

function readObject(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !SECRET_KEY.test(key)).map(([key, child]) => [key, redactSecrets(child)]));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

/**
 * PALLAS-M13 — lit l'état durable (format v2 : version + risk + orders +
 * checksum) pour l'Observatory. Manifeste la correction : l'état transactionnel
 * devient visible, y compris ses invariants d'intégrité.
 */
export interface DurabilityReport {
  format: 'V2' | 'LEGACY_V1' | 'MISSING' | 'CORRUPT';
  integrity: 'OK' | 'CORRUPT' | 'N/A';
  version: number | null;
  risk: Record<string, unknown> | null;
  orders: Array<Record<string, unknown>>;
  orderCount: number;
  /** Ordres avec empreinte potentiellement vivante (M14 : SUBMITTING/AMBIGUOUS/
   * RECONCILING/ACKED sans terminal) — bloque une nouvelle émission du scope. */
  liveOrders: number;
  /** Ordres en cours de réconciliation (M14). */
  reconcilingOrders: number;
  killSwitchEngaged: boolean | null;
  /** Exposition US cumulée des ordres vivants (PALLAS-M15). */
  liveExposureUsd: number | null;
  notes: string[];
}

const LIVE_STATUSES = new Set(['SUBMITTING', 'SUBMITTED', 'AMBIGUOUS', 'RECONCILING']);

export function readDurableState(path: string): DurabilityReport {
  const raw = readObject(path);
  if (raw === null) {
    return { format: 'MISSING', integrity: 'N/A', version: null, risk: null, orders: [], orderCount: 0, liveOrders: 0, reconcilingOrders: 0, killSwitchEngaged: null, liveExposureUsd: null, notes: ['state not found or unreadable'] };
  }
  const version = typeof raw['version'] === 'number' ? raw['version'] : null;
  if (version !== 2) {
    // v1 (ancien format M12) : contenu = StateOutput brut. Considéré valide
    // mais à migrer en v2 (le pipeline faill-stop M13 refusera v1 dès la
    // prochaine écriture de cycle).
    if (Array.isArray(raw['hist_pnls'])) {
      return { format: 'LEGACY_V1', integrity: 'N/A', version: null, risk: raw, orders: [], orderCount: 0, liveOrders: 0, reconcilingOrders: 0, killSwitchEngaged: null, liveExposureUsd: null, notes: ['legacy v1 state detected — migration v2 pending'] };
    }
    return { format: 'CORRUPT', integrity: 'CORRUPT', version, risk: null, orders: [], orderCount: 0, liveOrders: 0, reconcilingOrders: 0, killSwitchEngaged: null, liveExposureUsd: null, notes: ['unrecognized state document (not v2, not legacy v1)'] };
  }
  const risk = object(raw['risk']);
  const orders = Array.isArray(raw['orders']) ? raw['orders'].map(object).filter((o): o is Record<string, unknown> => o !== null) : [];
  const checksum = typeof raw['checksum'] === 'string' ? raw['checksum'] : null;
  const computed = checksum !== null
    ? expectedChecksum(risk, orders, raw['meta']) // meta absent ⇒ undefined (comme @pallas/strategy)
    : null;
  const integrityOk = checksum !== null && computed !== null && computed === checksum;
  const statuses = orders.map((o) => String(o['status'] ?? 'UNKNOWN'));
  const liveOrders = orders.filter((o) => {
    const status = String(o['status'] ?? '');
    return LIVE_STATUSES.has(status) || (status === 'ACKED' && o['terminal_reason'] == null);
  }).length;
  const liveExposureUsd = orders.filter((o) => {
    const status = String(o['status'] ?? '');
    return LIVE_STATUSES.has(status) || (status === 'ACKED' && o['terminal_reason'] == null);
  }).reduce((sum, o) => sum + (finite(o['est_value_usd']) ?? 0), 0);
  const reconcilingOrders = statuses.filter((s) => s === 'RECONCILING').length;
  const killSwitchEngaged = risk?.['kill_switch_engaged'] === true;
  const notes: string[] = [];
  if (checksum === null) notes.push('missing checksum');
  else if (!integrityOk) notes.push('checksum mismatch (tampering or partial write)');
  for (const s of new Set(statuses)) {
    const count = statuses.filter((v) => v === s).length;
    if (count > 0) notes.push(`${s.toLowerCase()}: ${count}`);
  }
  if (orders.some((o) => o['status'] === 'SUBMITTING' && o['order_id'] == null)) notes.push('reconciliation required (SUBMITTING, no local order id)');
  if (orders.some((o) => o['status'] === 'AMBIGUOUS')) notes.push('reconciliation required (AMBIGUOUS)');
  if (killSwitchEngaged) notes.push('kill switch ENGAGED (émission bloquée, cancel-all orderné)');
  return {
    format: 'V2',
    integrity: integrityOk ? 'OK' : 'CORRUPT',
    version,
    risk: integrityOk ? risk : null, // un état falsifié ne fait PAS autorité
    orders,
    orderCount: orders.length,
    liveOrders,
    reconcilingOrders,
    killSwitchEngaged,
    liveExposureUsd,
    notes,
  };
}

function expectedChecksum(risk: Record<string, unknown> | null, orders: unknown[], meta: unknown): string {
  // reflète EXACTEMENT `checksumOfState` de @pallas/strategy (version 2) :
  // canon JSON des champs data (risk + orders + meta), sha256 — indépendant de
  // `checksum` lui-même. meta: absent ⇒ `meta` vaut `undefined` dans l'objet,
  // et la canonisation signée encode cette absence en littéral "undefined" —
  // à reproduire à l'identique, sinon chaque état V2 paraîtrait falsifié.
  const content = canonicalJson({ version: 2, risk: risk ?? {}, orders, meta });
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function readMarket(tokenId: string | null, fetcher: typeof fetch, now: Date, staleAfterMs: number): Promise<ObservatorySnapshot['market']> {
  const unknown = { status: 'UNKNOWN' as const, tokenId, question: null, outcome: null, bestBid: null, bestAsk: null, mid: null, spread: null, timestamp: null };
  if (!tokenId) return unknown;
  try {
    const response = await fetcher(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, {
      method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ...unknown, error: `HTTP ${response.status}` };
    const data = object(await response.json());
    const prices = (input: unknown): number[] => Array.isArray(input) ? input.map(object).map((v) => Number(v?.['price'])).filter(Number.isFinite) : [];
    const bids = prices(data?.['bids']);
    const asks = prices(data?.['asks']);
    const bestBid = bids.length ? Math.max(...bids) : null;
    const bestAsk = asks.length ? Math.min(...asks) : null;
    const timestampRaw = data?.['timestamp'];
    const timestamp = typeof timestampRaw === 'string' || typeof timestampRaw === 'number' ? new Date(Number(timestampRaw) || timestampRaw).toISOString() : now.toISOString();
    const age = now.getTime() - Date.parse(timestamp);
    return { status: age > staleAfterMs ? 'STALE' : 'OK', tokenId, question: null, outcome: null, bestBid, bestAsk,
      mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
      spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null, timestamp };
  } catch (error) { return { ...unknown, error: error instanceof Error ? error.message : 'market read failed' }; }
}

export function resolveCommit(rootDir: string): string | null {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf8', timeout: 1_000 }).trim() || null; } catch { return null; }
}

export async function buildSnapshot(options: SnapshotOptions): Promise<ObservatorySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const ledger = readLedger(options.ledgerPath ?? resolve(options.rootDir, '.pallas/ledger.json'));
  const durability = readDurableState(options.riskStatePath ?? resolve(options.rootDir, '.pallas/risk-state.json'));
  const state = durability.risk;
  const loopStatus = readObject(options.loopStatusPath ?? resolve(options.rootDir, '.pallas/observatory-loop.json'));
  const entries = ledger.entries;
  // Un ledger invalide reste inspectable dans ACTIVITY, mais ne devient jamais
  // une source d'autorité pour les panneaux strategy/risk/system.
  const trustedEntries = ledger.status === 'VALID' ? entries : [];
  const cycleStart = trustedEntries.map((e) => e.event).lastIndexOf('cycle_start');
  const cycleEntries = cycleStart >= 0 ? trustedEntries.slice(cycleStart) : [];
  const last = (event: string) => [...cycleEntries].reverse().find((entry) => entry.event === event);
  const signalEntry = last('signal');
  const noSignal = Boolean(last('no_signal')) && !signalEntry;
  const signal = object(signalEntry?.payload);
  const riskEntry = last('risk_decision');
  const riskPayload = object(riskEntry?.payload);
  const decision = object(riskPayload?.['decision']);
  const stateAfter = object(riskPayload?.['state_after']) ?? state;
  const histPnls = Array.isArray(stateAfter?.['hist_pnls']) ? stateAfter['hist_pnls'] : null;
  const rawGates = Array.isArray(decision?.['gates']) ? decision['gates'] : [];
  const gates = rawGates.map(object).filter((g): g is Record<string, unknown> => g !== null).map((g) => ({ gate: String(g['gate'] ?? 'UNKNOWN'), action: String(g['action'] ?? 'UNKNOWN'), reason: String(g['reason'] ?? '') }));
  const configuredToken = options.tokenId ?? (typeof signal?.['tokenId'] === 'string' ? signal['tokenId'] : null);
  const execution = [...cycleEntries].reverse().find((entry) => entry.event.startsWith('execution_'))?.event ?? null;
  const signalHistory: ObservatorySnapshot['strategy']['history'] = [];
  for (let i = 0; i < trustedEntries.length; i += 1) {
    const entry = trustedEntries[i]!;
    if (entry.event !== 'signal') continue;
    const payload = object(entry.payload);
    if (configuredToken && payload?.['tokenId'] !== configuredToken) continue;
    const price = finite(payload?.['price']);
    if (price === null) continue;
    const nextCycleOffset = trustedEntries.slice(i + 1).findIndex((candidate) => candidate.event === 'cycle_start');
    const cycleEnd = nextCycleOffset < 0 ? trustedEntries.length : i + 1 + nextCycleOffset;
    const followingRisk = trustedEntries.slice(i + 1, cycleEnd).find((candidate) => candidate.event === 'risk_decision');
    const followingDecision = object(object(followingRisk?.payload)?.['decision']);
    const historyAllowed = typeof followingDecision?.['allowed'] === 'boolean' ? followingDecision['allowed'] : null;
    signalHistory.push({ timestamp: entry.timestamp, price, threshold: finite(payload?.['threshold']), risk: historyAllowed === null ? 'UNAVAILABLE' : historyAllowed ? 'ALLOW' : 'REJECT' });
  }
  const warnings: string[] = [];
  if (ledger.status === 'INVALID') warnings.push('LEDGER INVALID');
  if (ledger.status !== 'INVALID' && ledger.signed === 'INVALID') warnings.push('LEDGER CHECKPOINT INVALID (chaîne réécrite après signature ?)');
  if (ledger.status !== 'INVALID' && ledger.status !== 'EMPTY' && ledger.signed === 'UNSIGNED') warnings.push('LEDGER UNSIGNED (signature PALLAS-M16 non active)');
  if (durability.format === 'MISSING') warnings.push('RISK STATE UNAVAILABLE');
  if (durability.format === 'LEGACY_V1') warnings.push('RISK STATE LEGACY V1 (migration v2 pending)');
  if (durability.integrity === 'CORRUPT') warnings.push('RISK STATE CORRUPT (checksum) — fail-stop, réconciliation requise');
  if (durability.orders.some((o) => o['status'] === 'SUBMITTING')) warnings.push('RECONCILIATION REQUIRED (SUBMITTING, no order id)');
  if (durability.orders.some((o) => o['status'] === 'AMBIGUOUS')) warnings.push('RECONCILIATION REQUIRED (AMBIGUOUS order)');
  if (durability.orders.some((o) => o['status'] === 'RECONCILING')) warnings.push('RECONCILIATION IN PROGRESS (emission blocked)');
  if (durability.killSwitchEngaged) warnings.push('KILL SWITCH ENGAGED (no emission, cancel-all fired)');
  if (cycleStart < 0) warnings.push('NO CYCLE RECORDED');
  const market = await readMarket(configuredToken, options.fetcher ?? fetch, now, options.staleAfterMs ?? 15_000);
  if (market.status === 'STALE') warnings.push('MARKET DATA STALE');
  if (market.status === 'UNKNOWN') warnings.push('MARKET DATA UNKNOWN');
  const allowed = typeof decision?.['allowed'] === 'boolean' ? decision['allowed'] : null;
  const lastEventAt = trustedEntries.at(-1)?.timestamp ?? null;
  const loopAgeSeconds = lastEventAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastEventAt)) / 1_000)) : null;
  const reportedLoop = loopStatus?.['status'];
  const loop = reportedLoop === 'running' ? (loopAgeSeconds !== null && loopAgeSeconds <= 10 ? 'RUNNING' : 'STALE')
    : reportedLoop === 'stopped' ? 'STOPPED' : loopAgeSeconds !== null && loopAgeSeconds > 10 ? 'STALE' : 'UNKNOWN';
  const snapshot: ObservatorySnapshot = {
    generatedAt: now.toISOString(),
    system: { name: 'PALLAS', version: options.version ?? '0.1.0', commit: options.commit === undefined ? resolveCommit(options.rootDir) : options.commit,
      mode: 'DRY RUN', ledger: ledger.status, ledgerSigned: ledger.signed, ledgerEntries: entries.length, lastEventAt, loop, loopAgeSeconds },
    durability: {
      format: durability.format,
      integrity: durability.integrity,
      version: durability.version,
      orders: durability.orders.map((o) => ({
        correlationId: String(o['correlationId'] ?? ''),
        status: String(o['status'] ?? 'UNKNOWN'),
        orderId: typeof o['order_id'] === 'string' ? o['order_id'] : null,
        outcome: typeof o['outcome'] === 'string' ? o['outcome'] : null,
        marketId: String(o['market_id'] ?? ''),
        side: String(o['side'] ?? ''),
      })),
      orderCount: durability.orderCount,
      liveOrders: durability.liveOrders,
      reconcilingOrders: durability.reconcilingOrders,
      killSwitchEngaged: durability.killSwitchEngaged,
      notes: durability.notes,
    },
    market: { ...market, question: options.marketQuestion ?? null, outcome: options.marketOutcome ?? null },
    strategy: { name: 'ReferenceStrategy', disclaimer: 'REFERENCE STRATEGY — NON PREDICTIVE',
      signal: signal ? 'BUY' : noSignal ? 'NO SIGNAL' : 'NO SIGNAL YET', threshold: finite(signal?.['threshold']) ?? options.threshold ?? null,
      requestedSize: finite(signal?.['size']) ?? options.size ?? null, observedPrice: finite(signal?.['price']), demoOverride: options.demoOverride ?? false, history: signalHistory.slice(-100) },
    risk: { status: allowed === null ? 'UNAVAILABLE' : allowed ? 'ALLOW' : 'REJECT',
      rejectedBy: Array.isArray(decision?.['rejected_by']) ? decision['rejected_by'].map(String) : [], suggestedSizeUsd: finite(decision?.['suggested_size_usd']), gates,
      circuitBreaker: stateAfter?.['circuit_breaker'] ?? null, killSwitchEngaged: typeof stateAfter?.['kill_switch_engaged'] === 'boolean' ? stateAfter['kill_switch_engaged'] : null,
      pnlSampleSize: histPnls?.length ?? null, liveExposureUsd: durability.liveExposureUsd },
    cycle: { status: cycleStart >= 0 ? 'RECORDED' : 'NONE', execution },
    activity: entries.slice(-50), warnings,
  };
  return redactSecrets(snapshot) as ObservatorySnapshot;
}
