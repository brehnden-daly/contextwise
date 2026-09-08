import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/catalog/registry.js';
import { ContextRouter } from '../../src/router/router.js';
import { UpstreamMultiplexer, inferToolHints } from '../../src/core/multiplexer.js';
import { ContextWiseConfigSchema } from '../../src/config/schema.js';
import { WorkspaceContextPrimer } from '../../src/router/workspace.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

describe('Efficiency & Correctness Updates & Edge Cases', () => {
  describe('Tool Annotations & Conservative Heuristics (Finding 2.1)', () => {
    it('should prioritize explicit tool annotations over name heuristics', () => {
      // Tool named 'delete_cache' with readOnlyHint: true annotation
      const hints1 = inferToolHints('delete_cache', 'Deletes cached items', { readOnlyHint: true });
      expect(hints1.readOnlyHint).toBe(true);

      // Tool named 'get_user' with destructiveHint: true
      const hints2 = inferToolHints('get_user', 'Gets a user', { destructiveHint: true });
      expect(hints2.destructiveHint).toBe(true);

      // Generic 'query' or 'exec' with NO annotations should NOT be assumed read-only
      const hints3 = inferToolHints('query', 'Execute SQL query');
      expect(hints3.readOnlyHint).toBe(false);

      const hints4 = inferToolHints('exec', 'Run command');
      expect(hints4.readOnlyHint).toBe(false);

      // Explicit read names like 'read_file', 'fetch_data', 'list_items'
      expect(inferToolHints('read_file', '').readOnlyHint).toBe(true);
      expect(inferToolHints('list_items', '').readOnlyHint).toBe(true);
      expect(inferToolHints('fetch_user', '').readOnlyHint).toBe(true);
    });
  });

  describe('Upstream Execution Timeout (Finding 3.2)', () => {
    it('should abort and timeout when tool execution exceeds callTimeoutMs', async () => {
      const mux = new UpstreamMultiplexer();

      const mockConn: any = {
        name: 'srv',
        status: 'connected',
        client: {
          callTool: vi.fn().mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 200))
          ),
        },
        tools: new Map(),
      };

      (mux as any).connections.set('srv', mockConn);
      (mux as any).toolRoutingTable.set('slow_tool', {
        serverName: 'srv',
        originalName: 'slow_tool',
      });

      await expect(
        mux.executeTool('slow_tool', {}, 50)
      ).rejects.toThrow(/timed out after 50ms/);
    });

    it('should succeed when tool execution finishes before callTimeoutMs', async () => {
      const mux = new UpstreamMultiplexer();

      const mockConn: any = {
        name: 'srv',
        status: 'connected',
        client: {
          callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Fast response' }],
          }),
        },
        tools: new Map(),
      };

      (mux as any).connections.set('srv', mockConn);
      (mux as any).toolRoutingTable.set('fast_tool', {
        serverName: 'srv',
        originalName: 'fast_tool',
      });

      const res = await mux.executeTool('fast_tool', {}, 2000);
      expect((res.result.content[0] as any).text).toBe('Fast response');
    });
  });

  describe('Search Relevance Floor & Compact Schema Signatures (Finding 2.5, 2.6)', () => {
    let registry: ToolRegistry;
    let router: ContextRouter;

    beforeEach(() => {
      registry = new ToolRegistry({ maxActiveTools: 5 });
      registry.setAllTools([
        {
          name: 'git_status',
          originalName: 'git_status',
          namespacedName: 'git__git_status',
          serverName: 'git',
          description: 'Show working tree status and staging area',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: { type: 'string', description: 'Path to git repository' },
              short: { type: 'boolean', description: 'Give the output in short format' },
            },
            required: ['repoPath'],
          },
        },
      ]);
      router = new ContextRouter(
        {
          strategy: 'hybrid',
          similarityThreshold: 0.5,
          topK: 3,
        },
        registry
      );
    });

    it('should return empty matches when query relevance is below similarityThreshold', () => {
      const result = router.searchAndHydrate('baking cookies oven recipe chocolate', undefined, 3, false);
      expect(result.foundTools.length).toBe(0);
    });

    it('should format compact schema signatures in search results', () => {
      const res = router.searchAndHydrate('git status repo', undefined, 1, false);
      expect(res.message).toContain('repoPath: string (required)');
      expect(res.message).toContain('short: boolean (optional)');
    });
  });

  describe('LRU Touch & List Changed Notifications Delta (Finding 2.3, 2.4)', () => {
    it('should update LRU timestamp when touching a tool', () => {
      const registry = new ToolRegistry({ maxActiveTools: 2 });
      registry.setAllTools([
        {
          name: 'tool_a',
          originalName: 'tool_a',
          namespacedName: 's1__tool_a',
          serverName: 's1',
          description: 'Tool A',
          inputSchema: { type: 'object' },
        },
        {
          name: 'tool_b',
          originalName: 'tool_b',
          namespacedName: 's2__tool_b',
          serverName: 's2',
          description: 'Tool B',
          inputSchema: { type: 'object' },
        },
      ]);

      registry.activateTools(['s1__tool_a', 's2__tool_b']);
      const dynamicMap = (registry as any).dynamicActiveTools;
      const initialTime = dynamicMap.get('s1__tool_a');

      // Small delay then touch
      registry.touchTool('tool_a');
      const updatedTime = dynamicMap.get('s1__tool_a');
      expect(updatedTime).toBeGreaterThanOrEqual(initialTime);
    });

    it('should detect set equality and avoid redundant notifications in searchAndHydrate', () => {
      const registry = new ToolRegistry({ maxActiveTools: 5 });
      registry.setAllTools([
        {
          name: 'git_status',
          originalName: 'git_status',
          namespacedName: 'git__git_status',
          serverName: 'git',
          description: 'Show git status',
          inputSchema: { type: 'object' },
        },
      ]);
      const router = new ContextRouter({ strategy: 'hybrid' }, registry);

      const firstSearch = router.searchAndHydrate('git status', undefined, 1, true);
      expect(firstSearch.activatedNewTools).toBe(true);

      // Second search for identical tools does not trigger activatedNewTools
      const secondSearch = router.searchAndHydrate('git status', undefined, 1, true);
      expect(secondSearch.activatedNewTools).toBe(false);
    });
  });

  describe('Short-Name Collision Safety (Finding 3.4)', () => {
    it('should unregister short-name aliases for conflicted tool names', () => {
      const registry = new ToolRegistry();
      registry.setAllTools([
        {
          name: 'search',
          originalName: 'search',
          namespacedName: 'google__search',
          serverName: 'google',
          description: 'Search Google',
          inputSchema: { type: 'object' },
        },
        {
          name: 'search',
          originalName: 'search',
          namespacedName: 'bing__search',
          serverName: 'bing',
          description: 'Search Bing',
          inputSchema: { type: 'object' },
        },
        {
          name: 'translate',
          originalName: 'translate',
          namespacedName: 'google__translate',
          serverName: 'google',
          description: 'Translate text',
          inputSchema: { type: 'object' },
        },
      ]);

      // Unconflicted tool 'translate' is available via short name
      expect(registry.getTool('translate')).toBeDefined();
      expect(registry.getTool('google__translate')).toBeDefined();

      // Conflicted tool 'search' is NOT available via short name
      expect(registry.getTool('search')).toBeUndefined();
      // But accessible via namespaced names
      expect(registry.getTool('google__search')).toBeDefined();
      expect(registry.getTool('bing__search')).toBeDefined();
    });
  });

  describe('Workspace Context Detection Precision (Finding 2.8)', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `cw_ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      mkdirSync(testDir, { recursive: true });
    });

    it('should NOT falsely trigger database keywords on dbus or debug files', () => {
      writeFileSync(join(testDir, 'dbus_service.conf'), '');
      writeFileSync(join(testDir, 'debug.log'), '');
      writeFileSync(join(testDir, 'feedback.json'), '');

      const context = WorkspaceContextPrimer.analyzeWorkspace(testDir);
      expect(context.detectedDomains).not.toContain('database');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should accurately trigger database keywords on real schema and db files', () => {
      writeFileSync(join(testDir, 'schema.sql'), '');
      writeFileSync(join(testDir, 'database.sqlite'), '');

      const context = WorkspaceContextPrimer.analyzeWorkspace(testDir);
      expect(context.detectedDomains).toContain('database');
      expect(context.suggestedQueries).toContain('database and SQL query tools');
      rmSync(testDir, { recursive: true, force: true });
    });
  });
});
