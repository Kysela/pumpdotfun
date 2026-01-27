// =========================================================
// ANALYZE SCRIPT — REVIEW TRADE LOGS AND METRICS
// =========================================================

import * as fs from 'fs';
import * as path from 'path';
import { TradeLogger } from '../logging/tradeLogger';
import { MetricsCalculator } from '../logging/metrics';
import { LOG_CONFIG } from '../config';

/**
 * Analyze trade logs and print metrics
 */
async function analyze(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         PUMP.FUN PAPER TRADING — LOG ANALYSIS                 ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const logDir = LOG_CONFIG.dir;

  // Check if log directory exists
  if (!fs.existsSync(logDir)) {
    console.log('No log directory found. Run the system first to generate trades.');
    return;
  }

  // Find all log files
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith('trades_') && f.endsWith('.jsonl'))
    .map(f => path.join(logDir, f))
    .sort();

  if (files.length === 0) {
    console.log('No trade log files found. Run the system first to generate trades.');
    return;
  }

  console.log(`Found ${files.length} log file(s):\n`);
  files.forEach(f => console.log(`  - ${path.basename(f)}`));
  console.log('');

  // Load and analyze
  const calculator = new MetricsCalculator();
  calculator.loadFromLogs(files);

  // Print summary
  console.log(calculator.getSummary());

  // Print exit reason breakdown
  const breakdown = calculator.getExitReasonBreakdown();
  if (breakdown.size > 0) {
    console.log('\nExit Reason Breakdown:');
    console.log('─────────────────────────────────────────');
    for (const [reason, count] of breakdown.entries()) {
      console.log(`  ${reason}: ${count}`);
    }
    console.log('─────────────────────────────────────────\n');
  }

  // Load individual trades for detailed view
  const allTrades = files.flatMap(f => TradeLogger.readTrades(f));
  
  if (allTrades.length > 0) {
    // Recent trades
    console.log('\nMost Recent Trades (last 10):');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log('Token         Entry Score  Entry Price   PnL       Exit Reason');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    
    const recent = allTrades.slice(-10).reverse();
    for (const trade of recent) {
      const token = trade.tokenAddress.slice(0, 12) + '...';
      const score = trade.entryScore.toString().padStart(5);
      const price = trade.entryPrice.toFixed(6).padStart(10);
      const pnl = (trade.realizedPnL >= 0 ? '+' : '') + trade.realizedPnL.toFixed(4);
      const reason = trade.exitReason || 'unknown';
      
      console.log(`${token}  ${score}     ${price}   ${pnl.padStart(8)}  ${reason}`);
    }
    console.log('─────────────────────────────────────────────────────────────────────────────\n');

    // Best and worst trades
    const sorted = [...allTrades].sort((a, b) => b.realizedPnL - a.realizedPnL);
    
    console.log('Top 5 Best Trades:');
    sorted.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.tokenAddress.slice(0, 12)}... PnL: +${t.realizedPnL.toFixed(4)} SOL (${t.exitReason})`);
    });
    
    console.log('\nTop 5 Worst Trades:');
    sorted.slice(-5).reverse().forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.tokenAddress.slice(0, 12)}... PnL: ${t.realizedPnL.toFixed(4)} SOL (${t.exitReason})`);
    });
  }
}

// Run
analyze().catch(console.error);
