// =========================================================
// HEALTH CHECK SERVER — FOR RAILWAY/CONTAINER MONITORING
// =========================================================

import * as http from 'http';
import { logger } from '../utils/logger';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  timestamp: string;
  details?: Record<string, unknown>;
}

type StatusProvider = () => Record<string, unknown>;

/**
 * Simple HTTP server for health checks
 * Required for Railway and container orchestration
 */
export class HealthServer {
  private server: http.Server | null = null;
  private port: number;
  private startTime: number;
  private statusProvider: StatusProvider | null = null;

  constructor(port?: number) {
    this.port = port || parseInt(process.env.PORT || '3000', 10);
    this.startTime = Date.now();
  }

  /**
   * Set a function that provides current system status
   */
  setStatusProvider(provider: StatusProvider): void {
    this.statusProvider = provider;
  }

  /**
   * Start the health check server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.warn(`Port ${this.port} in use, trying ${this.port + 1}`);
          this.port += 1;
          this.server?.listen(this.port);
        } else {
          reject(error);
        }
      });

      this.server.listen(this.port, () => {
        logger.info(`Health server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    
    // CORS headers for monitoring tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    switch (url) {
      case '/':
      case '/health':
        this.handleHealth(res);
        break;
      case '/status':
        this.handleStatus(res);
        break;
      case '/metrics':
        this.handleMetrics(res);
        break;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Handle /health endpoint
   */
  private handleHealth(res: http.ServerResponse): void {
    const health: HealthStatus = {
      status: 'healthy',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };

    res.statusCode = 200;
    res.end(JSON.stringify(health));
  }

  /**
   * Handle /status endpoint with detailed system status
   */
  private handleStatus(res: http.ServerResponse): void {
    const status: Record<string, unknown> = {
      status: 'running',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      pid: process.pid,
    };

    if (this.statusProvider) {
      status.system = this.statusProvider();
    }

    res.statusCode = 200;
    res.end(JSON.stringify(status, null, 2));
  }

  /**
   * Handle /metrics endpoint (Prometheus-compatible format)
   */
  private handleMetrics(res: http.ServerResponse): void {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memory = process.memoryUsage();
    
    let metrics = '';
    metrics += `# HELP process_uptime_seconds Process uptime in seconds\n`;
    metrics += `# TYPE process_uptime_seconds gauge\n`;
    metrics += `process_uptime_seconds ${uptime}\n\n`;
    
    metrics += `# HELP process_memory_heap_bytes Process heap memory in bytes\n`;
    metrics += `# TYPE process_memory_heap_bytes gauge\n`;
    metrics += `process_memory_heap_bytes ${memory.heapUsed}\n\n`;

    if (this.statusProvider) {
      const systemStatus = this.statusProvider();
      
      if (typeof systemStatus.processedTxCount === 'number') {
        metrics += `# HELP pumpfun_transactions_total Total transactions processed\n`;
        metrics += `# TYPE pumpfun_transactions_total counter\n`;
        metrics += `pumpfun_transactions_total ${systemStatus.processedTxCount}\n\n`;
      }
      
      if (typeof systemStatus.activeTokens === 'number') {
        metrics += `# HELP pumpfun_active_tokens Active tokens being tracked\n`;
        metrics += `# TYPE pumpfun_active_tokens gauge\n`;
        metrics += `pumpfun_active_tokens ${systemStatus.activeTokens}\n\n`;
      }
      
      if (typeof systemStatus.openPositions === 'number') {
        metrics += `# HELP pumpfun_open_positions Open paper positions\n`;
        metrics += `# TYPE pumpfun_open_positions gauge\n`;
        metrics += `pumpfun_open_positions ${systemStatus.openPositions}\n\n`;
      }
      
      if (typeof systemStatus.totalPnL === 'number') {
        metrics += `# HELP pumpfun_total_pnl_sol Total PnL in SOL\n`;
        metrics += `# TYPE pumpfun_total_pnl_sol gauge\n`;
        metrics += `pumpfun_total_pnl_sol ${systemStatus.totalPnL}\n\n`;
      }
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.statusCode = 200;
    res.end(metrics);
  }

  /**
   * Stop the health check server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }
}
