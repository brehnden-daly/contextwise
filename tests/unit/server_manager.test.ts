import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ServerManager } from '../../src/registry/manager.js';

describe('ServerManager', () => {
  const testConfigPath = resolve(__dirname, 'test_contextwise.json');

  beforeEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  afterEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should save and persist an upstream configuration', () => {
    const savedPath = ServerManager.saveUpstream(
      'test-server',
      {
        command: 'node',
        args: ['test.js'],
        env: { FOO: 'bar' },
        autoRestart: true,
      },
      testConfigPath
    );

    expect(existsSync(savedPath)).toBe(true);

    const content = JSON.parse(readFileSync(savedPath, 'utf-8'));
    expect(content.upstreams['test-server']).toBeDefined();
    expect(content.upstreams['test-server'].command).toBe('node');
    expect(content.upstreams['test-server'].env.FOO).toBe('bar');
  });

  it('should remove an upstream configuration', () => {
    ServerManager.saveUpstream(
      'to-remove',
      { command: 'node', args: [], env: {}, autoRestart: true },
      testConfigPath
    );

    const removed = ServerManager.removeUpstream('to-remove', testConfigPath);
    expect(removed).toBe(true);

    const content = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
    expect(content.upstreams['to-remove']).toBeUndefined();
  });
});
