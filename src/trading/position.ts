// =========================================================
// PAPER POSITION — POSITION MANAGEMENT
// =========================================================

import * as crypto from 'crypto';
import { PaperPosition, ExitReason } from '../types';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Generate a unique position ID
 */
function generatePositionId(): string {
  const randomPart = crypto.randomBytes(6).toString('hex');
  return `pos_${Date.now()}_${randomPart}`;
}

/**
 * Paper position manager
 */
export class PositionManager {
  private positions: Map<string, PaperPosition> = new Map();
  private closedPositions: PaperPosition[] = [];
  private tokenToPosition: Map<string, string> = new Map(); // tokenAddress -> positionId

  /**
   * Open a new paper position
   */
  openPosition(
    tokenAddress: string,
    entryPrice: number,
    entryScore: number
  ): PaperPosition {
    // Check if position already exists for this token
    if (this.tokenToPosition.has(tokenAddress)) {
      const existingId = this.tokenToPosition.get(tokenAddress)!;
      const existing = this.positions.get(existingId);
      if (existing && existing.status !== 'closed') {
        logger.warn('Position already exists for token', { tokenAddress: tokenAddress.slice(0, 8) });
        return existing;
      }
    }

    const position: PaperPosition = {
      id: generatePositionId(),
      tokenAddress,
      entryTimestamp: Date.now(),
      entryPrice,
      entryScore,
      positionSizeSOL: CONFIG.entry.positionSizeSOL,
      remainingSizeSOL: CONFIG.entry.positionSizeSOL,
      status: 'open',
      maxUnrealizedPnL: 0,
      realizedPnL: 0,
    };

    this.positions.set(position.id, position);
    this.tokenToPosition.set(tokenAddress, position.id);

    logger.info('Paper position opened', {
      id: position.id.slice(0, 12),
      token: tokenAddress.slice(0, 8),
      entryPrice: entryPrice.toFixed(6),
      score: entryScore,
    });

    events.emit('position_opened', position);
    return position;
  }

  /**
   * Execute partial exit (50% at +120%)
   */
  executePartialExit(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId);
    if (!position || position.status === 'closed') return;

    const exitPercent = CONFIG.exit.partialExitPercent / 100;
    const exitAmount = position.positionSizeSOL * exitPercent;
    
    // Calculate PnL for this portion
    const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
    const pnl = exitAmount * priceChange;

    position.remainingSizeSOL -= exitAmount;
    position.partialExitTimestamp = Date.now();
    position.partialExitPrice = currentPrice;
    position.realizedPnL += pnl;
    position.status = 'partial';

    logger.info('Partial exit executed', {
      id: positionId.slice(0, 12),
      exitAmount: exitAmount.toFixed(3),
      pnl: pnl.toFixed(4),
      priceChange: (priceChange * 100).toFixed(1) + '%',
    });

    events.emit('position_partial_exit', { position, pnl });
  }

  /**
   * Close position completely
   */
  closePosition(positionId: string, currentPrice: number, reason: ExitReason): void {
    const position = this.positions.get(positionId);
    if (!position || position.status === 'closed') return;

    // Calculate final PnL
    const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
    const pnl = position.remainingSizeSOL * priceChange;

    position.remainingSizeSOL = 0;
    position.exitTimestamp = Date.now();
    position.exitPrice = currentPrice;
    position.exitReason = reason;
    position.realizedPnL += pnl;
    position.status = 'closed';

    // Move to closed positions
    this.closedPositions.push(position);
    this.positions.delete(positionId);
    this.tokenToPosition.delete(position.tokenAddress);

    logger.info('Position closed', {
      id: positionId.slice(0, 12),
      reason,
      totalPnL: position.realizedPnL.toFixed(4),
      duration: ((position.exitTimestamp - position.entryTimestamp) / 1000).toFixed(0) + 's',
    });

    events.emit('position_closed', { position, reason });
  }

  /**
   * Update max unrealized PnL
   */
  updateUnrealizedPnL(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId);
    if (!position || position.status === 'closed') return;

    const priceChange = (currentPrice - position.entryPrice) / position.entryPrice;
    const unrealizedPnL = position.remainingSizeSOL * priceChange;
    const unrealizedPct = priceChange * 100;

    if (unrealizedPct > position.maxUnrealizedPnL) {
      position.maxUnrealizedPnL = unrealizedPct;
    }
  }

  /**
   * Get position by token address
   */
  getPositionByToken(tokenAddress: string): PaperPosition | undefined {
    const positionId = this.tokenToPosition.get(tokenAddress);
    if (!positionId) return undefined;
    return this.positions.get(positionId);
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): PaperPosition[] {
    return Array.from(this.positions.values()).filter(p => p.status !== 'closed');
  }

  /**
   * Get position by ID
   */
  getPosition(positionId: string): PaperPosition | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Get all closed positions
   */
  getClosedPositions(): PaperPosition[] {
    return [...this.closedPositions];
  }

  /**
   * Check if we have an open position for a token
   */
  hasOpenPosition(tokenAddress: string): boolean {
    const position = this.getPositionByToken(tokenAddress);
    return position !== undefined && position.status !== 'closed';
  }

  /**
   * Get count of open positions
   */
  get openCount(): number {
    return this.getOpenPositions().length;
  }

  /**
   * Get total PnL across all closed positions
   */
  getTotalPnL(): number {
    return this.closedPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
  }

  /**
   * Clear all positions (for testing)
   */
  clear(): void {
    this.positions.clear();
    this.closedPositions = [];
    this.tokenToPosition.clear();
  }
}
