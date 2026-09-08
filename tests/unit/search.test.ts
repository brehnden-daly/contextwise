import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchEngine } from '../../src/catalog/search.js';
import { ToolNormalizer } from '../../src/catalog/normalizer.js';
import type { NamespacedTool } from '../../src/core/types.js';

describe('HybridSearchEngine & ToolNormalizer', () => {
  let searchEngine: HybridSearchEngine;

  const mockTools: NamespacedTool[] = [
    {
      name: 'query',
      originalName: 'query',
      namespacedName: 'postgres__query',
      serverName: 'postgres',
      description: 'Execute a SQL query against PostgreSQL database and inspect tables',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL statement to execute' },
        },
        required: ['sql'],
      },
      readOnlyHint: true,
    },
    {
      name: 'git_status',
      originalName: 'git_status',
      namespacedName: 'git__git_status',
      serverName: 'git',
      description: 'Show the working tree status and modified files in repository',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      readOnlyHint: true,
    },
    {
      name: 'read_file',
      originalName: 'read_file',
      namespacedName: 'filesystem__read_file',
      serverName: 'filesystem',
      description: 'Read contents of a file from disk',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
        },
        required: ['path'],
      },
      readOnlyHint: true,
    },
    {
      name: 'delete_container',
      originalName: 'delete_container',
      namespacedName: 'docker__delete_container',
      serverName: 'docker',
      description: 'Force delete a docker container image or instance',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container ID' },
        },
      },
      destructiveHint: true,
    },
  ];

  beforeEach(() => {
    searchEngine = new HybridSearchEngine();
    searchEngine.indexTools(mockTools);
  });

  it('should infer appropriate tags and hints', () => {
    const pgTags = ToolNormalizer.inferTags(mockTools[0]);
    expect(pgTags).toContain('database');
    expect(pgTags).toContain('read-only');

    const dockerTags = ToolNormalizer.inferTags(mockTools[3]);
    expect(dockerTags).toContain('docker');
    expect(dockerTags).toContain('destructive');
  });

  it('should retrieve tools by natural language query', () => {
    const results = searchEngine.search('inspect sql tables database');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.namespacedName).toBe('postgres__query');
  });

  it('should retrieve tools by exact tool name match', () => {
    const results = searchEngine.search('git_status');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.namespacedName).toBe('git__git_status');
  });

  it('should filter by domain tag', () => {
    const results = searchEngine.search('read', { domain: 'filesystem' });
    expect(results.length).toBe(1);
    expect(results[0].tool.namespacedName).toBe('filesystem__read_file');
  });

  it('should filter by server name', () => {
    const results = searchEngine.search('query', { serverName: 'postgres' });
    expect(results.length).toBe(1);
    expect(results[0].tool.serverName).toBe('postgres');
  });
});
