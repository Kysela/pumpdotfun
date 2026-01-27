// =========================================================
// HARD FILTERS — DROP TOKEN CONDITIONS
// =========================================================

import { RollingMetrics, FilterResult } from '../types';
import { CONFIG } from '../config';
import { TokenTracker } from './tokenTracker';

/**
 * Evaluate hard filters for a token.
 * If any filter fails, the token should be DROPPED immediately.
 * 
 * Drop conditions (from rules):
 * - largest_buy > 2 SOL
 * - avg_buy_size > 0.8 SOL
 * - avg_buy_size < 0.03 SOL
 * - buy_size_std high (whale noise) - we define "high" as > 0.5 SOL
 * - dev wallet buys more than once
 * - metadata edited more than once
 */
export function evaluateFilters(
  tracker: TokenTracker,
  metrics: RollingMetrics
): FilterResult {
  const filters = CONFIG.filters;
  const reasons: string[] = [];

  // Check largest buy
  if (metrics.largestBuy > filters.maxLargestBuy) {
    reasons.push(`largest_buy (${metrics.largestBuy.toFixed(3)} SOL) > ${filters.maxLargestBuy} SOL`);
  }

  // Check average buy size (too high)
  if (metrics.avgBuySize > filters.maxAvgBuySize) {
    reasons.push(`avg_buy_size (${metrics.avgBuySize.toFixed(3)} SOL) > ${filters.maxAvgBuySize} SOL`);
  }

  // Check average buy size (too low)
  if (metrics.avgBuySize > 0 && metrics.avgBuySize < filters.minAvgBuySize) {
    reasons.push(`avg_buy_size (${metrics.avgBuySize.toFixed(3)} SOL) < ${filters.minAvgBuySize} SOL`);
  }

  // Check buy size standard deviation (whale noise indicator)
  // High std relative to avg indicates whale activity
  const stdThreshold = 0.5; // Configurable threshold for "high" std
  if (metrics.buySizeStd > stdThreshold) {
    reasons.push(`buy_size_std (${metrics.buySizeStd.toFixed(3)}) indicates whale noise`);
  }

  // Check dev wallet buy count
  if (tracker.devBuyCount > filters.maxDevBuys) {
    reasons.push(`dev wallet bought ${tracker.devBuyCount} times (max: ${filters.maxDevBuys})`);
  }

  // Check metadata edit count
  if (tracker.metadataEditCount > filters.maxMetadataEdits) {
    reasons.push(`metadata edited ${tracker.metadataEditCount} times (max: ${filters.maxMetadataEdits})`);
  }

  const passed = reasons.length === 0;

  return {
    passed,
    reason: passed ? undefined : reasons.join('; '),
    details: {
      largestBuy: metrics.largestBuy,
      avgBuySize: metrics.avgBuySize,
      buySizeStd: metrics.buySizeStd,
      devBuyCount: tracker.devBuyCount,
      metadataEditCount: tracker.metadataEditCount,
    },
  };
}

/**
 * Quick check for immediate drop conditions on a single transaction.
 * Used to quickly filter out obvious bad actors.
 */
export function quickFilterTransaction(solAmount: number): { pass: boolean; reason?: string } {
  // Immediate drop if single buy > max largest buy
  if (solAmount > CONFIG.filters.maxLargestBuy) {
    return { 
      pass: false, 
      reason: `single_buy_too_large: ${solAmount.toFixed(3)} SOL` 
    };
  }

  return { pass: true };
}

/**
 * Check if buy size standard deviation indicates whale activity.
 * A high coefficient of variation (std/mean) suggests irregular buying patterns.
 */
export function isWhaleNoise(avgBuySize: number, buySizeStd: number): boolean {
  if (avgBuySize === 0) return false;
  
  // Coefficient of variation > 1.5 indicates high variability
  const cv = buySizeStd / avgBuySize;
  return cv > 1.5;
}
