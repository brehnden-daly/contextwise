import { describe, it, expect } from 'vitest';
import { UnifiedRegistryClient } from '../../src/registry/remote_registry.js';
import { OfficialRegistryClient } from '../../src/registry/official_client.js';
import { SmitheryClient } from '../../src/registry/smithery_client.js';
import { isStdioUpstream } from '../../src/config/schema.js';

describe('Remote & Multi-Registry Discovery', () => {
  it('should search local curated presets with appropriate labels', async () => {
    const results = await UnifiedRegistryClient.search({
      source: 'curated',
      query: 'postgres',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('curated');
    expect(results[0].sourceLabel).toBe('Curated / Verified');
  });

  it('should query the Official MCP Registry API and return labeled items', async () => {
    const results = await OfficialRegistryClient.search('github', 2, 4000);
    // If online, returns items from official registry; if offline, gracefully returns empty array
    if (results.length > 0) {
      expect(results[0].source).toBe('official');
      expect(results[0].sourceLabel).toBe('Official MCP Registry');
      expect(results[0].id).toBeDefined();
    }
  });

  it('should query the Smithery API and return labeled items with install hints', async () => {
    const results = await SmitheryClient.search('github', undefined, 4000);
    // If online, returns items from Smithery; if offline, gracefully returns empty array
    if (results.length > 0) {
      expect(results[0].source).toBe('smithery');
      expect(results[0].sourceLabel).toBe('Smithery');
      expect(results[0].installHint).toContain('--smithery');
    }
  });

  it('should build valid @smithery/cli runner configuration', () => {
    const config = SmitheryClient.buildServerConfig('@smithery-ai/github', {
      apiKey: 'test-key',
    });

    expect(isStdioUpstream(config)).toBe(true);
    if (isStdioUpstream(config)) {
      expect(config.command).toBe('npx');
      expect(config.args).toContain('@smithery/cli@latest');
      expect(config.args).toContain('@smithery-ai/github');
      expect(config.env?.SMITHERY_API_KEY).toBe('test-key');
    }
  });

  it('should query all registries and include source attribution badges', async () => {
    const results = await UnifiedRegistryClient.search({
      query: 'postgres',
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(['curated', 'official', 'smithery']).toContain(r.source);
      expect(r.sourceLabel).toBeDefined();
    }
  });
});
