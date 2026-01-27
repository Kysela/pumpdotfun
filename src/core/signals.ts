// =========================================================
// SIGNAL CONDITIONS — EAS, LSF, MC
// =========================================================

import { RollingMetrics, SignalEvaluation } from '../types';
import { CONFIG } from '../config';

/**
 * Evaluate all signal conditions for a token.
 * All three conditions (EAS, LSF, MC) must pass to generate a signal.
 * 
 * Signal Conditions:
 * 
 * A) Early Attention Signal (EAS):
 *    - buyers_5m >= 6
 *    - tx_interval_mean < 20s
 *    - tx_acceleration > 0
 * 
 * B) Liquidity Shape Filter (LSF):
 *    - avg_buy_size between 0.05-0.5 SOL
 *    - buy_size_std LOW (we use < 0.3 as threshold)
 *    - largest_buy <= 2 SOL
 * 
 * C) Momentum Confirmation (MC):
 *    - tx_count_60s >= 5
 *    - tx_interval_delta == TRUE (current interval < previous)
 */
export function evaluateSignals(metrics: RollingMetrics): SignalEvaluation {
  const signals = CONFIG.signals;

  // Early Attention Signal (EAS)
  const easBuyers = metrics.buyers5m >= signals.minBuyers5m;
  const easInterval = metrics.txIntervalMean < signals.maxTxIntervalMean;
  const easAcceleration = metrics.txAcceleration > 0;
  const easPassed = easBuyers && easInterval && easAcceleration;

  // Liquidity Shape Filter (LSF)
  const lsfAvgMin = metrics.avgBuySize >= signals.minAvgBuySize;
  const lsfAvgMax = metrics.avgBuySize <= signals.maxAvgBuySize;
  const lsfStd = metrics.buySizeStd < 0.3; // "LOW" threshold
  const lsfLargest = metrics.largestBuy <= signals.maxLargestBuy;
  const lsfPassed = lsfAvgMin && lsfAvgMax && lsfStd && lsfLargest;

  // Momentum Confirmation (MC)
  const mcTxCount = metrics.txCount60s >= signals.minTxCount60s;
  const mcIntervalDelta = metrics.txIntervalDelta;
  const mcPassed = mcTxCount && mcIntervalDelta;

  // All must pass
  const allPassed = easPassed && lsfPassed && mcPassed;

  return {
    easPassed,
    easDetails: {
      buyers5m: metrics.buyers5m,
      txIntervalMean: metrics.txIntervalMean,
      txAcceleration: metrics.txAcceleration,
    },
    lsfPassed,
    lsfDetails: {
      avgBuySize: metrics.avgBuySize,
      buySizeStd: metrics.buySizeStd,
      largestBuy: metrics.largestBuy,
    },
    mcPassed,
    mcDetails: {
      txCount60s: metrics.txCount60s,
      txIntervalDelta: metrics.txIntervalDelta,
    },
    allPassed,
  };
}

/**
 * Get a human-readable summary of why signals failed
 */
export function getSignalFailureReasons(
  evaluation: SignalEvaluation,
  metrics: RollingMetrics
): string[] {
  const reasons: string[] = [];
  const signals = CONFIG.signals;

  if (!evaluation.easPassed) {
    if (metrics.buyers5m < signals.minBuyers5m) {
      reasons.push(`EAS: buyers_5m (${metrics.buyers5m}) < ${signals.minBuyers5m}`);
    }
    if (metrics.txIntervalMean >= signals.maxTxIntervalMean) {
      reasons.push(`EAS: tx_interval_mean (${metrics.txIntervalMean.toFixed(1)}s) >= ${signals.maxTxIntervalMean}s`);
    }
    if (metrics.txAcceleration <= 0) {
      reasons.push(`EAS: tx_acceleration (${metrics.txAcceleration}) <= 0`);
    }
  }

  if (!evaluation.lsfPassed) {
    if (metrics.avgBuySize < signals.minAvgBuySize) {
      reasons.push(`LSF: avg_buy_size (${metrics.avgBuySize.toFixed(3)}) < ${signals.minAvgBuySize}`);
    }
    if (metrics.avgBuySize > signals.maxAvgBuySize) {
      reasons.push(`LSF: avg_buy_size (${metrics.avgBuySize.toFixed(3)}) > ${signals.maxAvgBuySize}`);
    }
    if (metrics.buySizeStd >= 0.3) {
      reasons.push(`LSF: buy_size_std (${metrics.buySizeStd.toFixed(3)}) too high`);
    }
    if (metrics.largestBuy > signals.maxLargestBuy) {
      reasons.push(`LSF: largest_buy (${metrics.largestBuy.toFixed(3)}) > ${signals.maxLargestBuy}`);
    }
  }

  if (!evaluation.mcPassed) {
    if (metrics.txCount60s < signals.minTxCount60s) {
      reasons.push(`MC: tx_count_60s (${metrics.txCount60s}) < ${signals.minTxCount60s}`);
    }
    if (!metrics.txIntervalDelta) {
      reasons.push('MC: tx_interval_delta is FALSE (no acceleration)');
    }
  }

  return reasons;
}

/**
 * Calculate a confidence score based on how strongly signals pass
 * Returns 0-100 indicating strength beyond minimum thresholds
 */
export function calculateSignalStrength(
  metrics: RollingMetrics,
  evaluation: SignalEvaluation
): number {
  if (!evaluation.allPassed) return 0;

  const signals = CONFIG.signals;
  let strength = 0;
  let factors = 0;

  // EAS strength - how much above minimum
  const buyersExcess = (metrics.buyers5m - signals.minBuyers5m) / signals.minBuyers5m;
  strength += Math.min(buyersExcess * 30, 30); // Max 30 points
  factors++;

  const intervalMargin = (signals.maxTxIntervalMean - metrics.txIntervalMean) / signals.maxTxIntervalMean;
  strength += Math.min(intervalMargin * 20, 20); // Max 20 points
  factors++;

  // Acceleration strength
  const accelStrength = Math.min(metrics.txAcceleration / 5, 1) * 20; // Max 20 points for 5+ acceleration
  strength += accelStrength;
  factors++;

  // LSF strength - centered in range is better
  const avgBuyMid = (signals.minAvgBuySize + signals.maxAvgBuySize) / 2;
  const avgBuyRange = signals.maxAvgBuySize - signals.minAvgBuySize;
  const centeredness = 1 - Math.abs(metrics.avgBuySize - avgBuyMid) / (avgBuyRange / 2);
  strength += centeredness * 15; // Max 15 points
  factors++;

  // MC strength
  const txCountExcess = (metrics.txCount60s - signals.minTxCount60s) / signals.minTxCount60s;
  strength += Math.min(txCountExcess * 15, 15); // Max 15 points
  factors++;

  return Math.round(strength);
}
