export type DataStatus = 'available' | 'unavailable' | 'invalid';

export interface ObservatoryRecord {
  index: number;
  event: string;
  timestamp: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}

export interface ObservatorySnapshot {
  generatedAt: string;
  system: {
    name: 'PALLAS';
    version: string;
    commit: string | null;
    mode: 'DRY RUN';
    ledger: 'VALID' | 'INVALID' | 'EMPTY';
    ledgerEntries: number;
    lastEventAt: string | null;
    loop: 'RUNNING' | 'STOPPED' | 'STALE' | 'UNKNOWN';
    loopAgeSeconds: number | null;
  };
  durability: {
    format: 'V2' | 'LEGACY_V1' | 'MISSING' | 'CORRUPT';
    integrity: 'OK' | 'CORRUPT' | 'N/A';
    version: number | null;
    orders: Array<{
      correlationId: string;
      status: string;
      orderId: string | null;
      outcome: string | null;
      marketId: string;
      side: string;
    }>;
    orderCount: number;
    /** Ordres dont l'empreinte est(vive) chez l'exchange (PALLAS-M14). */
    liveOrders: number;
    /** Ordres en cours de réconciliation (PALLAS-M14). */
    reconcilingOrders: number;
    killSwitchEngaged: boolean | null;
    notes: string[];
  };
  market: {
    status: 'OK' | 'UNKNOWN' | 'STALE';
    tokenId: string | null;
    question: string | null;
    outcome: string | null;
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spread: number | null;
    timestamp: string | null;
    error?: string;
  };
  strategy: {
    name: 'ReferenceStrategy';
    disclaimer: 'REFERENCE STRATEGY — NON PREDICTIVE';
    signal: 'BUY' | 'NO SIGNAL' | 'NO SIGNAL YET';
    threshold: number | null;
    requestedSize: number | null;
    observedPrice: number | null;
    demoOverride: boolean;
    history: Array<{
      timestamp: string;
      price: number;
      threshold: number | null;
      risk: 'ALLOW' | 'REJECT' | 'UNAVAILABLE';
    }>;
  };
  risk: {
    status: 'ALLOW' | 'REJECT' | 'UNAVAILABLE';
    rejectedBy: string[];
    suggestedSizeUsd: number | null;
    gates: Array<{ gate: string; action: string; reason: string }>;
    circuitBreaker: unknown | null;
    killSwitchEngaged: boolean | null;
    pnlSampleSize: number | null;
    /** Exposition US (positions + ordres ouverts) manifestée par M15. */
    liveExposureUsd: number | null;
  };
  cycle: { status: 'RECORDED' | 'NONE'; execution: string | null };
  activity: ObservatoryRecord[];
  warnings: string[];
}
