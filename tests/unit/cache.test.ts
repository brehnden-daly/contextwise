import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCache } from '../../src/guardrails/cache.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache(60); // 60 second default TTL
  });

  it('should store and retrieve cached tool results', () => {
    const mockResult: CallToolResult = {
      content: [{ type: 'text', text: 'SELECT * FROM users result' }],
    };

    expect(cache.get('postgres', 'query', { sql: 'SELECT 1' })).toBeNull();

    cache.set('postgres', 'query', { sql: 'SELECT 1' }, mockResult);

    const cached = cache.get('postgres', 'query', { sql: 'SELECT 1' });
    expect(cached).toEqual(mockResult);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('should return cache miss for different arguments or servers', () => {
    const mockResult: CallToolResult = {
      content: [{ type: 'text', text: 'hello' }],
    };

    cache.set('postgres', 'query', { q: 'a' }, mockResult);

    expect(cache.get('postgres', 'query', { q: 'b' })).toBeNull();
    expect(cache.get('mysql', 'query', { q: 'a' })).toBeNull();
  });

  it('should invalidate all entries for a specific server', () => {
    const result1: CallToolResult = { content: [{ type: 'text', text: 'res1' }] };
    const result2: CallToolResult = { content: [{ type: 'text', text: 'res2' }] };
    const resultOther: CallToolResult = { content: [{ type: 'text', text: 'other' }] };

    cache.set('postgres', 'read1', {}, result1);
    cache.set('postgres', 'read2', {}, result2);
    cache.set('github', 'get_repo', {}, resultOther);

    expect(cache.getStats().size).toBe(3);

    const invalidated = cache.invalidateServer('postgres');
    expect(invalidated).toBe(2);

    expect(cache.get('postgres', 'read1', {})).toBeNull();
    expect(cache.get('postgres', 'read2', {})).toBeNull();
    expect(cache.get('github', 'get_repo', {})).toEqual(resultOther);
  });

  it('should not cache error responses', () => {
    const errorResult: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'Database error' }],
    };

    cache.set('postgres', 'query', { sql: 'BAD' }, errorResult);
    expect(cache.get('postgres', 'query', { sql: 'BAD' })).toBeNull();
  });
});
