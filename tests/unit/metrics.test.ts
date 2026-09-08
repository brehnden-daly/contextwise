import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MetricsCollector,
  calculateDollarSavings,
  SCHEMA_TOKENS_PER_TOOL,
  CACHE_TOKENS_PER_HIT,
  LOOP_PREVENTION_TOKENS_PER_TRIP,
  LLM_PRICING,
} from '../../src/metrics/collector.js';

describe('MetricsCollector and ROI Tracking', () => {
  let testFilePath: string;
  let collector: MetricsCollector;

  beforeEach(() => {
    testFilePath = join(tmpdir(), `contextwise_metrics_test_${Date.now()}_${Math.random().toString(36).substring(7)}.json`);
    collector = new MetricsCollector(testFilePath);
  });

  afterEach(() => {
    if (existsSync(testFilePath)) {
      try {
        unlinkSync(testFilePath);
      } catch {}
    }
  });

  it('should initialize with clean default values', () => {
    const summary = collector.getSummary();
    expect(summary.totalCalls).toBe(0);
    expect(summary.cachedCalls).toBe(0);
    expect(summary.errorCalls).toBe(0);
    expect(summary.loopsPrevented).toBe(0);
    expect(summary.estimatedTotalTokensSaved).toBe(0);
    expect(summary.dollarSavings.claudeSonnet).toBe(0);
  });

  it('should accurately calculate dollar savings across LLM models', () => {
    // 1,000,000 tokens
    const savings1M = calculateDollarSavings(1_000_000);
    expect(savings1M.claudeSonnet).toBe(LLM_PRICING.CLAUDE_SONNET);
    expect(savings1M.gpt4o).toBe(LLM_PRICING.GPT_4O);
    expect(savings1M.claudeOpus).toBe(LLM_PRICING.CLAUDE_OPUS);
    expect(savings1M.haikuOrMini).toBe(LLM_PRICING.HAIKU_OR_MINI);

    // 500,000 tokens
    const savingsHalfM = calculateDollarSavings(500_000);
    expect(savingsHalfM.claudeSonnet).toBe(1.50);
    expect(savingsHalfM.gpt4o).toBe(1.25);
    expect(savingsHalfM.claudeOpus).toBe(7.50);
  });

  it('should calculate schema pruning tokens saved', () => {
    // 50 total catalog tools, 10 exposed -> 40 avoided
    collector.recordSchemaPruning(50, 10);

    const summary = collector.getSummary();
    const expectedTokens = 40 * SCHEMA_TOKENS_PER_TOOL;
    expect(summary.schemaPruningTokensSaved).toBe(expectedTokens);
    expect(summary.estimatedTotalTokensSaved).toBe(expectedTokens);
    expect(summary.totalCatalogToolsCount).toBe(50);
    expect(summary.exposedToolsCount).toBe(10);
  });

  it('should calculate cache hit savings and hit rate percentage', () => {
    collector.updateToolCounts(30, 5);

    // 1 regular execution
    collector.recordExecution({
      toolName: 'query',
      serverName: 'postgres',
      latencyMs: 50,
      cached: false,
    });

    // 1 cached execution
    collector.recordExecution({
      toolName: 'query',
      serverName: 'postgres',
      latencyMs: 1,
      cached: true,
    });

    const summary = collector.getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.cachedCalls).toBe(1);
    expect(summary.cacheHitRatePct).toBe(50);
    expect(summary.cacheTokensSaved).toBe(CACHE_TOKENS_PER_HIT);
    expect(summary.averageLatencyMs).toBe(50);
  });

  it('should calculate loop prevention savings when circuit breaker trips', () => {
    collector.recordLoopPrevented('query', 'sqlite');
    collector.recordLoopPrevented('query', 'sqlite');

    const summary = collector.getSummary();
    expect(summary.loopsPrevented).toBe(2);
    expect(summary.loopPreventionTokensSaved).toBe(2 * LOOP_PREVENTION_TOKENS_PER_TRIP);
    expect(summary.estimatedTotalTokensSaved).toBe(2 * LOOP_PREVENTION_TOKENS_PER_TRIP);
  });

  it('should persist metrics across process restarts to disk', () => {
    collector.updateToolCounts(100, 10);
    collector.recordSchemaPruning(100, 10); // 90 * 150 = 13,500
    collector.recordExecution({
      toolName: 'read_data',
      serverName: 'database',
      latencyMs: 120,
      cached: false,
    }); // latency recorded; schema tokens not double counted
    collector.recordExecution({
      toolName: 'read_data',
      serverName: 'database',
      latencyMs: 1,
      cached: true,
    }); // 800
    collector.recordLoopPrevented('failing_tool', 'api'); // 2,500
    collector.recordThrottle('throttled_tool', 'api');
    collector.flushSync();

    expect(existsSync(testFilePath)).toBe(true);

    // Create a new collector instance pointing to same file (simulating CLI opening file)
    const secondCollector = new MetricsCollector(testFilePath);
    const restored = secondCollector.getSummary();

    expect(restored.totalCalls).toBe(2);
    expect(restored.cachedCalls).toBe(1);
    expect(restored.loopsPrevented).toBe(1);
    expect(restored.throttles).toBe(1);
    expect(restored.schemaPruningTokensSaved).toBe(13500);
    expect(restored.cacheTokensSaved).toBe(800);
    expect(restored.loopPreventionTokensSaved).toBe(2500);
    expect(restored.estimatedTotalTokensSaved).toBe(13500 + 800 + 2500);
  });

  it('should reset cumulative metrics cleanly', () => {
    collector.recordLoopPrevented();
    collector.recordExecution({
      toolName: 'test',
      serverName: 'srv',
      latencyMs: 10,
      cached: false,
    });
    collector.flushSync();

    expect(collector.getSummary().totalCalls).toBe(1);

    collector.reset();

    const freshSummary = collector.getSummary();
    expect(freshSummary.totalCalls).toBe(0);
    expect(freshSummary.estimatedTotalTokensSaved).toBe(0);
    expect(freshSummary.loopsPrevented).toBe(0);
  });
});
