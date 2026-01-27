// =========================================================
// SCORING MODEL — TOKEN SCORE CALCULATION
// =========================================================

import { RollingMetrics, TokenScore } from '../types';
import { CONFIG } from '../config';

/**
 * Calculate the score for a token based on its metrics.
 * 
 * Scoring formula (from rules):
 * 
 * score = 
 *   buyers_5m * 2
 * + tx_acceleration * 3
 * + repeat_buyers * 2
 * - (largest_buy > 1 SOL ? 5 : 0)
 * - (tx_count_60s == 0 ? 10 : 0)
 * 
 * Score is recalculated every 10 seconds.
 */
export function calculateScore(
  tokenAddress: string,
  metrics: RollingMetrics
): TokenScore {
  const scoring = CONFIG.scoring;

  // Positive components
  const buyersComponent = metrics.buyers5m * scoring.buyersWeight;
  const accelerationComponent = metrics.txAcceleration * scoring.accelerationWeight;
  const repeatBuyersComponent = metrics.repeatBuyers * scoring.repeatBuyersWeight;

  // Penalty components
  const largestBuyPenalty = metrics.largestBuy > 1.0 ? scoring.largestBuyPenalty : 0;
  const stagnationPenalty = metrics.txCount60s === 0 ? scoring.stagnationPenalty : 0;

  // Calculate total score
  const score = 
    buyersComponent +
    accelerationComponent +
    repeatBuyersComponent -
    largestBuyPenalty -
    stagnationPenalty;

  return {
    tokenAddress,
    score: Math.max(0, score), // Don't go negative
    timestamp: Date.now(),
    breakdown: {
      buyersComponent,
      accelerationComponent,
      repeatBuyersComponent,
      largestBuyPenalty,
      stagnationPenalty,
    },
  };
}

/**
 * Check if a score meets entry threshold
 */
export function meetsEntryThreshold(score: TokenScore): boolean {
  return score.score >= CONFIG.entry.minScore;
}

/**
 * Get score trend (comparing current vs previous)
 */
export function getScoreTrend(
  currentScore: number,
  previousScore: number
): 'increasing' | 'stable' | 'decreasing' {
  const diff = currentScore - previousScore;
  
  if (diff > 2) return 'increasing';
  if (diff < -2) return 'decreasing';
  return 'stable';
}

/**
 * Format score for display
 */
export function formatScore(score: TokenScore): string {
  const { breakdown } = score;
  
  return `Score: ${score.score.toFixed(1)} | ` +
    `Buyers: +${breakdown.buyersComponent.toFixed(1)} | ` +
    `Accel: +${breakdown.accelerationComponent.toFixed(1)} | ` +
    `Repeat: +${breakdown.repeatBuyersComponent.toFixed(1)} | ` +
    `Penalties: -${(breakdown.largestBuyPenalty + breakdown.stagnationPenalty).toFixed(1)}`;
}

/**
 * Determine score quality tier
 */
export function getScoreTier(score: number): 'excellent' | 'good' | 'marginal' | 'poor' {
  if (score >= 30) return 'excellent';
  if (score >= 22) return 'good';
  if (score >= CONFIG.entry.minScore) return 'marginal';
  return 'poor';
}
