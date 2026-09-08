import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface ExecutionMetric {
  timestamp: number;
  toolName: string;
  serverName: string;
  latencyMs: number;
  cached: boolean;
  tokensSavedEstimate: number;
  isError: boolean;
}

export interface DollarSavings {
  claudeSonnet: number;
  gpt4o: number;
  claudeOpus: number;
  haikuOrMini: number;
}

export interface MetricsSummary {
  firstRecordedAt: number;
  lastRecordedAt: number;
  totalCalls: number;
  cachedCalls: number;
  cacheHitRatePct: number;
  errorCalls: number;
  throttles: number;
  loopsPrevented: number;
  averageLatencyMs: number;
  schemaPruningTokensSaved: number;
  cacheTokensSaved: number;
  loopPreventionTokensSaved: number;
  estimatedTotalTokensSaved: number;
  dollarSavings: DollarSavings;
  activeUpstreamsCount: number;
  totalCatalogToolsCount: number;
  exposedToolsCount: number;
}

export interface PersistentMetricsData {
  version: number;
  firstRecordedAt: number;
  lastRecordedAt: number;
  totalCalls: number;
  cachedCalls: number;
  errorCalls: number;
  throttles: number;
  loopsPrevented: number;
  totalLatencyMs: number;
  schemaPruningTokensSaved: number;
  cacheTokensSaved: number;
  loopPreventionTokensSaved: number;
  totalTokensSaved: number;
  recentCalls: ExecutionMetric[];
}

/**
 * Average token constants derived from MCP protocol benchmarks
 */
export const SCHEMA_TOKENS_PER_TOOL = 150;
export const CACHE_TOKENS_PER_HIT = 800;
export const LOOP_PREVENTION_TOKENS_PER_TRIP = 2500;

/**
 * Standard LLM input pricing per 1,000,000 tokens ($ USD)
 */
export const LLM_PRICING = {
  CLAUDE_SONNET: 3.0,     // Claude 3.5 & 3.7 Sonnet ($3.00 / 1M)
  GPT_4O: 2.5,            // OpenAI GPT-4o ($2.50 / 1M)
  CLAUDE_OPUS: 15.0,      // Claude 3 Opus ($15.00 / 1M)
  HAIKU_OR_MINI: 0.25,    // Claude 3.5 Haiku / GPT-4o mini ($0.25 / 1M)
} as const;

export function calculateDollarSavings(tokens: number): DollarSavings {
  return {
    claudeSonnet: Number(((tokens / 1_000_000) * LLM_PRICING.CLAUDE_SONNET).toFixed(2)),
    gpt4o: Number(((tokens / 1_000_000) * LLM_PRICING.GPT_4O).toFixed(2)),
    claudeOpus: Number(((tokens / 1_000_000) * LLM_PRICING.CLAUDE_OPUS).toFixed(2)),
    haikuOrMini: Number(((tokens / 1_000_000) * LLM_PRICING.HAIKU_OR_MINI).toFixed(2)),
  };
}

export function getDefaultMetricsPath(): string {
  if (process.env.CONTEXTWISE_METRICS_PATH) {
    return process.env.CONTEXTWISE_METRICS_PATH;
  }
  return join(homedir(), '.contextwise', 'metrics.json');
}

