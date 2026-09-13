/**
 * PALLAS-M29 / R-03 — provenance de la chaîne d'audits.
 *
 * PALLAS-M21 a versionné les rapports d'audit pour confronter chaque verdict à
 * l'arbre exact qu'il a jugé (docs/SECURITY.md). Un identifiant de commit
 * MALFORMÉ (ni 40 ni 64 hex) casse cette garantie. Ce test échoue si un rapport
 * d'audit porte un token hexadécimal « commit-like » de longueur invalide
 * (41 à 63 caractères), exactement le défaut relevé sur AUDIT-PALLAS-v0.5.md.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const DOCS = join(REPO, "docs");

describe("PALLAS-M29/R-03 — provenance des audits", () => {
  test("aucun rapport d'audit ne porte de hash de commit malformé (41-63 hex)", () => {
    const files = readdirSync(DOCS).filter((f) => /^AUDIT-PALLAS-v.*\.md$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(join(DOCS, file), "utf8");
      for (const m of body.matchAll(/`([0-9a-fA-F]{41,63})`/g)) {
        offenders.push(file + " -> " + m[1] + " (" + m[1].length + " hex)");
      }
    }
    expect(offenders).toEqual([]);
  });
});
