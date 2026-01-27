// =========================================================
// TYPE DEFINITIONS — PUMP.FUN SIGNAL DETECTION
// =========================================================

/**
 * Raw transaction data captured from Solana WebSocket
 */
export interface Transaction {
  tokenAddress: string;
  timestamp: number; // Unix ms
  buyerWallet: string;
  solAmount: number;
  txHash: string;
}

/**
 * Token state tracked during its lifecycle
 */
export interface TokenState {
  tokenAddress: string;
  firstSeenTimestamp: number;
  lastTxTimestamp: number;
  transactions: Transaction[];
  uniqueBuyers: Set<string>;
  dropped: boolean;
  dropReason?: string;
  metadataEditCount: number;
  devWallet?: string;
  devBuyCount: number;
}

/**
 * Rolling window metrics for a token
 */
export interface RollingMetrics {
  // Time windows
  txCount30s: number;
  txCount60s: number;
  txCount180s: number;
  txCountPrev60s: number;
  
  // Buyer metrics
  buyers5m: number;
  repeatBuyers: number;
  
  // Buy size metrics
  avgBuySize: number;
  buySizeStd: number;
  largestBuy: number;
  
  // Transaction interval metrics
  txIntervalMean: number;
  txIntervalDelta: boolean; // current interval < previous interval
  
  // Derived metrics
  txAcceleration: number; // txCount60s - txCountPrev60s
}

/**
 * Signal conditions evaluation result
 */
export interface SignalEvaluation {
  // Early Attention Signal (EAS)
  easPassed: boolean;
  easDetails: {
    buyers5m: number;
    txIntervalMean: number;
    txAcceleration: number;
  };
  
  // Liquidity Shape Filter (LSF)
  lsfPassed: boolean;
  lsfDetails: {
    avgBuySize: number;
    buySizeStd: number;
    largestBuy: number;
  };
  
  // Momentum Confirmation (MC)
  mcPassed: boolean;
  mcDetails: {
    txCount60s: number;
    txIntervalDelta: boolean;
  };
  
  // Overall
  allPassed: boolean;
}

/**
 * Token score calculation result
 */
export interface TokenScore {
  tokenAddress: string;
  score: number;
  timestamp: number;
  breakdown: {
    buyersComponent: number;
    accelerationComponent: number;
    repeatBuyersComponent: number;
    largestBuyPenalty: number;
    stagnationPenalty: number;
  };
}

/**
 * Paper trading position
 */
export interface PaperPosition {
  id: string;
  tokenAddress: string;
  entryTimestamp: number;
  entryPrice: number;
  entryScore: number;
  positionSizeSOL: number;
  remainingSizeSOL: number;
  status: 'open' | 'partial' | 'closed';
  partialExitTimestamp?: number;
  partialExitPrice?: number;
  exitTimestamp?: number;
  exitPrice?: number;
  exitReason?: ExitReason;
  maxUnrealizedPnL: number;
  realizedPnL: number;
}

/**
 * Exit reasons for paper positions
 */
export type ExitReason =
  | 'profit_target_partial' // +120% partial exit
  | 'profit_target_full'    // +220% full exit
  | 'no_activity_60s'       // No tx for 60 seconds
  | 'tx_decrease_twice'     // tx_count_60s decreases twice
  | 'stagnation_after_spike'// First stagnation after spike
  | 'kill_switch_no_tx'     // Kill switch: zero tx 60s
  | 'kill_switch_whale'     // Kill switch: large buy > 3 SOL
  | 'kill_switch_dev';      // Kill switch: dev wallet activity

/**
 * Filter evaluation result
 */
export interface FilterResult {
  passed: boolean;
  reason?: string;
  details: {
    largestBuy: number;
    avgBuySize: number;
    buySizeStd: number;
    devBuyCount: number;
    metadataEditCount: number;
  };
}

/**
 * Trade log entry for JSONL output
 */
export interface TradeLog {
  tokenAddress: string;
  entryTime: number;
  entryScore: number;
  entryPrice: number;
  exitTime?: number;
  exitReason?: ExitReason;
  maxUnrealizedPnL: number;
  realizedPnL: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRMultiple: number;
  avgTimeInTrade: number; // ms
  killSwitchExits: number;
  killSwitchPercentage: number;
  missedRunners: number;
  totalPnL: number;
  maxDrawdown: number;
}

/**
 * Configuration for the system
 */
export interface SystemConfig {
  // Lifecycle
  maxTokenAgeMinutes: number;
  minBuyersAfter5Min: number;
  
  // Rolling windows
  windows: {
    short: number;   // 30s
    medium: number;  // 60s
    long: number;    // 180s
    buyers: number;  // 5min
  };
  
  // Hard filters
  filters: {
    maxLargestBuy: number;
    maxAvgBuySize: number;
    minAvgBuySize: number;
    maxDevBuys: number;
    maxMetadataEdits: number;
  };
  
  // Signal thresholds
  signals: {
    minBuyers5m: number;
    maxTxIntervalMean: number;
    minTxCount60s: number;
    minAvgBuySize: number;
    maxAvgBuySize: number;
    maxLargestBuy: number;
  };
  
  // Entry conditions
  entry: {
    minScore: number;
    minTokenAgeMinutes: number;
    maxTokenAgeMinutes: number;
    minMarketCapSOL: number;
    maxMarketCapSOL: number;
    positionSizeSOL: number;
  };
  
  // Exit conditions
  exit: {
    partialProfitPercent: number;  // 120%
    fullProfitPercent: number;     // 220%
    partialExitPercent: number;    // 50%
    noActivitySeconds: number;     // 60s
    txDecreaseThreshold: number;   // 2 consecutive
  };
  
  // Kill switch
  killSwitch: {
    noTxSeconds: number;           // 60s
    whaleBuyThreshold: number;     // 3 SOL
  };
  
  // Scoring
  scoring: {
    buyersWeight: number;
    accelerationWeight: number;
    repeatBuyersWeight: number;
    largestBuyPenalty: number;
    stagnationPenalty: number;
    recalcIntervalMs: number;
  };
}

/**
 * WebSocket message types
 */
export interface WSLogSubscription {
  jsonrpc: '2.0';
  id: number;
  method: 'logsSubscribe';
  params: [
    { mentions: string[] },
    { commitment: 'confirmed' | 'finalized' }
  ];
}

export interface WSLogNotification {
  jsonrpc: '2.0';
  method: 'logsNotification';
  params: {
    result: {
      context: { slot: number };
      value: {
        signature: string;
        err: null | object;
        logs: string[];
      };
    };
    subscription: number;
  };
}

/**
 * Event emitter types
 */
export type EventType =
  | 'transaction'
  | 'token_new'
  | 'token_dropped'
  | 'signal_detected'
  | 'score_update'
  | 'position_opened'
  | 'position_partial_exit'
  | 'position_closed'
  | 'kill_switch_triggered';

export interface SystemEvent {
  type: EventType;
  timestamp: number;
  data: unknown;
}
