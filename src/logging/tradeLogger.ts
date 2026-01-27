// =========================================================
// TRADE LOGGER — JSONL OUTPUT
// =========================================================

import * as fs from 'fs';
import * as path from 'path';
import { TradeLog, PaperPosition } from '../types';
import { LOG_CONFIG } from '../config';
import { logger } from '../utils/logger';

/**
 * Trade logger for JSONL output
 * 
 * For each token (from rules):
 * - token_address
 * - entry_time
 * - entry_score
 * - entry_price
 * - exit_time
 * - exit_reason
 * - max_unrealized_pnl
 * - realized_pnl
 * 
 * Store as JSONL for later analysis.
 */
export class TradeLogger {
  private logDir: string;
  private logFile: string;
  private stream: fs.WriteStream | null = null;

  constructor() {
    this.logDir = LOG_CONFIG.dir;
    this.logFile = path.join(this.logDir, `trades_${this.getDateString()}.jsonl`);
    this.init();
  }

  /**
   * Initialize log directory and file stream
   */
  private init(): void {
    try {
      // Create log directory if it doesn't exist
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      // Open write stream (append mode)
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
      
      logger.info('Trade logger initialized', { file: this.logFile });
    } catch (error) {
      logger.error('Failed to initialize trade logger', { error });
    }
  }

  /**
   * Get date string for log file naming
   */
  private getDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Log a completed trade
   */
  logTrade(position: PaperPosition): void {
    if (!this.stream) {
      logger.error('Trade logger stream not available');
      return;
    }

    const tradeLog: TradeLog = {
      tokenAddress: position.tokenAddress,
      entryTime: position.entryTimestamp,
      entryScore: position.entryScore,
      entryPrice: position.entryPrice,
      exitTime: position.exitTimestamp,
      exitReason: position.exitReason,
      maxUnrealizedPnL: position.maxUnrealizedPnL,
      realizedPnL: position.realizedPnL,
    };

    try {
      const line = JSON.stringify(tradeLog) + '\n';
      this.stream.write(line);
    } catch (error) {
      logger.error('Failed to write trade log', { error });
    }
  }

  /**
   * Log a custom event
   */
  logEvent(event: object): void {
    if (!this.stream) return;

    try {
      const line = JSON.stringify({
        timestamp: Date.now(),
        type: 'event',
        ...event,
      }) + '\n';
      this.stream.write(line);
    } catch (error) {
      logger.error('Failed to write event log', { error });
    }
  }

  /**
   * Read all trades from a log file
   */
  static readTrades(filePath: string): TradeLog[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      
      return lines
        .filter(line => line.length > 0)
        .map(line => {
          try {
            const parsed = JSON.parse(line);
            // Only return trade logs (not events)
            if (parsed.tokenAddress && parsed.entryTime) {
              return parsed as TradeLog;
            }
            return null;
          } catch {
            return null;
          }
        })
        .filter((log): log is TradeLog => log !== null);
    } catch (error) {
      logger.error('Failed to read trade log', { filePath, error });
      return [];
    }
  }

  /**
   * Get all log files in the log directory
   */
  getLogFiles(): string[] {
    try {
      const files = fs.readdirSync(this.logDir);
      return files
        .filter(f => f.startsWith('trades_') && f.endsWith('.jsonl'))
        .map(f => path.join(this.logDir, f))
        .sort();
    } catch (error) {
      logger.error('Failed to list log files', { error });
      return [];
    }
  }

  /**
   * Rotate log file (for daily rotation)
   */
  rotate(): void {
    const newFile = path.join(this.logDir, `trades_${this.getDateString()}.jsonl`);
    
    if (newFile !== this.logFile) {
      // Close current stream
      if (this.stream) {
        this.stream.end();
      }
      
      // Open new stream
      this.logFile = newFile;
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
      
      logger.info('Trade log rotated', { file: this.logFile });
    }
  }

  /**
   * Close the logger
   */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
