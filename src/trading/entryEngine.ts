// =========================================================
// ENTRY ENGINE — PAPER POSITION ENTRY RULES
// =========================================================

import { TokenScore, SignalEvaluation, RollingMetrics } from '../types';
import { CONFIG } from '../config';
import { TokenTracker } from '../core/tokenTracker';
import { PositionManager } from './position';
import { ExitEngine } from './exitEngine';
import { KillSwitch } from './killSwitch';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Missed runner tracking
 */
interface MissedRunner {
  tokenAddress: string;
  timestamp: number;
  score: number;
  reason: string;
}

/**
 * Entry Engine - evaluates entry eligibility and opens positions
 * 
 * Entry Eligibility (from rules):
 * IF:
 * - score >= 18
 * - token age between 2-12 minutes
 * - estimated market cap between 3k-15k (simplified to SOL bonding curve position)
 * 
 * THEN:
 * - create PAPER POSITION
 * 
 * Paper Position Params:
 * - entry_price = current implied price
 * - position_size = 1.0 SOL (virtual)
 * - entry_timestamp = now
 */
export class EntryEngine {
  private positionManager: PositionManager;
  private exitEngine: ExitEngine;
  private killSwitch: KillSwitch;
  private missedRunners: MissedRunner[] = [];

  constructor(positionManager: PositionManager) {
    this.positionManager = positionManager;
    this.exitEngine = new ExitEngine(positionManager);
    this.killSwitch = new KillSwitch(positionManager);
  }

  /**
   * Evaluate if a token is eligible for entry
   */
  evaluateEntry(
    tracker: TokenTracker,
    score: TokenScore,
    signalEval: SignalEvaluation,
    metrics: RollingMetrics
  ): { eligible: boolean; reason?: string } {
    const entry = CONFIG.entry;

    // Already have a position?
    if (this.positionManager.hasOpenPosition(tracker.tokenAddress)) {
      return { eligible: false, reason: 'position_already_exists' };
    }

    // Token dropped?
    if (tracker.dropped) {
      return { eligible: false, reason: `token_dropped: ${tracker.dropReason}` };
    }

    // Score threshold
    if (score.score < entry.minScore) {
      return { eligible: false, reason: `score_too_low: ${score.score} < ${entry.minScore}` };
    }

    // Token age check
    const ageMinutes = tracker.getAgeMinutes();
    if (ageMinutes < entry.minTokenAgeMinutes) {
      return { eligible: false, reason: `too_young: ${ageMinutes.toFixed(1)}min < ${entry.minTokenAgeMinutes}min` };
    }
    if (ageMinutes > entry.maxTokenAgeMinutes) {
      return { eligible: false, reason: `too_old: ${ageMinutes.toFixed(1)}min > ${entry.maxTokenAgeMinutes}min` };
    }

    // All signals must pass
    if (!signalEval.allPassed) {
      const failedSignals = [];
      if (!signalEval.easPassed) failedSignals.push('EAS');
      if (!signalEval.lsfPassed) failedSignals.push('LSF');
      if (!signalEval.mcPassed) failedSignals.push('MC');
      return { eligible: false, reason: `signals_failed: ${failedSignals.join(', ')}` };
    }

    // Market cap estimation (simplified - based on bonding curve position)
    // In pump.fun, early tokens have lower market cap
    // We estimate based on unique buyers and avg buy size
    const estimatedMC = this.estimateMarketCap(metrics);
    if (estimatedMC < entry.minMarketCapSOL || estimatedMC > entry.maxMarketCapSOL) {
      return { 
        eligible: false, 
        reason: `mc_out_of_range: ${estimatedMC.toFixed(0)} not in [${entry.minMarketCapSOL}, ${entry.maxMarketCapSOL}]` 
      };
    }

    return { eligible: true };
  }

  /**
   * Estimate market cap based on activity (simplified heuristic)
   * Real implementation would need to decode bonding curve state
   */
  private estimateMarketCap(metrics: RollingMetrics): number {
    // Rough estimation based on:
    // - Number of buyers
    // - Average buy size
    // - Total transaction count
    
    // This is a simplified heuristic - real implementation would
    // decode the actual bonding curve position from on-chain data
    const totalVolume = metrics.buyers5m * metrics.avgBuySize;
    
    // Pump.fun bonding curve roughly: MC = totalVolumeInSOL * 10-50
    // Early stage multiplier is higher
    const multiplier = 30;
    
    return totalVolume * multiplier;
  }

  /**
   * Calculate implied entry price (simplified)
   * Real implementation would decode bonding curve
   */
  private calculateEntryPrice(metrics: RollingMetrics): number {
    // Simplified: use average buy size as proxy for price level
    // Real implementation would calculate from bonding curve position
    return metrics.avgBuySize;
  }

  /**
   * Execute entry if eligible
   */
  tryEntry(
    tracker: TokenTracker,
    score: TokenScore,
    signalEval: SignalEvaluation,
    metrics: RollingMetrics
  ): boolean {
    const evaluation = this.evaluateEntry(tracker, score, signalEval, metrics);

    if (!evaluation.eligible) {
      // Track as missed runner if score was high enough
      if (score.score >= CONFIG.entry.minScore && evaluation.reason !== 'position_already_exists') {
        this.trackMissedRunner(tracker.tokenAddress, score.score, evaluation.reason!);
      }
      return false;
    }

    // Calculate entry price
    const entryPrice = this.calculateEntryPrice(metrics);

    // Open position
    const position = this.positionManager.openPosition(
      tracker.tokenAddress,
      entryPrice,
      score.score
    );

    // Initialize exit tracking
    this.exitEngine.initPosition(position.id, metrics.txCount60s);
    this.killSwitch.initPosition(position.id);

    logger.info('Entry executed', {
      token: tracker.tokenAddress.slice(0, 8),
      score: score.score,
      age: tracker.getAgeMinutes().toFixed(1) + 'min',
      buyers: metrics.buyers5m,
    });

    events.emit('signal_detected', {
      tokenAddress: tracker.tokenAddress,
      score: score.score,
      signalEval,
    });

    return true;
  }

  /**
   * Track a missed runner for analysis
   */
  private trackMissedRunner(tokenAddress: string, score: number, reason: string): void {
    this.missedRunners.push({
      tokenAddress,
      timestamp: Date.now(),
      score,
      reason,
    });

    // Keep only last 1000 missed runners
    if (this.missedRunners.length > 1000) {
      this.missedRunners = this.missedRunners.slice(-1000);
    }
  }

  /**
   * Get exit engine for position monitoring
   */
  getExitEngine(): ExitEngine {
    return this.exitEngine;
  }

  /**
   * Get kill switch for emergency exits
   */
  getKillSwitch(): KillSwitch {
    return this.killSwitch;
  }

  /**
   * Get missed runners for analysis
   */
  getMissedRunners(): MissedRunner[] {
    return [...this.missedRunners];
  }

  /**
   * Get count of missed runners
   */
  get missedRunnerCount(): number {
    return this.missedRunners.length;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.exitEngine.clear();
    this.killSwitch.clear();
    this.missedRunners = [];
  }
}
