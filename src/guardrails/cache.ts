import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { generateToolCallCacheKey } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

interface CacheEntry {
  key: string;
  serverName: string;
  toolName: string;
  result: CallToolResult;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  invalidations: number;
}

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTtlMs: number;
  private hits: number = 0;
  private misses: number = 0;
  private invalidations: number = 0;

  constructor(defaultTtlSeconds: number = 120) {
    this.defaultTtlMs = Math.max(1, defaultTtlSeconds || 120) * 1000;
  }

  setTtlSeconds(seconds: number): void {
    this.defaultTtlMs = Math.max(1, seconds || 120) * 1000;
  }

  /**
   * Retrieves a cached result if available and unexpired.
   */
  get(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): CallToolResult | null {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const key = generateToolCallCacheKey(serverName, toolName, safeArgs);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    logger.debug(`Cache HIT for [${serverName}] ${toolName}`);
    return entry.result;
  }

  /**
   * Stores a tool result in the cache.
   */
  set(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
    result: CallToolResult,
    ttlMs?: number
  ): void {
    // Only cache successful results without error flags
    if (!result || result.isError) return;

    const safeArgs = args && typeof args === 'object' ? args : {};
    const key = generateToolCallCacheKey(serverName, toolName, safeArgs);
    const effectiveTtl = Math.max(1000, ttlMs ?? this.defaultTtlMs);
    const expiresAt = Date.now() + effectiveTtl;

    // Memory safeguard: evict expired or oldest if cache size reaches 1,000 entries
    if (this.cache.size >= 1000) {
      const now = Date.now();
      for (const [k, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(k);
        }
      }
      if (this.cache.size >= 1000) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      key,
      serverName,
      toolName,
      result,
      expiresAt,
    });

    logger.debug(`Cached result for [${serverName}] ${toolName} (TTL: ${Math.round((ttlMs ?? this.defaultTtlMs) / 1000)}s)`);
  }

  /**
   * Invalidates all cache entries for a specific server (e.g. after a mutating call).
   */
  invalidateServer(serverName: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.serverName === serverName) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.invalidations += count;
      logger.debug(`Invalidated ${count} cache entries for server [${serverName}]`);
    }
    return count;
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Returns cache metrics.
   */
  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      invalidations: this.invalidations,
    };
  }
}

export const responseCache = new ResponseCache();
