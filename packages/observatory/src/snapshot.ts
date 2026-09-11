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

export function readLedger(path: string): { status: 'VALID' | 'INVALID' | 'EMPTY'; entries: ObservatoryRecord[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return { status: 'INVALID', entries: [] }; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    return { status: 'INVALID', entries: [] };
  }
  const entries = (parsed as { entries: unknown[] }).entries;
  if (entries.length === 0) return { status: 'EMPTY', entries: [] };
  if (!entries.every(isRecord)) return { status: 'INVALID', entries: [] };
  for (let i = 0; i < entries.length; i += 1) {
    const current = entries[i]!;
    if (current.index !== i || current.prev_hash !== (i === 0 ? '' : entries[i - 1]!.hash) || current.hash !== expectedHash(current)) {
      return { status: 'INVALID', entries };
    }
  }
  return { status: 'VALID', entries };
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
  const state = readObject(options.riskStatePath ?? resolve(options.rootDir, '.pallas/risk-state.json'));
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
  if (!state) warnings.push('RISK STATE UNAVAILABLE');
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
      mode: 'DRY RUN', ledger: ledger.status, ledgerEntries: entries.length, lastEventAt, loop, loopAgeSeconds },
    market: { ...market, question: options.marketQuestion ?? null, outcome: options.marketOutcome ?? null },
    strategy: { name: 'ReferenceStrategy', disclaimer: 'REFERENCE STRATEGY — NON PREDICTIVE',
      signal: signal ? 'BUY' : noSignal ? 'NO SIGNAL' : 'NO SIGNAL YET', threshold: finite(signal?.['threshold']) ?? options.threshold ?? null,
      requestedSize: finite(signal?.['size']) ?? options.size ?? null, observedPrice: finite(signal?.['price']), demoOverride: options.demoOverride ?? false, history: signalHistory.slice(-100) },
    risk: { status: allowed === null ? 'UNAVAILABLE' : allowed ? 'ALLOW' : 'REJECT',
      rejectedBy: Array.isArray(decision?.['rejected_by']) ? decision['rejected_by'].map(String) : [], suggestedSizeUsd: finite(decision?.['suggested_size_usd']), gates,
      circuitBreaker: stateAfter?.['circuit_breaker'] ?? null, killSwitchEngaged: typeof stateAfter?.['kill_switch_engaged'] === 'boolean' ? stateAfter['kill_switch_engaged'] : null,
      pnlSampleSize: histPnls?.length ?? null },
    cycle: { status: cycleStart >= 0 ? 'RECORDED' : 'NONE', execution },
    activity: entries.slice(-50), warnings,
  };
  return redactSecrets(snapshot) as ObservatorySnapshot;
}
