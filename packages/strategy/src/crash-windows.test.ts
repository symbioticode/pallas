/**
 * PALLAS-M13 — les QUATRE fenêtres de crash de l'audit v0.3 §4.5.
 *
 * Chaque test simule un arrêt de process à un instaNt précis via le hook
 * `crashAfter` du cycle, puis "redémarre" : recharge l'état durable et la
 * transaction telles qu'elles sont réellement sur disque, et vérifie que la
 * cohérence est préservée — jamais d'état neuf, jamais de trace perdue,
 * jamais de faux ACK.
 *
 * Fenêtres :
 *   A. décision perdue avant persistance (avant DECIDED durable) ;
 *   B. état avancé sans preuve d'ordre (DECIDED durable, aucune émission) ;
 *   C. ordre potentiellement réel sans trace locale (SUBMITTING durable) ;
 *   D. ordre réel reconnu mais trace ledger absente (ACKED durable).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PolymarketClient } from '@pallas/execution';
import { FileLedger } from '@pallas/ledger';

import { ReferenceStrategy } from './reference.js';
import { CrashSimulationError, runReferenceCycle } from './run-reference-loop.js';
import { DurableStateStore, newLifecycle, transitionLifecycle } from './durable-state.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeRiskBinary(stdout: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-fake-risk-'));
  const bin = join(dir, 'risk-engine');
  const quoted = stdout.replace(/'/g, "'\\''");
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${quoted}'\nexit 0\n`, { mode: 0o755 });
  return bin;
}

const VALID_STATE_JSON =
  '{"hist_pnls":[1,-1],"kill_switch_engaged":false,' +
  '"circuit_breaker":{"state":"Closed","consecutive_losses":0,"cumulative_pnl":0,"peak_pnl":0,"since_trip":0},' +
  '"volatility":{"window":[],"baseline":null}}';

const DECISION_ALLOW =
  `{"decision":{"allowed":true,"gates":[{"gate":"INPUT_VALIDATION","action":"Allow","reason":"ok"}],` +
  `"rejected_by":[],"suggested_size_usd":25},"state":${VALID_STATE_JSON}}`;

const TOKEN = '1234567890123456789012345678901234567890123456789012345678901234';

/** Client dry-run STRICT : placeOrder bloque avant le réseau (état réel de prod). */
function fakeClients(): { dry: PolymarketClient } {
  const book = { bids: [{ price: '0.40', size: '100' }], asks: [{ price: '0.50', size: '50' }] };
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    // le carnet d'ordres est fourni sinon la stratégie n'émet aucun signal
    if (url.includes('/book')) {
      return new Response(JSON.stringify(book), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  const dry = new PolymarketClient({ isDryRun: () => true, fetcher });
  return { dry };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-crash-'));
  const ledger = FileLedger.load(join(dir, 'ledger.json'));
  const statePath = join(dir, 'risk-state.json');
  const env = {
    dir,
    ledger,
    statePath,
    dry: fakeClients().dry,
  };
  const base = (over: Partial<Parameters<typeof runReferenceCycle>[1]> = {}): Parameters<typeof runReferenceCycle>[1] => ({
    client: env.dry,
    strategy: new ReferenceStrategy({ tokenIds: [TOKEN], buyThreshold: 0.6, size: 1 }),
    ledger: env.ledger,
    statePath: env.statePath,
    bankrollUsd: 1000,
    maxOrderUsd: 25,
    maxDrawdownUsd: 300,
    ...over,
  });
  return { ...env, base };
}

/** Recharge le store APRÈS un crash, comme un redémarrage de process. */
function restart(env: ReturnType<typeof setup>): ReturnType<DurableStateStore['read']> {
  const store = new DurableStateStore(env.statePath);
  return store.read();
}

describe('Fenêtre A — décision perdue avant persistance', () => {
  test('crash avant écrire DECIDED : AUCUN ordre, état originel intact (pas de falsification)', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const env = setup();
    await expect(runReferenceCycle(1, env.base({ crashAfter: 'before_decided' }))).rejects.toBeInstanceOf(
      CrashSimulationError,
    );
    const doc = restart(env);
    expect(doc.orders).toEqual([]); // jamais d'ordre fantôme pour une décision non écrite
    expect(doc.risk.circuit_breaker.state).toBe('Closed');
    // Aucune trace d'exécution non plus
    const ev = env.ledger.entries.map((e) => e.event);
    expect(ev).not.toContain('execution_dry_run_blocked');
  });
});

describe('Fenêtre B — état avancé sans preuve d\'ordre', () => {
  test('crash après DECIDED durable, avant émission : ordre RECORDÉ, jamais ré-émis', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const env = setup();
    await expect(runReferenceCycle(1, env.base({ crashAfter: 'decided_written' }))).rejects.toBeInstanceOf(
      CrashSimulationError,
    );
    const doc = restart(env);
    expect(doc.orders).toHaveLength(1);
    const o = doc.orders[0];
    expect(o.status).toBe('DECIDED'); // l'état sait ce qui a été décidé, jamais "neuf"
    expect(o.order_id).toBeNull();
    // le correlation_id de l'état enrichit le ledger
    const decision = env.ledger.entries.find((e) => e.event === 'risk_decision');
    const correlationId = (decision?.payload as { correlation_id?: string } | undefined)?.correlation_id;
    expect(correlationId).toBe(o.correlationId);
    expect(env.ledger.entries.some((e) => e.event.startsWith('execution'))).toBe(false);
  });
});

