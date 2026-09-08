import { describe, it, expect } from 'vitest';
import { KnownServerRegistry } from '../../src/registry/known_servers.js';

import { isStdioUpstream } from '../../src/config/schema.js';

describe('KnownServerRegistry', () => {
  it('should have verified servers populated', () => {
    const all = KnownServerRegistry.getAll();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((s) => s.id === 'postgres')).toBe(true);
    expect(all.some((s) => s.id === 'github')).toBe(true);
    expect(all.some((s) => s.id === 'fetch')).toBe(true);
  });

  it('should search by category', () => {
    const databases = KnownServerRegistry.search(undefined, 'database');
    expect(databases.length).toBeGreaterThanOrEqual(2);
    expect(databases.every((s) => s.category === 'database')).toBe(true);
  });

  it('should search by keyword query', () => {
    const gitServers = KnownServerRegistry.search('github');
    expect(gitServers.length).toBeGreaterThan(0);
    expect(gitServers[0].id).toBe('github');
  });

  it('should build upstream config with custom parameters', () => {
    const pg = KnownServerRegistry.find('postgres');
    expect(pg).toBeDefined();

    const config = KnownServerRegistry.buildConfig(pg!, {
      args: ['postgresql://localhost:5432/testdb'],
      env: { PGSSLMODE: 'require' },
    });

    expect(isStdioUpstream(config)).toBe(true);
    if (isStdioUpstream(config)) {
      expect(config.command).toBe('npx');
      expect(config.args).toContain('postgresql://localhost:5432/testdb');
      expect(config.env).toEqual({ PGSSLMODE: 'require' });
    }
  });
});
