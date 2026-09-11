import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDashboard } from './render.js';
import { buildSnapshot, readDurableState, redactSecrets } from './snapshot.js';
import { createReadOnlyRouter } from './server.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

function ledgerFile(dir: string, allowed: boolean, extra: Record<string, unknown> = {}): void {
  const inputs = [
    { event: 'cycle_start', timestamp: '2026-09-10T12:00:00.000Z', payload: { cycle: 1 } },
    { event: 'signal', timestamp: '2026-09-10T12:00:01.000Z', payload: { tokenId: '123456789012345678901234', side: 'BUY', price: 0.42, size: 2, threshold: 0.5, ...extra } },
    { event: 'risk_decision', timestamp: '2026-09-10T12:00:02.000Z', payload: { decision: { allowed, rejected_by: allowed ? [] : ['POSITION_LIMIT'], suggested_size_usd: allowed ? 10 : 0, gates: [{ gate: 'POSITION_LIMIT', action: allowed ? 'Allow' : 'Reject', reason: 'fixture' }] }, state_after: { hist_pnls: [-1, 2], kill_switch_engaged: false, circuit_breaker: { state: 'Closed' } } } },
    { event: 'execution_dry_run_blocked', timestamp: '2026-09-10T12:00:03.000Z', payload: { blocked_by: 'dry-run' } },
  ];
  let previous = '';
  const entries = inputs.map((input, index) => {
    const content = canonical({ index, ...input });
    const hash = createHash('sha256').update(previous + content).digest('hex');
    const record = { index, ...input, prev_hash: previous, hash };
    previous = hash;
    return record;
  });
  writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ root: 'pallas', entries }));
  writeFileSync(join(dir, 'risk.json'), JSON.stringify({ hist_pnls: [-1, 2], circuit_breaker: { state: 'Closed' } }));
}

const noNetwork: typeof fetch = async () => { throw new Error('offline fixture'); };

async function fixtureSnapshot(allowed: boolean, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
  ledgerFile(dir, allowed, extra);
  return buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: 'abc123' });
}

describe('Observatory read-only boundary', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('rejects the %s method', async (method) => {
    const route = createReadOnlyRouter({ rootDir: '/nonexistent', fetcher: noNetwork, commit: null });
    const response = await route(method, '/api/snapshot');
    expect(response.status).toBe(405);
    expect(response.headers?.Allow).toBe('GET');
  });

  it('has exactly two GET surfaces and no mutation route', async () => {
    const route = createReadOnlyRouter({ rootDir: '/nonexistent', fetcher: noNetwork, commit: null });
    expect((await route('GET', '/')).status).toBe(200);
    expect((await route('GET', '/api/snapshot')).status).toBe(200);
    expect((await route('GET', '/orders')).status).toBe(404);
  });

  it('does not import execution, risk, strategy, or credential-bearing packages', async () => {
    const sources = await Promise.all(['server.ts', 'snapshot.ts', 'render.ts', 'page.ts'].map(async (name) => (await import('node:fs/promises')).readFile(new URL(name, import.meta.url), 'utf8')));
    expect(sources.join('\n')).not.toMatch(/from ['"]@pallas\/(execution|risk|strategy|core)/);
    expect(sources.join('\n')).not.toMatch(/\b(placeOrder|cancelOrder|disableDryRun|deriveApiKey)\b/);
  });

  it('serializes no private key or credential field, recursively', async () => {
    const snapshot = await fixtureSnapshot(true, { privateKey: '0xdeadbeef', api_secret: 'secret', nested: { passphrase: 'pw' } });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/deadbeef|api_secret|passphrase|privateKey|"pw"/i);
    expect(JSON.stringify(redactSecrets({ credential: 'x', safe: 1 }))).toBe('{"safe":1}');
  });
});

