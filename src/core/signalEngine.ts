// =========================================================
// SIGNAL ENGINE — MAIN ORCHESTRATION
// =========================================================

import { Transaction, RollingMetrics, TokenScore, SignalEvaluation, PaperPosition } from '../types';
import { CONFIG, validateConfig } from '../config';
import { SolanaWebSocket } from '../data/websocket';
import { TokenRegistry, TokenTracker } from './tokenTracker';
import { evaluateFilters, quickFilterTransaction } from './filters';
import { evaluateSignals } from './signals';
import { calculateScore } from './scoring';
import { PositionManager } from '../trading/position';
import { EntryEngine } from '../trading/entryEngine';
import { TradeLogger } from '../logging/tradeLogger';
import { MetricsCalculator } from '../logging/metrics';
import { logger } from '../utils/logger';
import { events } from '../utils/eventEmitter';

/**
 * Signal Engine - main orchestration class
 * 
 * Coordinates all components:
 * - WebSocket transaction stream
 * - Token tracking and lifecycle
 * - Signal detection and scoring
 * - Paper trading execution
 * - Logging and metrics
 */
export class SignalEngine {
  private ws: SolanaWebSocket;
  private tokenRegistry: TokenRegistry;
  private positionManager: PositionManager;
  private entryEngine: EntryEngine;
  private tradeLogger: TradeLogger;
  private metricsCalculator: MetricsCalculator;
  
  private scoreInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private processedTxCount: number = 0;

