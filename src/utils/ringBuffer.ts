// =========================================================
// RING BUFFER — TIME-BASED ROLLING WINDOW
// =========================================================

import { Transaction } from '../types';

/**
 * Time-based ring buffer for maintaining rolling windows of transactions.
 * Automatically evicts entries older than the specified window duration.
 */
export class RingBuffer<T extends { timestamp: number }> {
  private buffer: T[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  /**
   * Add an item to the buffer
   */
  add(item: T): void {
    this.buffer.push(item);
    this.evictOld();
  }

  /**
   * Get all items currently in the window
   */
  getAll(): T[] {
    this.evictOld();
    return [...this.buffer];
  }

  /**
   * Get count of items in the window
   */
  count(): number {
    this.evictOld();
    return this.buffer.length;
  }

  /**
   * Get items within a specific time range (relative to now)
   * @param startMsAgo - Start of range (ms ago from now)
   * @param endMsAgo - End of range (ms ago from now), defaults to 0 (now)
   */
  getInRange(startMsAgo: number, endMsAgo: number = 0): T[] {
    const now = Date.now();
    const startTime = now - startMsAgo;
    const endTime = now - endMsAgo;
    
    this.evictOld();
    return this.buffer.filter(item => 
      item.timestamp >= startTime && item.timestamp <= endTime
    );
  }

  /**
   * Count items in a specific time range
   */
  countInRange(startMsAgo: number, endMsAgo: number = 0): number {
    return this.getInRange(startMsAgo, endMsAgo).length;
  }

  /**
   * Get the most recent item
   */
  getLast(): T | undefined {
    this.evictOld();
    return this.buffer[this.buffer.length - 1];
  }

  /**
   * Get the oldest item in the buffer
   */
  getFirst(): T | undefined {
    this.evictOld();
    return this.buffer[0];
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    this.evictOld();
    return this.buffer.length === 0;
  }

  /**
   * Remove items older than the window
   */
  private evictOld(): void {
    const cutoff = Date.now() - this.windowMs;
    // Find first index that's within window
    let firstValidIndex = 0;
    while (firstValidIndex < this.buffer.length && 
           this.buffer[firstValidIndex].timestamp < cutoff) {
      firstValidIndex++;
    }
    if (firstValidIndex > 0) {
      this.buffer = this.buffer.slice(firstValidIndex);
    }
  }
}

/**
 * Multi-window buffer that maintains multiple time windows efficiently.
 * Used for tracking transactions across 30s, 60s, 180s windows simultaneously.
 */
export class MultiWindowBuffer {
  private transactions: Transaction[] = [];
  private readonly maxWindowMs: number;

  constructor(maxWindowMs: number = 5 * 60 * 1000) {
    // Keep data for the longest window (5 minutes for buyers tracking)
    this.maxWindowMs = maxWindowMs;
  }

  /**
   * Add a transaction
   */
  add(tx: Transaction): void {
    this.transactions.push(tx);
    this.evictOld();
  }

  /**
   * Get transactions within a time window
   * @param windowMs - Window duration in milliseconds
   */
  getWindow(windowMs: number): Transaction[] {
    const cutoff = Date.now() - windowMs;
    return this.transactions.filter(tx => tx.timestamp >= cutoff);
  }

  /**
   * Get count for a specific window
   */
  countWindow(windowMs: number): number {
    return this.getWindow(windowMs).length;
  }

  /**
   * Get transactions in a range (for calculating "previous" windows)
   * @param startMsAgo - Start of range (ms ago)
   * @param endMsAgo - End of range (ms ago)
   */
  getRange(startMsAgo: number, endMsAgo: number): Transaction[] {
    const now = Date.now();
    const startTime = now - startMsAgo;
    const endTime = now - endMsAgo;
    
    return this.transactions.filter(tx =>
      tx.timestamp >= startTime && tx.timestamp <= endTime
    );
  }

  /**
   * Count transactions in a range
   */
  countRange(startMsAgo: number, endMsAgo: number): number {
    return this.getRange(startMsAgo, endMsAgo).length;
  }

  /**
   * Get unique buyers in a window
   */
  getUniqueBuyers(windowMs: number): Set<string> {
    const txs = this.getWindow(windowMs);
    return new Set(txs.map(tx => tx.buyerWallet));
  }

  /**
   * Get repeat buyers (wallets with 2+ buys) in a window
   */
  getRepeatBuyers(windowMs: number): number {
    const txs = this.getWindow(windowMs);
    const buyerCounts = new Map<string, number>();
    
    for (const tx of txs) {
      buyerCounts.set(tx.buyerWallet, (buyerCounts.get(tx.buyerWallet) || 0) + 1);
    }
    
    let repeatCount = 0;
    for (const count of buyerCounts.values()) {
      if (count >= 2) repeatCount++;
    }
    
    return repeatCount;
  }

  /**
   * Get buy size statistics for a window
   */
  getBuySizeStats(windowMs: number): { avg: number; std: number; max: number } {
    const txs = this.getWindow(windowMs);
    
    if (txs.length === 0) {
      return { avg: 0, std: 0, max: 0 };
    }

    const amounts = txs.map(tx => tx.solAmount);
    const sum = amounts.reduce((a, b) => a + b, 0);
    const avg = sum / amounts.length;
    const max = Math.max(...amounts);

    // Calculate standard deviation
    const squaredDiffs = amounts.map(x => Math.pow(x - avg, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / amounts.length;
    const std = Math.sqrt(avgSquaredDiff);

    return { avg, std, max };
  }

  /**
   * Calculate mean interval between transactions in a window
   */
  getTxIntervalMean(windowMs: number): number {
    const txs = this.getWindow(windowMs);
    
    if (txs.length < 2) {
      return Infinity; // Not enough data
    }

    // Sort by timestamp
    const sorted = [...txs].sort((a, b) => a.timestamp - b.timestamp);
    
    let totalInterval = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalInterval += sorted[i].timestamp - sorted[i - 1].timestamp;
    }

    return totalInterval / (sorted.length - 1) / 1000; // Return in seconds
  }

  /**
   * Check if current tx interval is less than previous
   */
  getTxIntervalDelta(): boolean {
    const now = Date.now();
    
    // Get last 2 intervals
    const recentTxs = this.getWindow(60000); // Last 60s
    if (recentTxs.length < 3) return false;
    
    const sorted = [...recentTxs].sort((a, b) => a.timestamp - b.timestamp);
    const n = sorted.length;
    
    const currentInterval = sorted[n - 1].timestamp - sorted[n - 2].timestamp;
    const previousInterval = sorted[n - 2].timestamp - sorted[n - 3].timestamp;
    
    return currentInterval < previousInterval;
  }

  /**
   * Get all transactions (for analysis)
   */
  getAll(): Transaction[] {
    this.evictOld();
    return [...this.transactions];
  }

  /**
   * Get the most recent transaction
   */
  getLast(): Transaction | undefined {
    this.evictOld();
    return this.transactions[this.transactions.length - 1];
  }

  /**
   * Clear all transactions
   */
  clear(): void {
    this.transactions = [];
  }

  /**
   * Evict old transactions beyond max window
   */
  private evictOld(): void {
    const cutoff = Date.now() - this.maxWindowMs;
    this.transactions = this.transactions.filter(tx => tx.timestamp >= cutoff);
  }
}
