/**
 * Structured Logger for ContextWise
 * 
 * CRITICAL MCP REQUIREMENT:
 * In stdio mode, stdout is strictly reserved for JSON-RPC 2.0 messages.
 * Any log messages must be written to stderr or log files to prevent protocol corruption.
 */

import { redactionFilter } from '../vault/redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export class Logger {
  private level: LogLevel = 'info';
  private prefix: string;

  constructor(prefix: string = 'ContextWise', level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: string, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` ${typeof meta === 'object' ? JSON.stringify(meta) : String(meta)}` : '';
    const raw = `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}${metaStr}\n`;
    return redactionFilter.redact(raw);
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      process.stderr.write(this.formatMessage('DEBUG', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      process.stderr.write(this.formatMessage('INFO', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      process.stderr.write(this.formatMessage('WARN', message, meta));
    }
  }

  error(message: string, meta?: unknown): void {
    if (this.shouldLog('error')) {
      process.stderr.write(this.formatMessage('ERROR', message, meta));
    }
  }
}

export const logger = new Logger('ContextWise');
