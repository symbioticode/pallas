/**
 * Facade TS autour de la CLI Rust `risk-engine`.
 *
 * La logique de risque vit en Rust (surete memoire, testee a 100%). Ce module
 * appelle la binaire via `spawn` (array args, jamais `shell:true`) et lui
 * injecte l'entree via `stdin` (un contrat JSON stdin/stdout). `execFile`
 * ignore l'option `input` et pend : ne jamais l'utiliser. Si la binaire est
 * introuvable ou echoue, on THROW (fail-closed) — on ne renvoie jamais une
 * decision "allow" par defaut.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  RecordResponse,
  RiskConfig,
  StateInput,
  StateOutput,
  TradeDecision,
  TradeRequest,
  VaRResult,
  ValidateResponse,
  VarResponse,
} from './types.js';
import {
  ErrorResponseSchema,
  RecordResponseSchema,
  ValidateResponseSchema,
  VarResponseSchema,
} from './types.js';

import type { ZodType } from 'zod';

/** Erreur de contrat du risk engine : binaire manquante ou reponse invalide. */
export class RiskEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskEngineError';
  }
}

/** Erreur levee quand la binaire Rust est absente (fail-closed). */
export class MissingBinaryError extends RiskEngineError {
  constructor(binPath: string) {
    super(`risk-engine binary not found at: ${binPath}. Build it with: nix-shell --run "cd crates/risk-engine && cargo build --release"`);
    this.name = 'MissingBinaryError';
  }
}

function candidatePaths(): string[] {
  // Cherche la racine du depot (qui contient crates/risk-engine) en remontant.
  const dirs: string[] = [];
  const envBin = process.env.PALLAS_RISK_BIN;
  if (envBin) dirs.push(envBin);

  let cur = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const base = resolve(cur, 'crates', 'risk-engine', 'target');
    dirs.push(resolve(base, 'release', 'risk-engine'));
    dirs.push(resolve(base, 'debug', 'risk-engine'));
    const parent = resolve(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  return dirs;
}

/**
 * Même vérification que `packages/execution/src/sandbox.ts::isRegularExecutable`
 * (PALLAS-M10, durcissement `PALLAS_RISK_BIN`) : fichier REGULIER executable,
 * après résolution des liens symboliques. Duplication VOLONTAIRE (5 lignes) :
 * `@pallas/risk` ne dépend pas de `@pallas/execution` (qui charge zod+noble) —
 * mieux vaut cette copie commentée qu'une dépendance transverse. A garder
 * synchrone avec sandbox.ts.
 */
function isRegularExecutable(path: string): boolean {
  try {
    const real = realpathSync(path);
    const st = statSync(real); // stat, pas lstat : on valide la CIBLE reelle
    if (!st.isFile()) return false;
    accessSync(real, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function locateBinary(): string {
  const envBin = process.env.PALLAS_RISK_BIN;
  if (envBin) {
    if (isRegularExecutable(envBin)) return envBin;
    throw new MissingBinaryError(envBin);
  }
  for (const p of candidatePaths()) {
    if (isRegularExecutable(p)) return p;
  }
  const first = candidatePaths().find((p) => p.includes('release')) ?? 'risk-engine';
  throw new MissingBinaryError(first);
}

async function invoke(input: unknown, schema: ZodType<unknown>): Promise<unknown> {
  const bin = locateBinary();

  const stdout = await runBinary(bin, JSON.stringify(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RiskEngineError(`risk-engine returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  // Reponse d'erreur explicite de la CLI : `{ "error": "..." }`.
  const errResp = ErrorResponseSchema.safeParse(parsed);
  if (errResp.success) {
    throw new RiskEngineError(`risk-engine: ${errResp.data.error}`);
  }

  // PALLAS-M04 : plus aucun cast aveugle — le contrat est valide a l'execution.
  const ok = schema.safeParse(parsed);
  if (!ok.success) {
    const issues = ok.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .slice(0, 5)
      .join('; ');
    throw new RiskEngineError(`risk-engine returned a response that violates the CLI contract: ${issues}`);
  }
  return ok.data;
}

/** Lance la binaire avec `input` sur stdin, collecte stdout. Array args, jamais shell. */
function runBinary(bin: string, input: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        rejectPromise(new RiskEngineError(`risk-engine timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new RiskEngineError(`failed to launch ${bin}: ${err.message}`));
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new RiskEngineError(`risk-engine exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolvePromise(stdout);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Valide un trade contre le pipeline de risque complet (fail-closed). */
export async function validateTrade(
  trade: TradeRequest,
  state: StateInput = { hist_pnls: [] },
  config?: RiskConfig,
): Promise<TradeDecision> {
  const res = (await invoke(
    { command: 'validate', trade, state, ...(config !== undefined ? { config } : {}) },
    ValidateResponseSchema,
  )) as ValidateResponse;
  return res.decision;
}

/** Comme validateTrade, mais expose aussi l'etat persistant a stocker. */
export async function validateTradeWithState(
  trade: TradeRequest,
  state: StateInput = { hist_pnls: [] },
  config?: RiskConfig,
): Promise<ValidateResponse> {
  return (await invoke(
    { command: 'validate', trade, state, ...(config !== undefined ? { config } : {}) },
    ValidateResponseSchema,
  )) as ValidateResponse;
}

/**
 * Enregistre un P&L realise dans l'etat persistant (circuit breaker, volatilite)
 * et retourne l'etat mis a jour a persister par l'appelant pour le prochain appel.
 */
export async function recordPnl(state: StateInput, pnl: number): Promise<StateOutput> {
  const res = (await invoke({ command: 'record', state, pnl }, RecordResponseSchema)) as RecordResponse;
  return res.state;
}

/** Calcule VaR/CVaR sur une serie de P&L historique. */
export async function calculateVaR(pnls: number[], confidence = 0.95): Promise<VaRResult> {
  const res = (await invoke({ command: 'var', pnls, confidence }, VarResponseSchema)) as VarResponse;
  return res.var;
}

/** Le chemin absolu de la binaire Rust (si trouvee). */
export function binaryPath(): string | null {
  try {
    return locateBinary();
  } catch {
    return null;
  }
}
