// =========================================================
// PERFORMANCE METRICS — TRACKING AND ANALYSIS
// =========================================================

import { PerformanceMetrics, PaperPosition, TradeLog, ExitReason } from '../types';
import { TradeLogger } from './tradeLogger';
import { logger } from '../utils/logger';

/**
 * Kill switch exit reasons
 */
const KILL_SWITCH_REASONS: ExitReason[] = [
  'kill_switch_no_tx',
  'kill_switch_whale',
  'kill_switch_dev',
];

/**
 * Performance Metrics Calculator
 * 
 * Track (from rules):
 * - win rate
 * - avg R multiple
 * - avg time in trade
 * - % exited by kill-switch
 * - missed runners (score >= 18 but no entry)
 * 
 * Definition of Success:
 * - win rate >= 35%
 * - average R >= 2.5
 * - max drawdown < 20% (paper)
 */
export class MetricsCalculator {
  private trades: TradeLog[] = [];
  private missedRunners: number = 0;
  private peakBalance: number = 0;
  private currentBalance: number = 0;
  private maxDrawdown: number = 0;

  /**
   * Add a completed trade
   */
  addTrade(position: PaperPosition): void {
    const trade: TradeLog = {
      tokenAddress: position.tokenAddress,
      entryTime: position.entryTimestamp,
      entryScore: position.entryScore,
      entryPrice: position.entryPrice,
      exitTime: position.exitTimestamp,
      exitReason: position.exitReason,
      maxUnrealizedPnL: position.maxUnrealizedPnL,
      realizedPnL: position.realizedPnL,
    };

    this.trades.push(trade);
    this.updateDrawdown(trade.realizedPnL);
  }

  /**
   * Record a missed runner
   */
  recordMissedRunner(): void {
    this.missedRunners++;
  }

  /**
   * Set missed runners count from entry engine
   */
  setMissedRunners(count: number): void {
    this.missedRunners = count;
  }

  /**
   * Update drawdown tracking
   */
  private updateDrawdown(pnl: number): void {
    this.currentBalance += pnl;
    
    if (this.currentBalance > this.peakBalance) {
      this.peakBalance = this.currentBalance;
    }

    if (this.peakBalance > 0) {
      const drawdown = ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100;
      if (drawdown > this.maxDrawdown) {
        this.maxDrawdown = drawdown;
      }
    }
  }

  /**
   * Calculate all performance metrics
   */
  calculate(): PerformanceMetrics {
    const totalTrades = this.trades.length;

    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgRMultiple: 0,
        avgTimeInTrade: 0,
        killSwitchExits: 0,
        killSwitchPercentage: 0,
        missedRunners: this.missedRunners,
        totalPnL: 0,
        maxDrawdown: 0,
      };
    }

    // Win/loss counts
    const wins = this.trades.filter(t => t.realizedPnL > 0).length;
    const losses = totalTrades - wins;
    const winRate = (wins / totalTrades) * 100;

    // Average R multiple (PnL / risk per trade)
    // Risk is entry amount (1 SOL), so R = PnL / 1.0
    const totalPnL = this.trades.reduce((sum, t) => sum + t.realizedPnL, 0);
    const avgRMultiple = totalPnL / totalTrades;

    // Average time in trade
    const tradeDurations = this.trades
      .filter(t => t.exitTime)
      .map(t => t.exitTime! - t.entryTime);
    const avgTimeInTrade = tradeDurations.length > 0
      ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
      : 0;

    // Kill switch exits
    const killSwitchExits = this.trades.filter(t => 
      t.exitReason && KILL_SWITCH_REASONS.includes(t.exitReason)
    ).length;
    const killSwitchPercentage = (killSwitchExits / totalTrades) * 100;

    return {
      totalTrades,
      wins,
      losses,
      winRate,
      avgRMultiple,
      avgTimeInTrade,
      killSwitchExits,
      killSwitchPercentage,
      missedRunners: this.missedRunners,
      totalPnL,
      maxDrawdown: this.maxDrawdown,
    };
  }

  /**
   * Check if system meets success criteria
   */
  isValid(): { valid: boolean; reasons: string[] } {
    const metrics = this.calculate();
    const reasons: string[] = [];

    // Need minimum sample size
    if (metrics.totalTrades < 100) {
      return {
        valid: false,
        reasons: [`Insufficient trades: ${metrics.totalTrades}/100 minimum`],
      };
    }

    // Win rate >= 35%
    if (metrics.winRate < 35) {
      reasons.push(`Win rate ${metrics.winRate.toFixed(1)}% < 35%`);
    }

    // Average R >= 2.5
    if (metrics.avgRMultiple < 2.5) {
      reasons.push(`Avg R ${metrics.avgRMultiple.toFixed(2)} < 2.5`);
    }

    // Max drawdown < 20%
    if (metrics.maxDrawdown >= 20) {
      reasons.push(`Max drawdown ${metrics.maxDrawdown.toFixed(1)}% >= 20%`);
    }

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Get formatted summary
   */
  getSummary(): string {
    const m = this.calculate();
    const validity = this.isValid();

    const lines = [
      '═══════════════════════════════════════════',
      '          PERFORMANCE METRICS SUMMARY       ',
      '═══════════════════════════════════════════',
      '',
      `Total Trades:        ${m.totalTrades}`,
      `Wins:                ${m.wins}`,
      `Losses:              ${m.losses}`,
      `Win Rate:            ${m.winRate.toFixed(1)}%`,
      `Average R Multiple:  ${m.avgRMultiple.toFixed(2)}`,
      `Avg Time in Trade:   ${(m.avgTimeInTrade / 1000).toFixed(0)}s`,
      `Kill Switch Exits:   ${m.killSwitchExits} (${m.killSwitchPercentage.toFixed(1)}%)`,
      `Missed Runners:      ${m.missedRunners}`,
      `Total PnL:           ${m.totalPnL.toFixed(4)} SOL`,
      `Max Drawdown:        ${m.maxDrawdown.toFixed(1)}%`,
      '',
      '═══════════════════════════════════════════',
      `System Valid: ${validity.valid ? 'YES ✓' : 'NO ✗'}`,
    ];

    if (!validity.valid) {
      lines.push('Failure Reasons:');
      validity.reasons.forEach(r => lines.push(`  - ${r}`));
    }

    lines.push('═══════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Get metrics breakdown by exit reason
   */
  getExitReasonBreakdown(): Map<ExitReason | 'unknown', number> {
    const breakdown = new Map<ExitReason | 'unknown', number>();
    
    for (const trade of this.trades) {
      const reason = trade.exitReason || 'unknown';
      breakdown.set(reason, (breakdown.get(reason) || 0) + 1);
    }

    return breakdown;
  }

  /**
   * Load trades from log files
   */
  loadFromLogs(logFiles: string[]): void {
    for (const file of logFiles) {
      const trades = TradeLogger.readTrades(file);
      for (const trade of trades) {
        this.trades.push(trade);
        this.updateDrawdown(trade.realizedPnL);
      }
    }

    logger.info('Loaded trades from logs', { count: this.trades.length });
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.trades = [];
    this.missedRunners = 0;
    this.peakBalance = 0;
    this.currentBalance = 0;
    this.maxDrawdown = 0;
  }
}
