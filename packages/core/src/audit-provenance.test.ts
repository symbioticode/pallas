/**
 * PALLAS-M29 / R-03 — provenance de la chaîne d'audits.
 *
 * Un rapport d'audit est versionné (M21) pour confronter chaque verdict à
 * l'arbre exact qu'il a jugé. Un identifiant de commit MALFORMÉ casse cette
 * garantie.
 *
 * Portée VOLONTAIREMENT RESTREINTE : on ne valide que les lignes qui
 * **DÉCLARENT** un commit (mot « commit » suivi de « : »). Un addendum peut
 * légitimement CITER une valeur erronée dans son corps (ex. v0.5.1 cite le hash
 * de 42 caractères pour documenter la correction) : ce n'est pas une nouvelle
 * déclaration de provenance et cela ne doit PAS faire échouer la garde.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const DOCS = join(REPO, "docs");

/** Complet (40/64 hex) ou abréviation usuelle (7-12). 13-39 et 41-63 = malformé. */
function isPlausibleCommitHex(tok: string): boolean {
  const n = tok.length;
  return (n >= 7 && n <= 12) || n === 40 || n === 64;
}

describe("PALLAS-M29/R-03 — provenance des audits", () => {
  test("les lignes de DÉCLARATION de commit portent un hash plausible (jamais 41-63 hex)", () => {
    const files = readdirSync(DOCS).filter((f) => /^AUDIT-PALLAS-v.*\.md$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    let declarations = 0;
    for (const file of files) {
      for (const line of readFileSync(join(DOCS, file), "utf8").split("\n")) {
        // Déclaration seulement : « commit » suivi de « : » sur la même ligne.
        if (!/[Cc]ommit[^:]*:/.test(line)) continue;
        for (const m of line.matchAll(/`([0-9a-fA-F]{5,})`/g)) {
          const tok = m[1]!;
          declarations += 1;
          if (!isPlausibleCommitHex(tok)) offenders.push(file + " -> " + tok + " (" + tok.length + " hex)");
        }
      }
    }
    expect(declarations).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});