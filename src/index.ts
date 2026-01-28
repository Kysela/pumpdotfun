// =========================================================
// PUMP.FUN SIGNAL DETECTION + PAPER TRADING
// Main Entry Point — Railway Compatible
// =========================================================

import { SignalEngine } from './core/signalEngine';
import { HealthServer } from './server/health';
import { logger } from './utils/logger';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   PUMP.FUN SIGNAL DETECTION + PAPER TRADING SYSTEM            ║
║                                                               ║
║   Mode: PAPER TRADING ONLY (no real funds)                    ║
║   Network: Solana Mainnet                                     ║
║   Platform: pump.fun                                          ║
║                                                               ║
║   Detecting: ATTENTION ACCELERATION + LIQUIDITY SHAPE         ║
║   Price is a lagging indicator. Signals come from behavior.   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Initialize components
  const engine = new SignalEngine();
  const healthServer = new HealthServer();

  // Connect health server to engine status
  healthServer.setStatusProvider(() => engine.getStatus());

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    
    // Stop components in order
    engine.stop();
    await healthServer.stop();
    
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    engine.stop();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });

  try {
    // Start health server first (Railway needs this)
    await healthServer.start();

    // Start the signal engine
    await engine.start();

    logger.info('System is now monitoring pump.fun transactions');
    logger.info('Health check available at /health');
    logger.info('Press Ctrl+C to stop and view metrics summary');

    // Keep running
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('Failed to start system', { error });
    await healthServer.stop();
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