describe('Observatory rendering', () => {
  it('renders a real ALLOW decision and dry-run result', async () => {
    const html = renderDashboard(await fixtureSnapshot(true));
    expect(html).toContain('ALLOW');
    expect(html).toContain('DRY RUN');
    expect(html).toContain('EXECUTION DRY RUN BLOCKED');
    expect(html).toContain('REFERENCE STRATEGY — NON PREDICTIVE');
  });

  it('renders signal history as a read-only SVG with risk-coded points', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    ledgerFile(dir, true);
    const raw = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8'));
    const firstCycle = raw.entries;
    const secondInputs = firstCycle.map((entry: Record<string, unknown>) => ({ ...entry, timestamp: String(entry.timestamp).replace('12:00', '12:01') }));
    let previous = firstCycle.at(-1).hash;
    for (const input of secondInputs) {
      const index = raw.entries.length;
      const base = { index, event: input.event, timestamp: input.timestamp, payload: input.payload };
      const hash = createHash('sha256').update(previous + canonical(base)).digest('hex');
      raw.entries.push({ ...base, prev_hash: previous, hash });
      previous = hash;
    }
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify(raw));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: null });
    const html = renderDashboard(snapshot);
    expect(snapshot.strategy.history).toHaveLength(2);
    expect(html).toContain('<svg class="history"');
    expect(html).toContain('2 SIGNAUX');
    expect(html).toContain('signal-dot allow');
  });

  it('renders human market metadata, demo override, versions, and loop health', async () => {
    const snapshot = await fixtureSnapshot(true);
    snapshot.market.question = '49ers vs. Rams';
    snapshot.market.outcome = '49ers';
    snapshot.strategy.demoOverride = true;
    snapshot.system.loop = 'RUNNING';
    snapshot.system.loopAgeSeconds = 2;
    const html = renderDashboard(snapshot);
    expect(html).toContain('49ers vs. Rams — 49ers');
    expect(html).toContain('DEMO OVERRIDE');
    expect(html).toContain('REFERENCE LOOP');
    expect(html).toContain('RUNNING');
    expect(html).toContain('APP v0.1.0 · AUDIT BASELINE v0.3');
  });

  it('renders a real REJECT decision and rejected_by', async () => {
    const html = renderDashboard(await fixtureSnapshot(false));
    expect(html).toContain('REJECT');
    expect(html).toContain('POSITION_LIMIT');
  });

  it('renders LEDGER INVALID instead of treating corruption as healthy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'ledger.json'), '{ broken');
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'missing-risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.system.ledger).toBe('INVALID');
    expect(renderDashboard(snapshot)).toContain('LEDGER INVALID');
  });

  it('M16: exposes LEDGER UNSIGNED and renders the badge without a checkpoint', async () => {
    const snapshot = await fixtureSnapshot(true);
    expect(snapshot.system.ledgerSigned).toBe('UNSIGNED');
    const html = renderDashboard(snapshot);
    expect(html).toContain('UNSIGNED');
    expect(html).toContain('badge-valid');
  });

  it('M16: a coherent .sig checkpoint manifests LEDGER SIGNED', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    ledgerFile(dir, true);
    const raw = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8'));
    const head = raw.entries.at(-1);
    writeFileSync(join(dir, 'ledger.json.sig'), JSON.stringify({ head_index: head.index, head_hash: head.hash, signature: '0x' + 'ab'.repeat(32) }));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.system.ledger).toBe('VALID');
    expect(snapshot.system.ledgerSigned).toBe('SIGNED');
    expect(snapshot.warnings).not.toContain('LEDGER UNSIGNED (signature PALLAS-M16 non active)');
    expect(renderDashboard(snapshot)).toContain('SIGNED');
  });

  it('M16: a checkpoint that no longer anchors the chain escalates to SIGNATURE INVALID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    ledgerFile(dir, true);
    const raw = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8'));
    writeFileSync(join(dir, 'ledger.json.sig'), JSON.stringify({ head_index: 3, head_hash: '0'.repeat(64), signature: '0x' + 'cd'.repeat(32) }));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.system.ledgerSigned).toBe('INVALID');
    expect(snapshot.warnings).toContain('LEDGER CHECKPOINT INVALID (chaîne réécrite après signature ?)');
    expect(renderDashboard(snapshot)).toContain('SIGNATURE INVALID');
  });

  it('renders NO CYCLE RECORDED when no cycle exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ root: 'pallas', entries: [] }));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'missing-risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.cycle.status).toBe('NONE');
    expect(renderDashboard(snapshot)).toContain('NO CYCLE RECORDED');
  });
});

