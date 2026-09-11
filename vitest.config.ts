import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    // PALLAS-M17 : mode test explicite — active les injections test-only
    // (isDryRun de PolymarketClient). Non documenté en usage production.
    env: { PALLAS_TEST_MODE: '1' },
  },
});
