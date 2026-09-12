import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    // PALLAS-M17 : mode test explicite — active les injections test-only
    // (isDryRun de PolymarketClient). Non documenté en usage production.
    env: { PALLAS_TEST_MODE: '1' },
    // PALLAS-M20 : couverture V8 (provider ajouté en devDependencies).
    // Seuils calibrés sous la mesure réelle du 2026-09-11 (statements 83.76,
    // branches 79.72, functions 91.63, lines 83.76) — en CI, une régression
    // significative de couverture fait échouer le job. Seuils modestes mais
    // réels : un échec lance l'alerte, jamais un seuil fantaisiste.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80,
      },
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/dist/**',
        'scripts/**',
      ],
    },
  },
});
