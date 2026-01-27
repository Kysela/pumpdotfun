// =========================================================
// TOKEN TRACKER — LIFECYCLE MANAGEMENT
// =========================================================

import { Transaction, TokenState, RollingMetrics } from '../types';
import { CONFIG } from '../config';
import { MultiWindowBuffer } from '../utils/ringBuffer';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Tracks individual token state and transactions
 */
export class TokenTracker {
  readonly tokenAddress: string;
  readonly firstSeenTimestamp: number;
  
  private buffer: MultiWindowBuffer;
  private _uniqueBuyers: Set<string> = new Set();
  private _dropped: boolean = false;
  private _dropReason?: string;
  private _metadataEditCount: number = 0;
  private _devWallet?: string;
  private _devBuyCount: number = 0;
  private _lastTxTimestamp: number;

  constructor(tokenAddress: string, firstTx: Transaction) {
    this.tokenAddress = tokenAddress;
    this.firstSeenTimestamp = firstTx.timestamp;
    this._lastTxTimestamp = firstTx.timestamp;
    this.buffer = new MultiWindowBuffer(CONFIG.windows.buyers);
    
    // Add first transaction
    this.addTransaction(firstTx);
    
    logger.debug('New token tracker created', { 
      token: tokenAddress.slice(0, 8),
      firstBuyer: firstTx.buyerWallet.slice(0, 8)
    });
  }

  /**
   * Add a transaction to this token's tracking
   */
  addTransaction(tx: Transaction): void {
    if (this._dropped) return;
    
    this.buffer.add(tx);
    this._uniqueBuyers.add(tx.buyerWallet);
    this._lastTxTimestamp = tx.timestamp;

    // Track dev wallet (first buyer is assumed to be dev)
    if (!this._devWallet) {
      this._devWallet = tx.buyerWallet;
      this._devBuyCount = 1;
    } else if (tx.buyerWallet === this._devWallet) {
      this._devBuyCount++;
    }
  }

  /**
   * Mark metadata as edited
   */
  recordMetadataEdit(): void {
    this._metadataEditCount++;
  }

  /**
   * Get the age of this token in milliseconds
   */
  getAgeMs(): number {
    return Date.now() - this.firstSeenTimestamp;
  }

  /**
   * Get the age of this token in minutes
   */
  getAgeMinutes(): number {
    return this.getAgeMs() / (60 * 1000);
  }

  /**
   * Check if token has expired (> 20 minutes)
   */
  isExpired(): boolean {
    return this.getAgeMinutes() > CONFIG.maxTokenAgeMinutes;
  }

  /**
   * Check if token should be dropped due to insufficient activity
   */
  shouldDropInactivity(): boolean {
    // Check after 5 minutes if there are at least 2 unique buyers
    if (this.getAgeMinutes() >= 5 && this._uniqueBuyers.size < CONFIG.minBuyersAfter5Min) {
      return true;
    }
    return false;
  }

  /**
   * Mark token as dropped
   */
  drop(reason: string): void {
    if (!this._dropped) {
      this._dropped = true;
      this._dropReason = reason;
      logger.debug('Token dropped', { 
        token: this.tokenAddress.slice(0, 8), 
        reason 
      });
      events.emit('token_dropped', { tokenAddress: this.tokenAddress, reason });
    }
  }

