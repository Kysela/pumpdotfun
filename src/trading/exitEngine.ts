// =========================================================
// EXIT ENGINE — EXIT RULES (NON-NEGOTIABLE)
// =========================================================

import { PaperPosition, ExitReason, RollingMetrics } from '../types';
import { CONFIG } from '../config';
import { PositionManager } from './position';
import { TokenTracker } from '../core/tokenTracker';
import { logger } from '../utils/logger';

/**
 * Exit conditions tracker for monitoring consecutive decreases
 */
interface ExitState {
  positionId: string;
  consecutiveTxDecreases: number;
  lastTxCount60s: number;
  spikeDetected: boolean;
  postSpikeTxCount?: number;
}

/**
 * Exit Engine - monitors positions and triggers exits
 * 
 * Exit Rules (NON-NEGOTIABLE):
 * 
 * Partial Exit:
 * - IF virtual_pnl >= +120% THEN mark 50% position as SOLD
 * 
 * Full Exit:
 * - IF virtual_pnl >= +220%
 * - OR no tx in last 60 seconds
 * - OR tx_count_60s decreases twice consecutively
 * - OR token hits first stagnation after spike
 * THEN close remaining position.
 * 
 * No overrides. No discretion. No re-entry.
 */
export class ExitEngine {
  private positionManager: PositionManager;
  private exitStates: Map<string, ExitState> = new Map();

  constructor(positionManager: PositionManager) {
    this.positionManager = positionManager;
  }

  /**
   * Initialize tracking for a new position
   */
  initPosition(positionId: string, initialTxCount: number): void {
    this.exitStates.set(positionId, {
      positionId,
      consecutiveTxDecreases: 0,
      lastTxCount60s: initialTxCount,
      spikeDetected: false,
    });
  }

  /**
   * Evaluate exit conditions for a position
   * Returns the exit reason if should exit, undefined otherwise
   */
  evaluateExit(
    position: PaperPosition,
    currentPrice: number,
    metrics: RollingMetrics,
    tracker: TokenTracker
  ): { shouldPartialExit: boolean; shouldFullExit: boolean; reason?: ExitReason } {
    const state = this.exitStates.get(position.id);
    if (!state) {
      // Initialize if not exists
      this.initPosition(position.id, metrics.txCount60s);
      return { shouldPartialExit: false, shouldFullExit: false };
    }

    // Calculate current PnL percentage
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Update max unrealized PnL
    this.positionManager.updateUnrealizedPnL(position.id, currentPrice);

    // Check partial exit condition (+120%)
    const shouldPartialExit = 
      position.status === 'open' && 
      pnlPercent >= CONFIG.exit.partialProfitPercent;

    // Check full exit conditions
    let shouldFullExit = false;
    let exitReason: ExitReason | undefined;

    // 1. Profit target full (+220%)
    if (pnlPercent >= CONFIG.exit.fullProfitPercent) {
      shouldFullExit = true;
      exitReason = 'profit_target_full';
    }

    // 2. No activity for 60 seconds
    const timeSinceLastTx = Date.now() - tracker.lastTxTimestamp;
    if (timeSinceLastTx >= CONFIG.exit.noActivitySeconds * 1000) {
      shouldFullExit = true;
      exitReason = 'no_activity_60s';
    }

    // 3. tx_count_60s decreases twice consecutively
    if (metrics.txCount60s < state.lastTxCount60s) {
      state.consecutiveTxDecreases++;
      if (state.consecutiveTxDecreases >= CONFIG.exit.txDecreaseThreshold) {
        shouldFullExit = true;
        exitReason = 'tx_decrease_twice';
      }
    } else if (metrics.txCount60s > state.lastTxCount60s) {
      // Reset counter on increase
      state.consecutiveTxDecreases = 0;
      
      // Detect spike (significant increase)
      if (metrics.txCount60s > state.lastTxCount60s * 1.5) {
        state.spikeDetected = true;
        state.postSpikeTxCount = metrics.txCount60s;
      }
    }

    // 4. First stagnation after spike
    if (state.spikeDetected && state.postSpikeTxCount) {
      // Stagnation = tx count drops significantly after spike
      if (metrics.txCount60s < state.postSpikeTxCount * 0.5) {
        shouldFullExit = true;
        exitReason = 'stagnation_after_spike';
      }
    }

    // Update state
    state.lastTxCount60s = metrics.txCount60s;

    return {
      shouldPartialExit,
      shouldFullExit,
      reason: exitReason,
    };
  }

  /**
   * Execute the exit based on evaluation
   */
  executeExit(
    position: PaperPosition,
    currentPrice: number,
    evaluation: { shouldPartialExit: boolean; shouldFullExit: boolean; reason?: ExitReason }
  ): void {
    // Execute partial exit first if needed
    if (evaluation.shouldPartialExit && position.status === 'open') {
      this.positionManager.executePartialExit(position.id, currentPrice);
      
      // Update position reference after partial exit
      const updatedPosition = this.positionManager.getPosition(position.id);
      if (!updatedPosition) return;
      
      // Check if we should also full exit
      if (evaluation.shouldFullExit && evaluation.reason) {
        this.positionManager.closePosition(position.id, currentPrice, evaluation.reason);
        this.cleanup(position.id);
      }
    } else if (evaluation.shouldFullExit && evaluation.reason) {
      this.positionManager.closePosition(position.id, currentPrice, evaluation.reason);
      this.cleanup(position.id);
    }
  }

  /**
   * Cleanup state for closed position
   */
  cleanup(positionId: string): void {
    this.exitStates.delete(positionId);
  }

  /**
   * Get current exit state for debugging
   */
  getState(positionId: string): ExitState | undefined {
    return this.exitStates.get(positionId);
  }

  /**
   * Clear all states
   */
  clear(): void {
    this.exitStates.clear();
  }
}
