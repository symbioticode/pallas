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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  ErrorResponse,
  StateInput,
  TradeDecision,
  TradeRequest,
  VaRResult,
  ValidateResponse,
  VarResponse,
} from './types.js';

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

function locateBinary(): string {
  const envBin = process.env.PALLAS_RISK_BIN;
  if (envBin) {
    if (existsSync(envBin)) return envBin;
    throw new MissingBinaryError(envBin);
  }
  for (const p of candidatePaths()) {
    if (existsSync(p)) return p;
  }
  const first = candidatePaths().find((p) => p.includes('release')) ?? 'risk-engine';
  throw new MissingBinaryError(first);
}

async function invoke<T>(input: unknown): Promise<T> {
  const bin = locateBinary();

  const stdout = await runBinary(bin, JSON.stringify(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as T;
  } catch {
    throw new RiskEngineError(`risk-engine returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  const err = (parsed as ErrorResponse).error;
  if (err) {
    throw new RiskEngineError(`risk-engine: ${err}`);
  }

  return parsed as T;
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
export async function validateTrade(trade: TradeRequest, state: StateInput = { hist_pnls: [] }): Promise<TradeDecision> {
  const res = await invoke<ValidateResponse>({ command: 'validate', trade, state });
  return res.decision;
}

/** Calcule VaR/CVaR sur une serie de P&L historique. */
export async function calculateVaR(pnls: number[], confidence = 0.95): Promise<VaRResult> {
  const res = await invoke<VarResponse>({ command: 'var', pnls, confidence });
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