  /**
   * Calculate all rolling metrics for this token
   */
  calculateMetrics(): RollingMetrics {
    const windows = CONFIG.windows;
    
    // Transaction counts
    const txCount30s = this.buffer.countWindow(windows.short);
    const txCount60s = this.buffer.countWindow(windows.medium);
    const txCount180s = this.buffer.countWindow(windows.long);
    
    // Previous 60s (from 120s ago to 60s ago)
    const txCountPrev60s = this.buffer.countRange(120000, 60000);
    
    // Buyer metrics (5 minute window)
    const buyers5m = this.buffer.getUniqueBuyers(windows.buyers).size;
    const repeatBuyers = this.buffer.getRepeatBuyers(windows.buyers);
    
    // Buy size metrics (3 minute window for stability)
    const sizeStats = this.buffer.getBuySizeStats(windows.long);
    
    // Transaction interval metrics
    const txIntervalMean = this.buffer.getTxIntervalMean(windows.medium);
    const txIntervalDelta = this.buffer.getTxIntervalDelta();
    
    // Derived metrics
    const txAcceleration = txCount60s - txCountPrev60s;

    return {
      txCount30s,
      txCount60s,
      txCount180s,
      txCountPrev60s,
      buyers5m,
      repeatBuyers,
      avgBuySize: sizeStats.avg,
      buySizeStd: sizeStats.std,
      largestBuy: sizeStats.max,
      txIntervalMean,
      txIntervalDelta,
      txAcceleration,
    };
  }

  /**
   * Get current state snapshot
   */
  getState(): TokenState {
    return {
      tokenAddress: this.tokenAddress,
      firstSeenTimestamp: this.firstSeenTimestamp,
      lastTxTimestamp: this._lastTxTimestamp,
      transactions: this.buffer.getAll(),
      uniqueBuyers: new Set(this._uniqueBuyers),
      dropped: this._dropped,
      dropReason: this._dropReason,
      metadataEditCount: this._metadataEditCount,
      devWallet: this._devWallet,
      devBuyCount: this._devBuyCount,
    };
  }

  // Getters
  get dropped(): boolean { return this._dropped; }
  get dropReason(): string | undefined { return this._dropReason; }
  get uniqueBuyerCount(): number { return this._uniqueBuyers.size; }
  get devWallet(): string | undefined { return this._devWallet; }
  get devBuyCount(): number { return this._devBuyCount; }
  get metadataEditCount(): number { return this._metadataEditCount; }
  get lastTxTimestamp(): number { return this._lastTxTimestamp; }
  get transactionCount(): number { return this.buffer.getAll().length; }
}

/**
 * Registry managing all active token trackers
 */
export class TokenRegistry {
  private trackers: Map<string, TokenTracker> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval (every 30 seconds)
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Process a new transaction
   */
  processTransaction(tx: Transaction): TokenTracker {
    let tracker = this.trackers.get(tx.tokenAddress);
    
    if (!tracker) {
      // New token discovered
      tracker = new TokenTracker(tx.tokenAddress, tx);
      this.trackers.set(tx.tokenAddress, tracker);
      events.emit('token_new', { tokenAddress: tx.tokenAddress });
    } else {
      // Existing token, add transaction
      tracker.addTransaction(tx);
    }

    return tracker;
  }

  /**
   * Get a tracker by token address
   */
  getTracker(tokenAddress: string): TokenTracker | undefined {
    return this.trackers.get(tokenAddress);
  }

  /**
   * Get all active (non-dropped) trackers
   */
  getActiveTrackers(): TokenTracker[] {
    return Array.from(this.trackers.values()).filter(t => !t.dropped && !t.isExpired());
  }

  /**
   * Get all trackers
   */
  getAllTrackers(): TokenTracker[] {
    return Array.from(this.trackers.values());
  }

  /**
   * Get count of active tokens
   */
  get activeCount(): number {
    return this.getActiveTrackers().length;
  }

  /**
   * Cleanup expired and dropped tokens
   */
  private cleanup(): void {
    const toRemove: string[] = [];
    
    for (const [address, tracker] of this.trackers) {
      // Remove expired tokens (> 20 minutes)
      if (tracker.isExpired()) {
        toRemove.push(address);
        continue;
      }
      
      // Check for inactivity drop
      if (!tracker.dropped && tracker.shouldDropInactivity()) {
        tracker.drop('insufficient_buyers_after_5m');
      }
    }

    // Remove from registry
    for (const address of toRemove) {
      this.trackers.delete(address);
    }

    if (toRemove.length > 0) {
      logger.debug('Cleanup completed', { removed: toRemove.length, active: this.activeCount });
    }
  }

  /**
   * Stop the registry and cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all trackers
   */
  clear(): void {
    this.trackers.clear();
  }
}
