// =========================================================
// LOGGER — CONSOLE AND FILE LOGGING
// =========================================================

import * as fs from 'fs';
import * as path from 'path';
import { LOG_CONFIG } from '../config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple logger with console and file output
 */
class Logger {
  private level: LogLevel;
  private logDir: string;
  private initialized: boolean = false;

  constructor() {
    this.level = (LOG_CONFIG.level as LogLevel) || 'info';
    this.logDir = LOG_CONFIG.dir;
  }

  /**
   * Initialize log directory
   */
  private init(): void {
    if (this.initialized) return;
    
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.initialized = true;
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  /**
   * Format a log message
   */
  private format(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  /**
   * Log to console with color
   */
  private logToConsole(level: LogLevel, formatted: string): void {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level]}${formatted}${reset}`);
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const formatted = this.format(level, message, data);
    this.logToConsole(level, formatted);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Set log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// Export singleton instance
export const logger = new Logger();