describe('Observatory — état durable v2 (PALLAS-M13)', () => {
  // reproduit checksumOfState de @pallas/strategy : canonical({version, risk,
  // orders, meta}) avec meta absent ⇒ undefined sérialise en "undefined".
  function checksumV2(risk: Record<string, unknown>, orders: unknown[]): string {
    return createHash('sha256').update(canonical({ version: 2, risk, orders, meta: undefined })).digest('hex');
  }

  function stateV2(risk: Record<string, unknown>, orders: unknown[] = []): string {
    return JSON.stringify({ version: 2, checksum: checksumV2(risk, orders), risk, orders });
  }

  const NEUTRAL_RISK = { hist_pnls: [1, -1], kill_switch_engaged: false, circuit_breaker: { state: 'Closed' }, volatility: { window: [], baseline: null } };

  it('reads a valid V2 doc: integrity OK, risk exposed, orders reported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'risk.json'), stateV2(NEUTRAL_RISK));
    const report = readDurableState(join(dir, 'risk.json'));
    expect(report.format).toBe('V2');
    expect(report.integrity).toBe('OK');
    expect(report.version).toBe(2);
    expect(report.risk?.hist_pnls).toEqual([1, -1]);
  });

  it('detects a tampered V2 doc (checksum mismatch) and refuses to bless the risk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    const doc = JSON.parse(stateV2(NEUTRAL_RISK)) as { risk: Record<string, unknown> };
    (doc.risk as Record<string, unknown>).hist_pnls = [999]; // falsification silencieuse
    writeFileSync(join(dir, 'risk.json'), JSON.stringify(doc));
    const report = readDurableState(join(dir, 'risk.json'));
    expect(report.integrity).toBe('CORRUPT');
    expect(report.risk).toBeNull(); // falsifié ⇒ ne fait pas autorité
    expect(report.notes.some((n) => n.includes('checksum mismatch'))).toBe(true);
  });

  it('flags legacy V1 and missing as distinct, honest formats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'risk.json'), JSON.stringify({ hist_pnls: [1], circuit_breaker: { state: 'Closed' } }));
    expect(readDurableState(join(dir, 'risk.json')).format).toBe('LEGACY_V1');
    expect(readDurableState(join(dir, 'absent.json')).format).toBe('MISSING');
  });

  it('renders the durability panel and reconciliation notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ root: 'pallas', entries: [] }));
    writeFileSync(join(dir, 'risk.json'), stateV2(NEUTRAL_RISK, [{
      correlationId: '11111111-2222-4333-8444-555555555555',
      market_id: '1234567890', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1,
      intent_hash: 'a'.repeat(64), status: 'SUBMITTING', attempt: 1, order_id: null,
      created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z',
    }]));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.durability.format).toBe('V2');
    expect(snapshot.durability.integrity).toBe('OK');
    const html = renderDashboard(snapshot);
    expect(html).toContain('DURABILITY · STATE');
    expect(html).toContain('SUBMITTING');
    expect(html).toContain('11111111…5555');
    expect(html).toContain('reconciliation required');
  });

  it('PALLAS-M14: compte emprendes vives (LIVE ORDERS / RECONCILING) et badge kill switch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    const engagedRisk = { ...NEUTRAL_RISK, kill_switch_engaged: true };
    const orders = [
      { correlationId: '11111111-2222-4333-8444-555555555555', market_id: 'm1', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1, intent_hash: 'a'.repeat(64), status: 'RECONCILING', order_id: null, attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
      { correlationId: '22222222-3333-4444-8555-666666666666', market_id: 'm2', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1, intent_hash: 'b'.repeat(64), status: 'ACKED', order_id: 'o-2', attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
      { correlationId: '33333333-4444-4555-8666-777777777777', market_id: 'm3', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1, intent_hash: 'c'.repeat(64), status: 'TERMINAL', terminal_reason: 'cancelled', order_id: 'o-3', attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
    ];
    writeFileSync(join(dir, 'risk.json'), stateV2(engagedRisk, orders));
    const report = readDurableState(join(dir, 'risk.json'));
    expect(report.liveOrders).toBe(2); // RECONCILING + ACKED-sans-terminal ; TERMINAL exclu
    expect(report.reconcilingOrders).toBe(1);
    expect(report.killSwitchEngaged).toBe(true);
    expect(report.notes.some((n) => n.includes('kill switch ENGAGED'))).toBe(true);
  });

  it('PALLAS-M15: manifeste l exposition reelle (LIVE EXPOSURE USD) et le rendu', async () => {
    // L'exposition cumulée des ordres vivants (positions + ordres ouverts) est
    // la donnée que POSITION_LIMIT compare à la limite de portefeuille (M15).
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ root: 'pallas', entries: [] }));
    const orders = [
      { correlationId: '11111111-2222-4333-8444-555555555555', market_id: 'm1', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 250, intent_hash: 'a'.repeat(64), status: 'ACKED', order_id: 'o-1', attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
      { correlationId: '22222222-3333-4444-8555-666666666666', market_id: 'm2', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 150, intent_hash: 'b'.repeat(64), status: 'SUBMITTING', order_id: null, attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
      { correlationId: '33333333-4444-4555-8666-777777777777', market_id: 'm3', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 900, intent_hash: 'c'.repeat(64), status: 'TERMINAL', terminal_reason: 'cancelled', order_id: 'o-3', attempt: 1, created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' },
    ];
    writeFileSync(join(dir, 'risk.json'), stateV2(NEUTRAL_RISK, orders));
    const report = readDurableState(join(dir, 'risk.json'));
    expect(report.liveExposureUsd).toBe(400); // 250 + 150 ; le terminal annulé (900) est exclu
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.risk.liveExposureUsd).toBe(400);
    expect(renderDashboard(snapshot)).toContain('LIVE EXPOSURE USD');
  });
});
