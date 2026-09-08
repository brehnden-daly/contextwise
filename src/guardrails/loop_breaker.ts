import { generateToolCallCacheKey } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

interface CallRecord {
  callKey: string;
  toolName: string;
  timestamp: number;
  isError?: boolean;
}

export interface LoopBreakerConfig {
  maxCallsPerMinute: number;
  consecutiveFailureThreshold: number;
}

export class RunawayLoopBreaker {
  private callHistory: CallRecord[] = [];
  private consecutiveFailures: Map<string, number> = new Map();
  private maxCallsPerMinute: number;
  private consecutiveFailureThreshold: number;

  constructor(config: Partial<LoopBreakerConfig> = {}) {
    this.maxCallsPerMinute = config.maxCallsPerMinute ?? 60;
    this.consecutiveFailureThreshold = config.consecutiveFailureThreshold ?? 3;
  }

  updateConfig(config: Partial<LoopBreakerConfig>): void {
    if (config.maxCallsPerMinute !== undefined) {
      this.maxCallsPerMinute = config.maxCallsPerMinute;
    }
    if (config.consecutiveFailureThreshold !== undefined) {
      this.consecutiveFailureThreshold = config.consecutiveFailureThreshold;
    }
  }

  /**
   * Checks if a tool call is permitted before execution with detailed classification.
   */
  checkPreFlightDetailed(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): { allowed: boolean; reason?: 'rate_limited' | 'circuit_breaker'; message?: string } {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    // 1. Purge calls older than 60 seconds from sliding window
    this.callHistory = this.callHistory.filter((call) => call.timestamp > oneMinuteAgo);

    // 2. Velocity Rate Limiting check
    if (this.callHistory.length >= this.maxCallsPerMinute) {
      const message = `Rate limit exceeded: Session reached maximum of ${this.maxCallsPerMinute} tool calls per minute. Throttling execution.`;
      logger.warn(message);
      return { allowed: false, reason: 'rate_limited', message };
    }

    // 3. Consecutive failure circuit breaker check
    const callKey = generateToolCallCacheKey(serverName, toolName, safeArgs);
    const failureCount = this.consecutiveFailures.get(callKey) ?? 0;

    if (failureCount >= this.consecutiveFailureThreshold) {
      const message = `Circuit breaker tripped: Tool "${toolName}" has failed ${failureCount} consecutive times with identical arguments. Please alter arguments or change strategy.`;
      logger.error(message);
      return { allowed: false, reason: 'circuit_breaker', message };
    }

    return { allowed: true };
  }

  /**
   * Checks if a tool call is permitted before execution.
   * Returns null if allowed, or an error string if blocked by guardrails.
   */
  checkPreFlight(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): string | null {
    const res = this.checkPreFlightDetailed(serverName, toolName, args);
    return res.allowed ? null : res.message!;
  }

  /**
   * Records execution outcome of a tool call.
   */
  recordCall(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
    isError: boolean = false
  ): void {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const now = Date.now();
    const callKey = generateToolCallCacheKey(serverName, toolName, safeArgs);

    this.callHistory.push({
      callKey,
      toolName,
      timestamp: now,
      isError,
    });

    if (isError) {
      const current = this.consecutiveFailures.get(callKey) ?? 0;
      this.consecutiveFailures.set(callKey, current + 1);

      // Memory safeguard: prevent unbounded map growth over long sessions
      if (this.consecutiveFailures.size > 500) {
        const firstKey = this.consecutiveFailures.keys().next().value;
        if (firstKey) {
          this.consecutiveFailures.delete(firstKey);
        }
      }
    } else {
      // Success resets failure count for this call signature
      this.consecutiveFailures.delete(callKey);
    }
  }

  /**
   * Resets all history and breakers.
   */
  reset(): void {
    this.callHistory = [];
    this.consecutiveFailures.clear();
  }
}

export const loopBreaker = new RunawayLoopBreaker();
