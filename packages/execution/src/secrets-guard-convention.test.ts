/**
 * PALLAS-M28 - convention de garde des secrets (revue de code automatisee).
 *
 * Objectif (audit v0.4 F-09) : la garde de permissions existe depuis M19 mais
 * elle etait OPTIONNELLE et aucun consommateur ne l utilisait. Ce test ECHOUE si
 * un nouveau point de chargement de secret apparait SANS passer par la garde.
 *
 * Regles verifiees :
 *  1. "decryptPolymarketSecrets" n est reference que par le module garde
 *     (polymarketSecrets.ts) : tout autre fichier de PRODUCTION qui l importe est
 *     un contournement de la garde de permissions.
 *  2. "PALLAS_POLYMARKET_VAULT" (acces direct au ciphertext) n apparait que dans
 *     ce meme module.
 *  3. le chargeur fichier applique la garde AVANT la lecture (ordre verifie).
 *  4. etat actuel documente : le SEUL fichier de production referencant
 *     "loadPolymarketSecrets" est le module garde (aucun chemin live ne charge
 *     encore de secrets - absence explicite, pas implicite).
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const GUARDED_REL = join("packages", "execution", "src", "polymarketSecrets.ts");
const GUARDED = join(REPO, GUARDED_REL);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function productionTsFiles(): string[] {
  return walk(join(REPO, "packages")).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );
}

describe("PALLAS-M28 - garde des secrets : aucun contournement", () => {
  test("decryptPolymarketSecrets et PALLAS_POLYMARKET_VAULT restent confines au module garde", () => {
    const offenders: string[] = [];
    for (const f of productionTsFiles()) {
      if (f === GUARDED) continue;
      const body = readFileSync(f, "utf8");
      if (body.includes("decryptPolymarketSecrets")) offenders.push(relative(REPO, f) + " -> decryptPolymarketSecrets");
      if (body.includes("PALLAS_POLYMARKET_VAULT")) offenders.push(relative(REPO, f) + " -> PALLAS_POLYMARKET_VAULT");
    }
    expect(offenders).toEqual([]);
  });

  test("loadPolymarketSecrets n est appele que par le module garde (aucun chemin live ne charge encore de secrets)", () => {
    const callers = productionTsFiles()
      .filter((f) => readFileSync(f, "utf8").includes("loadPolymarketSecrets"))
      .map((f) => relative(REPO, f))
      .sort();
    expect(callers).toEqual([relative(REPO, GUARDED)]);
  });

  test("le chargeur fichier applique la garde de permissions AVANT la lecture", () => {
    const body = readFileSync(GUARDED, "utf8");
    const fn = body.slice(body.indexOf("export async function loadPolymarketSecretsFromFile"));
    const permIdx = fn.indexOf("await assertFilePermissions");
    const readIdx = fn.indexOf("readFile(");
    expect(permIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(permIdx).toBeLessThan(readIdx);
  });
});
