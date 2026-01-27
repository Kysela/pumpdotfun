// =========================================================
// CONFIGURATION — PUMP.FUN SIGNAL DETECTION
// =========================================================

import { SystemConfig } from '../types';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Pump.fun program ID on Solana
 */
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/**
 * Solana RPC endpoints
 */
export const RPC_CONFIG = {
  httpEndpoint: process.env.SOLANA_RPC_HTTP || 'https://api.mainnet-beta.solana.com',
  wsEndpoint: process.env.SOLANA_RPC_WS || 'wss://api.mainnet-beta.solana.com',
};

/**
 * Logging configuration
 */
export const LOG_CONFIG = {
  level: process.env.LOG_LEVEL || 'info',
  dir: process.env.LOG_DIR || './logs',
};

/**
 * System configuration following the rules specification
 */
export const CONFIG: SystemConfig = {
  // Token lifecycle: track only first 20 minutes
  maxTokenAgeMinutes: 20,
  minBuyersAfter5Min: 2,

  // Rolling windows in milliseconds
  windows: {
    short: 30 * 1000,    // 30 seconds
    medium: 60 * 1000,   // 60 seconds
    long: 180 * 1000,    // 180 seconds (3 minutes)
    buyers: 5 * 60 * 1000, // 5 minutes
  },

  // Hard filters - FAIL = DROP TOKEN
  filters: {
    maxLargestBuy: 2.0,      // SOL - drop if largest_buy > 2
    maxAvgBuySize: 0.8,      // SOL - drop if avg > 0.8
    minAvgBuySize: 0.03,     // SOL - drop if avg < 0.03
    maxDevBuys: 1,           // drop if dev buys more than once
    maxMetadataEdits: 1,     // drop if metadata edited more than once
  },

  // Signal thresholds
  signals: {
    // Early Attention Signal (EAS)
    minBuyers5m: 6,          // buyers_5m >= 6
    maxTxIntervalMean: 20,   // tx_interval_mean < 20s

    // Liquidity Shape Filter (LSF)
    minAvgBuySize: 0.05,     // avg between 0.05-0.5
    maxAvgBuySize: 0.5,
    maxLargestBuy: 2.0,      // largest_buy <= 2 SOL

    // Momentum Confirmation (MC)
    minTxCount60s: 5,        // tx_count_60s >= 5
  },

  // Paper entry rules
  entry: {
    minScore: 18,            // score >= 18
    minTokenAgeMinutes: 2,   // token age between 2-12 minutes
    maxTokenAgeMinutes: 12,
    minMarketCapSOL: 3000,   // estimated MC 3k-15k (in USD, roughly)
    maxMarketCapSOL: 15000,
    positionSizeSOL: 1.0,    // virtual position size
  },

  // Exit rules (NON-NEGOTIABLE)
  exit: {
    partialProfitPercent: 120,  // +120% = partial exit
    fullProfitPercent: 220,     // +220% = full exit
    partialExitPercent: 50,     // sell 50% on partial
    noActivitySeconds: 60,       // no tx for 60s
    txDecreaseThreshold: 2,      // tx decreases twice consecutively
  },

  // Kill switch
  killSwitch: {
    noTxSeconds: 60,          // zero tx for 60 seconds
    whaleBuyThreshold: 3.0,   // sudden large buy > 3 SOL
  },

  // Scoring model
  scoring: {
    buyersWeight: 2,          // buyers_5m * 2
    accelerationWeight: 3,    // tx_acceleration * 3
    repeatBuyersWeight: 2,    // repeat_buyers * 2
    largestBuyPenalty: 5,     // -5 if largest_buy > 1 SOL
    stagnationPenalty: 10,    // -10 if tx_count_60s == 0
    recalcIntervalMs: 10000,  // recalculate every 10 seconds
  },
};

/**
 * Validate configuration at startup
 */
export function validateConfig(): void {
  const errors: string[] = [];

  if (CONFIG.maxTokenAgeMinutes <= 0) {
    errors.push('maxTokenAgeMinutes must be positive');
  }

  if (CONFIG.entry.minScore <= 0) {
    errors.push('entry.minScore must be positive');
  }

  if (CONFIG.entry.minTokenAgeMinutes >= CONFIG.entry.maxTokenAgeMinutes) {
    errors.push('entry.minTokenAgeMinutes must be less than maxTokenAgeMinutes');
  }

  if (CONFIG.exit.partialProfitPercent >= CONFIG.exit.fullProfitPercent) {
    errors.push('exit.partialProfitPercent must be less than fullProfitPercent');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