  constructor() {
    // Validate configuration at startup
    validateConfig();

    // Initialize components
    this.ws = new SolanaWebSocket();
    this.tokenRegistry = new TokenRegistry();
    this.positionManager = new PositionManager();
    this.entryEngine = new EntryEngine(this.positionManager);
    this.tradeLogger = new TradeLogger();
    this.metricsCalculator = new MetricsCalculator();

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up internal event handlers
   */
  private setupEventHandlers(): void {
    // Log closed positions
    events.on('position_closed', (event) => {
      const { position } = event.data as { position: PaperPosition };
      this.tradeLogger.logTrade(position);
      this.metricsCalculator.addTrade(position);
    });

    // Track token events
    events.on('token_new', (event) => {
      logger.debug('New token detected', event.data);
    });

    events.on('token_dropped', (event) => {
      logger.debug('Token dropped', event.data);
    });

    // Track kill switch
    events.on('kill_switch_triggered', (event) => {
      const { position, reason } = event.data as { position: PaperPosition; reason: string };
      logger.warn('Kill switch triggered', { 
        token: position.tokenAddress.slice(0, 8),
        reason 
      });
    });
  }

  /**
   * Start the signal engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Signal engine already running');
      return;
    }

    logger.info('Starting signal engine...');

    try {
      // Connect to Solana WebSocket
      await this.ws.connect();

      // Set up transaction handler
      events.on('transaction', (event) => {
        this.processTransaction(event.data as Transaction);
      });

      // Start score recalculation interval
      this.startScoreInterval();

      this.isRunning = true;
      logger.info('Signal engine started successfully');

      // Print status periodically
      this.startStatusPrinting();

    } catch (error) {
      logger.error('Failed to start signal engine', { error });
      throw error;
    }
  }

  /**
   * Process incoming transaction
   */
  private processTransaction(tx: Transaction): void {
    this.processedTxCount++;

    // Quick filter first
    const quickFilter = quickFilterTransaction(tx.solAmount);
    if (!quickFilter.pass) {
      logger.debug('Transaction filtered', { 
        token: tx.tokenAddress.slice(0, 8),
        reason: quickFilter.reason 
      });
      return;
    }

    // Add to token registry
    const tracker = this.tokenRegistry.processTransaction(tx);

    // Skip if token already dropped
    if (tracker.dropped) return;

    // Check if we have an open position for this token
    const existingPosition = this.positionManager.getPositionByToken(tx.tokenAddress);
    
    if (existingPosition && existingPosition.status !== 'closed') {
      // Process position monitoring
      this.monitorPosition(existingPosition, tracker, tx);
    } else {
      // Evaluate for new entry
      this.evaluateForEntry(tracker);
    }
  }

  /**
   * Monitor an existing position
   */
  private monitorPosition(
    position: PaperPosition,
    tracker: TokenTracker,
    latestTx: Transaction
  ): void {
    const metrics = tracker.calculateMetrics();
    
    // Estimate current price (simplified)
    const currentPrice = metrics.avgBuySize;

    // Check kill switch first
    const killSwitch = this.entryEngine.getKillSwitch();
    if (killSwitch.check(position, tracker, currentPrice, latestTx)) {
      return; // Position was closed by kill switch
    }

    // Check exit conditions
    const exitEngine = this.entryEngine.getExitEngine();
    const exitEval = exitEngine.evaluateExit(position, currentPrice, metrics, tracker);
    
    if (exitEval.shouldPartialExit || exitEval.shouldFullExit) {
      exitEngine.executeExit(position, currentPrice, exitEval);
    }
  }

  /**
   * Evaluate a token for entry
   */
  private evaluateForEntry(tracker: TokenTracker): void {
    // Calculate metrics
    const metrics = tracker.calculateMetrics();

    // Apply hard filters
    const filterResult = evaluateFilters(tracker, metrics);
    if (!filterResult.passed) {
      tracker.drop(filterResult.reason!);
      return;
    }

    // Evaluate signals
    const signalEval = evaluateSignals(metrics);

    // Calculate score
    const score = calculateScore(tracker.tokenAddress, metrics);

    // Try entry
    this.entryEngine.tryEntry(tracker, score, signalEval, metrics);
  }

  /**
   * Start periodic score recalculation for all tracked tokens
   */
  private startScoreInterval(): void {
    this.scoreInterval = setInterval(() => {
      this.recalculateScores();
    }, CONFIG.scoring.recalcIntervalMs);
  }

  /**
   * Recalculate scores for all active tokens
   */
  private recalculateScores(): void {
    const activeTrackers = this.tokenRegistry.getActiveTrackers();

    for (const tracker of activeTrackers) {
      if (tracker.dropped) continue;

      // Skip if we already have a position
      if (this.positionManager.hasOpenPosition(tracker.tokenAddress)) continue;

      // Evaluate for entry
      this.evaluateForEntry(tracker);
    }

    // Update missed runners count in metrics
    this.metricsCalculator.setMissedRunners(this.entryEngine.missedRunnerCount);

    // Check positions without recent activity
    this.checkStalePositions();
  }

  /**
   * Check for positions that may need exit due to inactivity
   */
  private checkStalePositions(): void {
    const openPositions = this.positionManager.getOpenPositions();

    for (const position of openPositions) {
      const tracker = this.tokenRegistry.getTracker(position.tokenAddress);
      if (!tracker) continue;

      const metrics = tracker.calculateMetrics();
      const currentPrice = metrics.avgBuySize;

      // Check kill switch for inactivity
      const killSwitch = this.entryEngine.getKillSwitch();
      if (killSwitch.check(position, tracker, currentPrice)) {
        continue; // Position was closed
      }

      // Check exit conditions
      const exitEngine = this.entryEngine.getExitEngine();
      const exitEval = exitEngine.evaluateExit(position, currentPrice, metrics, tracker);

      if (exitEval.shouldFullExit && exitEval.reason) {
        exitEngine.executeExit(position, currentPrice, exitEval);
      }
    }
  }

  /**
   * Start periodic status printing
   */
  private startStatusPrinting(): void {
    setInterval(() => {
      this.printStatus();
    }, 30000); // Every 30 seconds
  }

  /**
   * Print current status
   */
  private printStatus(): void {
    const openPositions = this.positionManager.getOpenPositions();
    const closedCount = this.positionManager.getClosedPositions().length;
    const activeTokens = this.tokenRegistry.activeCount;

    logger.info('Status update', {
      txProcessed: this.processedTxCount,
      activeTokens,
      openPositions: openPositions.length,
      closedTrades: closedCount,
      totalPnL: this.positionManager.getTotalPnL().toFixed(4),
    });
  }

  /**
   * Get current metrics summary
   */
  getMetricsSummary(): string {
    return this.metricsCalculator.getSummary();
  }

  /**
   * Get system status
   */
  getStatus(): object {
    return {
      isRunning: this.isRunning,
      wsConnected: this.ws.connected,
      processedTxCount: this.processedTxCount,
      activeTokens: this.tokenRegistry.activeCount,
      openPositions: this.positionManager.openCount,
      closedTrades: this.positionManager.getClosedPositions().length,
      totalPnL: this.positionManager.getTotalPnL(),
      missedRunners: this.entryEngine.missedRunnerCount,
    };
  }

  /**
   * Stop the signal engine
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('Stopping signal engine...');

    // Stop score interval
    if (this.scoreInterval) {
      clearInterval(this.scoreInterval);
      this.scoreInterval = null;
    }

    // Stop token registry cleanup
    this.tokenRegistry.stop();

    // Disconnect WebSocket
    this.ws.disconnect();

    // Close trade logger
    this.tradeLogger.close();

    this.isRunning = false;

    // Print final metrics
    console.log('\n' + this.getMetricsSummary());

    logger.info('Signal engine stopped');
  }
}
