// =========================================================
// SIMULATION SCRIPT — TEST WITH SYNTHETIC DATA
// =========================================================

import { Transaction } from '../types';
import { TokenRegistry, TokenTracker } from '../core/tokenTracker';
import { evaluateFilters } from '../core/filters';
import { evaluateSignals } from '../core/signals';
import { calculateScore, formatScore } from '../core/scoring';
import { PositionManager } from '../trading/position';
import { EntryEngine } from '../trading/entryEngine';
import { MetricsCalculator } from '../logging/metrics';
import { logger } from '../utils/logger';

/**
 * Generate synthetic transactions for testing
 */
function generateSyntheticToken(
  tokenAddress: string,
  pattern: 'organic' | 'whale' | 'pump' | 'dead'
): Transaction[] {
  const transactions: Transaction[] = [];
  const startTime = Date.now();
  
  const generateWallet = () => `wallet_${Math.random().toString(36).substr(2, 12)}`;
  
  switch (pattern) {
    case 'organic':
      // Good organic growth pattern
      for (let i = 0; i < 30; i++) {
        transactions.push({
          tokenAddress,
          timestamp: startTime + i * 10000 + Math.random() * 5000,
          buyerWallet: generateWallet(),
          solAmount: 0.1 + Math.random() * 0.3,
          txHash: `tx_${i}`,
        });
      }
      break;
      
    case 'whale':
      // Whale activity - should be filtered
      for (let i = 0; i < 10; i++) {
        transactions.push({
          tokenAddress,
          timestamp: startTime + i * 15000,
          buyerWallet: generateWallet(),
          solAmount: 0.5 + Math.random() * 2.5, // Some large buys
          txHash: `tx_${i}`,
        });
      }
      break;
      
    case 'pump':
      // Pump pattern - fast initial buys
      for (let i = 0; i < 20; i++) {
        transactions.push({
          tokenAddress,
          timestamp: startTime + i * 5000,
          buyerWallet: generateWallet(),
          solAmount: 0.15 + Math.random() * 0.2,
          txHash: `tx_${i}`,
        });
      }
      break;
      
    case 'dead':
      // Dead token - very few transactions
      for (let i = 0; i < 3; i++) {
        transactions.push({
          tokenAddress,
          timestamp: startTime + i * 60000,
          buyerWallet: generateWallet(),
          solAmount: 0.05 + Math.random() * 0.1,
          txHash: `tx_${i}`,
        });
      }
      break;
  }
  
  return transactions;
}

/**
 * Run simulation
 */
async function simulate(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         PUMP.FUN PAPER TRADING — SIMULATION MODE              ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const tokenRegistry = new TokenRegistry();
  const positionManager = new PositionManager();
  const entryEngine = new EntryEngine(positionManager);
  const metricsCalculator = new MetricsCalculator();

  // Generate test tokens
  const testCases: Array<{ name: string; pattern: 'organic' | 'whale' | 'pump' | 'dead' }> = [
    { name: 'organic_good_1', pattern: 'organic' },
    { name: 'organic_good_2', pattern: 'organic' },
    { name: 'whale_bad', pattern: 'whale' },
    { name: 'pump_suspicious', pattern: 'pump' },
    { name: 'dead_token', pattern: 'dead' },
    { name: 'organic_good_3', pattern: 'organic' },
  ];

  console.log('Processing synthetic tokens...\n');
  console.log('Token              Pattern     Buyers  Score   Status');
  console.log('─────────────────────────────────────────────────────────────');

  for (const testCase of testCases) {
    const tokenAddress = `token_${testCase.name}`;
    const transactions = generateSyntheticToken(tokenAddress, testCase.pattern);

    // Process transactions
    let tracker: TokenTracker | undefined;
    for (const tx of transactions) {
      tracker = tokenRegistry.processTransaction(tx);
    }

    if (!tracker) continue;

    // Wait a bit to simulate time passing (for 5min window)
    // In simulation, we just process with current metrics
    
    const metrics = tracker.calculateMetrics();
    const filterResult = evaluateFilters(tracker, metrics);
    
    let status = '';
    let scoreValue = 0;
    
    if (!filterResult.passed) {
      status = `DROPPED: ${filterResult.reason?.split(';')[0]}`;
      tracker.drop(filterResult.reason!);
    } else {
      const signalEval = evaluateSignals(metrics);
      const score = calculateScore(tracker.tokenAddress, metrics);
      scoreValue = score.score;
      
      if (signalEval.allPassed && score.score >= 18) {
        status = 'SIGNAL DETECTED';
      } else if (!signalEval.easPassed) {
        status = 'EAS failed';
      } else if (!signalEval.lsfPassed) {
        status = 'LSF failed';
      } else if (!signalEval.mcPassed) {
        status = 'MC failed';
      } else {
        status = 'Score too low';
      }
    }

    const tokenName = testCase.name.padEnd(18);
    const pattern = testCase.pattern.padEnd(10);
    const buyers = metrics.buyers5m.toString().padStart(6);
    const score = scoreValue.toFixed(0).padStart(5);
    
    console.log(`${tokenName} ${pattern} ${buyers}  ${score}   ${status}`);
  }

  console.log('─────────────────────────────────────────────────────────────\n');

  // Summary
  const activeTrackers = tokenRegistry.getActiveTrackers();
  const droppedCount = tokenRegistry.getAllTrackers().filter(t => t.dropped).length;
  
  console.log('Simulation Summary:');
  console.log(`  Total tokens processed: ${testCases.length}`);
  console.log(`  Active tokens: ${activeTrackers.length}`);
  console.log(`  Dropped tokens: ${droppedCount}`);
  console.log(`  Open positions: ${positionManager.openCount}`);

  // Cleanup
  tokenRegistry.stop();
}

// Run
simulate().catch(console.error);
