// =========================================================
// KILL SWITCH — EMERGENCY EXIT CONDITIONS
// =========================================================

import { PaperPosition, ExitReason, Transaction } from '../types';
import { CONFIG } from '../config';
import { PositionManager } from './position';
import { TokenTracker } from '../core/tokenTracker';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Kill switch state per position
 */
interface KillState {
  positionId: string;
  lastActivityTimestamp: number;
}

/**
 * Kill Switch - immediate exit conditions
 * 
 * Immediately CLOSE position if:
 * - zero tx for 60 seconds
 * - sudden large buy > 3 SOL appears
 * - dev wallet interacts again
 */
export class KillSwitch {
  private positionManager: PositionManager;
  private states: Map<string, KillState> = new Map();

  constructor(positionManager: PositionManager) {
    this.positionManager = positionManager;
  }

  /**
   * Initialize kill switch tracking for a position
   */
  initPosition(positionId: string): void {
    this.states.set(positionId, {
      positionId,
      lastActivityTimestamp: Date.now(),
    });
  }

  /**
   * Check kill switch conditions and trigger if needed
   * Returns true if kill switch was triggered
   */
  check(
    position: PaperPosition,
    tracker: TokenTracker,
    currentPrice: number,
    latestTx?: Transaction
  ): boolean {
    const state = this.states.get(position.id);
    if (!state) {
      this.initPosition(position.id);
      return false;
    }

    // 1. Zero tx for 60 seconds
    const timeSinceLastTx = Date.now() - tracker.lastTxTimestamp;
    if (timeSinceLastTx >= CONFIG.killSwitch.noTxSeconds * 1000) {
      this.trigger(position, currentPrice, 'kill_switch_no_tx');
      return true;
    }

    // Check latest transaction if provided
    if (latestTx) {
      // Update activity timestamp
      state.lastActivityTimestamp = latestTx.timestamp;

      // 2. Sudden large buy > 3 SOL (whale dump incoming)
      if (latestTx.solAmount > CONFIG.killSwitch.whaleBuyThreshold) {
        logger.warn('Kill switch: Whale buy detected', {
          token: position.tokenAddress.slice(0, 8),
          amount: latestTx.solAmount.toFixed(3),
        });
        this.trigger(position, currentPrice, 'kill_switch_whale');
        return true;
      }

      // 3. Dev wallet interacts again
      if (tracker.devWallet && latestTx.buyerWallet === tracker.devWallet) {
        // Dev already bought once (on creation), this is a second interaction
        if (tracker.devBuyCount > 1) {
          logger.warn('Kill switch: Dev wallet activity', {
            token: position.tokenAddress.slice(0, 8),
            devBuyCount: tracker.devBuyCount,
          });
          this.trigger(position, currentPrice, 'kill_switch_dev');
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Trigger kill switch and close position
   */
  private trigger(
    position: PaperPosition,
    currentPrice: number,
    reason: ExitReason
  ): void {
    logger.warn('KILL SWITCH TRIGGERED', {
      positionId: position.id.slice(0, 12),
      token: position.tokenAddress.slice(0, 8),
      reason,
    });

    this.positionManager.closePosition(position.id, currentPrice, reason);
    this.cleanup(position.id);

    events.emit('kill_switch_triggered', { position, reason });
  }

  /**
   * Cleanup state for closed position
   */
  cleanup(positionId: string): void {
    this.states.delete(positionId);
  }

  /**
   * Clear all states
   */
  clear(): void {
    this.states.clear();
  }
}