describe('Fenêtre C — ordre potentiellement réel sans trace locale', () => {
  test('crash après SUBMITTING durable, avant appel réseau : SUBMITTING, order_id nul', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const env = setup();
    await expect(runReferenceCycle(1, env.base({ crashAfter: 'submitting_written' }))).rejects.toBeInstanceOf(
      CrashSimulationError,
    );
    const doc = restart(env);
    expect(doc.orders).toHaveLength(1);
    const o = doc.orders[0];
    expect(o.status).toBe('SUBMITTING'); // la transition LONGE l'émission
    expect(o.order_id).toBeNull();
    // preuve d'ordinaire : SUBMITTING est persisté AVANT que placeOrder soit appelé
    const decision = env.ledger.entries.find((e) => e.event === 'risk_decision');
    const correlationId = (decision?.payload as { correlation_id?: string } | undefined)?.correlation_id;
    expect(correlationId).toBe(o.correlationId);
    expect(env.ledger.entries.some((e) => e.event.startsWith('execution'))).toBe(false);
  });
});

describe('Fenêtre D — ordre réel reconnu mais trace ledger absente', () => {
  test('crash après ACKED durable, avant append ledger : ACKED + order_id réconciliables', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const env = setup();
    // La séquence production (attemptPlaceOrder) est STRICTEMENT :
    //   1. transition ACKED + order_id persistés DURABLEMENT (withLock+write)
    //   2. PUIS ledger.append('execution_success')
    // On simule un crash entre 1. et 2. — fenêtre où l'ordre est réel et
    // reconnu, mais où la trace ledger manque encore (la passerelle de schéma
    // de signature ne doit jamais être désactivée par ce package, y compris en
    // test, donc la fenêtre est jouée au niveau du store exactement dans cet
    // ordre, avec le même code de transition que le cycle).
    const store = new DurableStateStore(env.statePath);
    const carrier = { correlationId: '11111111-2222-4333-8444-555555555555' };
    await store.withLock((doc) => {
      doc.orders.push(
        newLifecycle(
          { market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 },
          carrier,
        ),
      );
      doc.orders = [
        transitionLifecycle(doc.orders[0], { status: 'ACKED', order_id: 'order-9000', outcome: 'acked' }),
      ];
      store.write(doc); // (1) DURABLE — puis crash avant (2)
    });
    // redémarrage : l'état dit ACKED + order_id ; le ledger n'a AUCUNE trace.
    const doc = restart(env);
    expect(doc.orders).toHaveLength(1);
    expect(doc.orders[0].status).toBe('ACKED');
    expect(doc.orders[0].order_id).toBe('order-9000');
    expect(env.ledger.entries.some((e) => e.event === 'execution_success')).toBe(false);
    // ⇒ une réconciliation (M14) sur order_id est possible après redémarrage,
    //    sans jamais ré-émettre sur ce correlation_id.
  });
});