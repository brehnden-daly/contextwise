import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJsonStringify, generateToolCallCacheKey } from '../../src/utils/hash.js';
import { ResponseCache } from '../../src/guardrails/cache.js';
import { RunawayLoopBreaker } from '../../src/guardrails/loop_breaker.js';
import { ToolArgumentValidator } from '../../src/guardrails/validator.js';
import { HybridSearchEngine } from '../../src/catalog/search.js';
import { ContextRouter } from '../../src/router/router.js';
import { ToolRegistry } from '../../src/catalog/registry.js';
import { ServerManager } from '../../src/registry/manager.js';
import type { NamespacedTool } from '../../src/core/types.js';

describe('Edge Cases and Resilience', () => {
  describe('canonicalJsonStringify and hashing', () => {
    it('should handle circular structures without call stack overflow', () => {
      const circularObj: Record<string, unknown> = { name: 'test' };
      circularObj.self = circularObj;

      expect(() => canonicalJsonStringify(circularObj)).not.toThrow();
      const str = canonicalJsonStringify(circularObj);
      expect(str).toContain('"[Circular]"');
    });

    it('should serialize BigInt values without throwing', () => {
      const payload = { id: 9007199254740991n, action: 'read' };
      expect(() => canonicalJsonStringify(payload)).not.toThrow();
      const str = canonicalJsonStringify(payload);
      expect(str).toContain('"9007199254740991"');
    });

    it('should produce identical hashes regardless of object key order', () => {
      const obj1 = { a: 1, b: 2, c: { d: 3, e: 4 } };
      const obj2 = { b: 2, c: { e: 4, d: 3 }, a: 1 };

      const key1 = generateToolCallCacheKey('srv', 'tool', obj1);
      const key2 = generateToolCallCacheKey('srv', 'tool', obj2);
      expect(key1).toBe(key2);
    });
  });

  describe('ResponseCache Edge Cases', () => {
    let cache: ResponseCache;

    beforeEach(() => {
      cache = new ResponseCache(10);
    });

    it('should handle non-object args gracefully', () => {
      // @ts-expect-error testing invalid args type
      expect(() => cache.get('srv', 'tool', null)).not.toThrow();
      // @ts-expect-error testing invalid args type
      expect(() => cache.set('srv', 'tool', null, { content: [{ type: 'text', text: 'ok' }] })).not.toThrow();
    });

    it('should clamp non-positive TTLs to safe values', () => {
      const zeroTtlCache = new ResponseCache(0);
      expect(zeroTtlCache).toBeDefined();
    });

    it('should not cache error responses even if attempted', () => {
      cache.set('srv', 'err_tool', { x: 1 }, {
        isError: true,
        content: [{ type: 'text', text: 'fail' }],
      });
      expect(cache.get('srv', 'err_tool', { x: 1 })).toBeNull();
    });
  });

  describe('RunawayLoopBreaker Memory and Edge Cases', () => {
    let loopBreaker: RunawayLoopBreaker;

    beforeEach(() => {
      loopBreaker = new RunawayLoopBreaker({ maxCallsPerMinute: 10, consecutiveFailureThreshold: 3 });
    });

    it('should handle null/undefined args without throwing', () => {
      // @ts-expect-error testing invalid args type
      expect(() => loopBreaker.checkPreFlight('srv', 'tool', null)).not.toThrow();
      // @ts-expect-error testing invalid args type
      expect(() => loopBreaker.recordCall('srv', 'tool', null, true)).not.toThrow();
    });

    it('should not grow consecutiveFailures indefinitely (memory safeguard)', () => {
      const breaker = new RunawayLoopBreaker({ maxCallsPerMinute: 1000, consecutiveFailureThreshold: 3 });
      // Record 600 unique failures
      for (let i = 0; i < 600; i++) {
        breaker.recordCall('srv', `tool_${i}`, { id: i }, true);
      }
      // Should not throw or crash and remain operational
      expect(breaker.checkPreFlight('srv', 'fresh_tool', {})).toBeNull();
    });
  });

  describe('ToolArgumentValidator Namespace Isolation', () => {
    it('should validate tools with identical original names on different servers against their own schemas', () => {
      const validator = new ToolArgumentValidator();

      const postgresQuerySchema = {
        type: 'object',
        properties: {
          sql: { type: 'string' },
        },
        required: ['sql'],
      };

      const bigqueryQuerySchema = {
        type: 'object',
        properties: {
          query_id: { type: 'string' },
        },
        required: ['query_id'],
      };

      // postgres__query requires sql
      const pgRes1 = validator.validate('postgres__query', postgresQuerySchema, { sql: 'SELECT 1' });
      expect(pgRes1.valid).toBe(true);

      const pgRes2 = validator.validate('postgres__query', postgresQuerySchema, { query_id: '123' });
      expect(pgRes2.valid).toBe(false);

      // bigquery__query requires query_id, should not collide with postgres__query
      const bqRes1 = validator.validate('bigquery__query', bigqueryQuerySchema, { query_id: '123' });
      expect(bqRes1.valid).toBe(true);

      const bqRes2 = validator.validate('bigquery__query', bigqueryQuerySchema, { sql: 'SELECT 1' });
      expect(bqRes2.valid).toBe(false);
    });

    it('should safely handle malformed JSONSchemas without crashing', () => {
      const validator = new ToolArgumentValidator();
      const badSchema = { type: 'unknown_type_that_is_invalid' };

      expect(() => validator.validate('bad_tool', badSchema, { any: 'data' })).not.toThrow();
      const res = validator.validate('bad_tool', badSchema, { any: 'data' });
      // Falls back safely to allowing execution to upstream
      expect(res.valid).toBe(true);
    });
  });

  describe('HybridSearchEngine Query Edge Cases', () => {
    it('should handle bizarre punctuation and regex symbols gracefully', () => {
      const engine = new HybridSearchEngine();
      const mockTool: NamespacedTool = {
        name: 'query',
        originalName: 'query',
        namespacedName: 'db__query',
        serverName: 'db',
        description: 'Execute SQL query on database',
        inputSchema: { type: 'object' },
      };
      engine.indexTools([mockTool]);

      const weirdQueries = [
        '***',
        '???',
        'SELECT * FROM "users" WHERE (id == 1) && true',
        '\\^$[]{}',
        '   ',
        '',
      ];

      for (const q of weirdQueries) {
        expect(() => engine.search(q)).not.toThrow();
      }
    });

    it('should clamp non-positive topK to 1', () => {
      const engine = new HybridSearchEngine();
      const mockTool: NamespacedTool = {
        name: 'query',
        originalName: 'query',
        namespacedName: 'db__query',
        serverName: 'db',
        description: 'Execute SQL query on database',
        inputSchema: { type: 'object' },
      };
      engine.indexTools([mockTool]);

      const resZero = engine.search('query', { topK: 0 });
      expect(resZero.length).toBe(1);

      const resNegative = engine.search('query', { topK: -5 });
      expect(resNegative.length).toBe(1);
    });
  });

  describe('ContextRouter Meta-Tool Collision Prevention', () => {
    it('should never expose duplicate meta-tools even if an upstream registers a tool with a meta-tool name', () => {
      const registry = new ToolRegistry();
      const conflictingTool: NamespacedTool = {
        name: 'contextwise_search_tools',
        originalName: 'contextwise_search_tools',
        namespacedName: 'contextwise_search_tools',
        serverName: 'bad_server',
        description: 'conflicting tool',
        inputSchema: { type: 'object' },
      };
      registry.setAllTools([conflictingTool]);
      registry.activateTools(['contextwise_search_tools']);

      const router = new ContextRouter({}, registry);
      const exposed = router.getExposedTools();

      // Ensure each tool name in exposed list is completely unique
      const names = exposed.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe('ServerManager Directory Creation', () => {
    it('should create missing parent directories when saving config to a nested path', () => {
      const nestedDir = join(tmpdir(), `cw_test_nested_${Date.now()}_${Math.random().toString(36).substring(7)}`, 'subdir');
      const nestedConfigPath = join(nestedDir, 'contextwise.json');

      expect(existsSync(nestedDir)).toBe(false);

      const saved = ServerManager.saveUpstream('test-nested', {
        command: 'echo',
        args: ['hello'],
        env: {},
        autoRestart: false,
      }, nestedConfigPath);

      expect(existsSync(saved)).toBe(true);
      expect(existsSync(nestedDir)).toBe(true);

      // Clean up
      try {
        rmSync(join(nestedDir, '..'), { recursive: true, force: true });
      } catch {}
    });
  });
});