export class MetricsCollector {
  private storagePath: string;
  private totalCatalogTools: number = 0;
  private currentlyExposedTools: number = 0;
  private debounceTimer: NodeJS.Timeout | null = null;
  private data: PersistentMetricsData;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ?? getDefaultMetricsPath();
    this.data = this.createDefaultData();
    this.loadFromDisk();
  }

  private createDefaultData(): PersistentMetricsData {
    const now = Date.now();
    return {
      version: 1,
      firstRecordedAt: now,
      lastRecordedAt: now,
      totalCalls: 0,
      cachedCalls: 0,
      errorCalls: 0,
      throttles: 0,
      loopsPrevented: 0,
      totalLatencyMs: 0,
      schemaPruningTokensSaved: 0,
      cacheTokensSaved: 0,
      loopPreventionTokensSaved: 0,
      totalTokensSaved: 0,
      recentCalls: [],
    };
  }

  setStoragePath(path: string): void {
    this.storagePath = path;
    this.data = this.createDefaultData();
    this.loadFromDisk();
  }

  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Reloads persisted state from disk.
   */
  reload(): void {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.data = {
            ...this.createDefaultData(),
            ...parsed,
          };
          logger.debug(`Loaded metrics from ${this.storagePath}`);
        }
      }
    } catch (err) {
      logger.debug(`Could not load metrics from ${this.storagePath}: ${err}`);
    }
  }

  /**
   * Schedules a debounced disk flush.
   */
  private schedulePersist(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushSync();
    }, 200);
  }

  /**
   * Synchronously writes metrics to disk.
   */
  flushSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const tempFile = `${this.storagePath}.${Date.now()}.tmp`;
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(tempFile, json, 'utf-8');
      renameSync(tempFile, this.storagePath);
    } catch {
      // Fallback: direct write if rename fails (e.g. cross-volume / windows permissions)
      try {
        writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (err) {
        logger.debug(`Failed persisting metrics: ${err}`);
      }
    }
  }

  /**
   * Updates catalog sizing to calculate per-turn token savings.
   */
  updateToolCounts(catalogTotal: number, exposedTotal: number): void {
    this.totalCatalogTools = catalogTotal;
    this.currentlyExposedTools = exposedTotal;
  }

  /**
   * Records savings from pruning tools during schema listing.
   */
  recordSchemaPruning(catalogTotal: number, exposedTotal: number): void {
    this.updateToolCounts(catalogTotal, exposedTotal);
    const avoidedTools = Math.max(0, catalogTotal - exposedTotal);
    const tokensSaved = avoidedTools * SCHEMA_TOKENS_PER_TOOL;

    this.data.schemaPruningTokensSaved += tokensSaved;
    this.data.totalTokensSaved =
      this.data.schemaPruningTokensSaved +
      this.data.cacheTokensSaved +
      this.data.loopPreventionTokensSaved;
    this.data.lastRecordedAt = Date.now();

    this.schedulePersist();
  }

  /**
   * Records a caught/prevented runaway loop or circuit breaker trip.
   */
  recordLoopPrevented(toolName?: string, serverName?: string): void {
    this.data.loopsPrevented += 1;
    this.data.loopPreventionTokensSaved += LOOP_PREVENTION_TOKENS_PER_TRIP;
    this.data.totalTokensSaved =
      this.data.schemaPruningTokensSaved +
      this.data.cacheTokensSaved +
      this.data.loopPreventionTokensSaved;
    this.data.lastRecordedAt = Date.now();

    logger.debug(
      `Recorded prevented loop for ${toolName ?? 'unknown'} on ${serverName ?? 'unknown'} (saved ~${LOOP_PREVENTION_TOKENS_PER_TRIP} tokens)`
    );

    this.schedulePersist();
  }

  /**
   * Records a rate-limit velocity throttle event (tracked separately from circuit trips).
   */
  recordThrottle(toolName?: string, serverName?: string): void {
    this.data.throttles = (this.data.throttles || 0) + 1;
    this.data.lastRecordedAt = Date.now();
    logger.debug(
      `Recorded rate limit throttle for ${toolName ?? 'unknown'} on ${serverName ?? 'unknown'}`
    );
    this.schedulePersist();
  }

  /**
   * Records a tool execution.
   */
  recordExecution(params: {
    toolName: string;
    serverName: string;
    latencyMs: number;
    cached: boolean;
    isError?: boolean;
  }): void {
    const isError = params.isError ?? false;
    let tokensSavedThisCall = 0;

    this.data.totalCalls += 1;
    this.data.lastRecordedAt = Date.now();

    if (params.cached) {
      this.data.cachedCalls += 1;
      this.data.cacheTokensSaved += CACHE_TOKENS_PER_HIT;
      tokensSavedThisCall = CACHE_TOKENS_PER_HIT;
    } else {
      // Non-cached calls record latency; schema pruning tokens are accounted for on tools/list requests
      tokensSavedThisCall = 0;
      this.data.totalLatencyMs += params.latencyMs;
    }

    if (isError) {
      this.data.errorCalls += 1;
    }

    this.data.totalTokensSaved =
      this.data.schemaPruningTokensSaved +
      this.data.cacheTokensSaved +
      this.data.loopPreventionTokensSaved;

    const metric: ExecutionMetric = {
      timestamp: Date.now(),
      toolName: params.toolName,
      serverName: params.serverName,
      latencyMs: params.latencyMs,
      cached: params.cached,
      tokensSavedEstimate: tokensSavedThisCall,
      isError,
    };

    this.data.recentCalls.push(metric);
    if (this.data.recentCalls.length > 100) {
      this.data.recentCalls.shift();
    }

    logger.debug(
      `Recorded metric for ${params.toolName} (latency: ${params.latencyMs}ms, cached: ${params.cached}, saved ~${tokensSavedThisCall} tokens)`
    );

    this.schedulePersist();
  }

  /**
   * Returns aggregated metrics summary with dollar ROI calculations.
   */
  getSummary(activeUpstreamsCount: number = 0): MetricsSummary {
    const totalCalls = this.data.totalCalls;
    const cachedCalls = this.data.cachedCalls;
    const errorCalls = this.data.errorCalls;
    const throttles = this.data.throttles || 0;
    const loopsPrevented = this.data.loopsPrevented;
    const executedCalls = totalCalls - cachedCalls;

    const averageLatencyMs =
      executedCalls > 0 ? Math.round(this.data.totalLatencyMs / executedCalls) : 0;
    const cacheHitRatePct =
      totalCalls > 0 ? Math.round((cachedCalls / totalCalls) * 100) : 0;

    const totalTokensSaved = this.data.totalTokensSaved;
    const dollarSavings = calculateDollarSavings(totalTokensSaved);

    return {
      firstRecordedAt: this.data.firstRecordedAt,
      lastRecordedAt: this.data.lastRecordedAt,
      totalCalls,
      cachedCalls,
      cacheHitRatePct,
      errorCalls,
      throttles,
      loopsPrevented,
      averageLatencyMs,
      schemaPruningTokensSaved: this.data.schemaPruningTokensSaved,
      cacheTokensSaved: this.data.cacheTokensSaved,
      loopPreventionTokensSaved: this.data.loopPreventionTokensSaved,
      estimatedTotalTokensSaved: totalTokensSaved,
      dollarSavings,
      activeUpstreamsCount,
      totalCatalogToolsCount: this.totalCatalogTools,
      exposedToolsCount: this.currentlyExposedTools,
    };
  }

  /**
   * Clears recorded metrics on disk and memory.
   */
  reset(): void {
    this.data = this.createDefaultData();
    this.flushSync();
  }
}

export const metricsCollector = new MetricsCollector();
