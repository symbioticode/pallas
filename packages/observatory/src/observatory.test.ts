import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDashboard } from './render.js';
import { buildSnapshot, redactSecrets } from './snapshot.js';
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

  it('renders NO CYCLE RECORDED when no cycle exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-observatory-'));
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ root: 'pallas', entries: [] }));
    const snapshot = await buildSnapshot({ rootDir: dir, ledgerPath: join(dir, 'ledger.json'), riskStatePath: join(dir, 'missing-risk.json'), fetcher: noNetwork, commit: null });
    expect(snapshot.cycle.status).toBe('NONE');
    expect(renderDashboard(snapshot)).toContain('NO CYCLE RECORDED');
  });
});
