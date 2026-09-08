import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/catalog/registry.js';
import { ContextRouter } from '../../src/router/router.js';
import {
  ADD_SERVER_NAME,
  BROWSE_SERVERS_NAME,
  EXECUTE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
} from '../../src/router/meta_tools.js';
import type { NamespacedTool } from '../../src/core/types.js';

describe('ToolRegistry & ContextRouter', () => {
  let registry: ToolRegistry;
  let router: ContextRouter;

  const mockTools: NamespacedTool[] = [
    {
      name: 'read_file',
      originalName: 'read_file',
      namespacedName: 'filesystem__read_file',
      serverName: 'filesystem',
      description: 'Read file contents from disk',
      inputSchema: { type: 'object' },
    },
    {
      name: 'git_status',
      originalName: 'git_status',
      namespacedName: 'git__git_status',
      serverName: 'git',
      description: 'Git status',
      inputSchema: { type: 'object' },
    },
    {
      name: 'postgres_query',
      originalName: 'postgres_query',
      namespacedName: 'postgres__postgres_query',
      serverName: 'postgres',
      description: 'Run SQL query in postgres database table',
      inputSchema: { type: 'object' },
    },
  ];

  beforeEach(() => {
    registry = new ToolRegistry({ maxActiveTools: 2 });
    registry.setAllTools(mockTools);
    router = new ContextRouter(
      {
        strategy: 'hybrid',
        pinnedTools: ['git__git_status'],
        topK: 2,
      },
      registry
    );
  });

  it('should expose search/execute meta-tools and pinned tools initially with browse/add gated off by default', () => {
    const exposed = router.getExposedTools();
    const names = exposed.map((t) => t.name);

    expect(names).toContain(SEARCH_TOOLS_NAME);
    expect(names).toContain(EXECUTE_TOOL_NAME);
    // browse_servers and add_server gated off by default (Finding 2.2)
    expect(names).not.toContain(BROWSE_SERVERS_NAME);
    expect(names).not.toContain(ADD_SERVER_NAME);
    expect(names).toContain('git__git_status');
    // Unpinned, non-hydrated tools should NOT be in context window
    expect(names).not.toContain('postgres__postgres_query');
  });

  it('should expose browse and add meta-tools when explicitly enabled', () => {
    const customRouter = new ContextRouter(
      {
        strategy: 'hybrid',
        pinnedTools: ['git__git_status'],
        topK: 2,
        enableBrowseServers: true,
        enableAddServer: true,
      },
      registry
    );
    const exposed = customRouter.getExposedTools();
    const names = exposed.map((t) => t.name);

    expect(names).toContain(SEARCH_TOOLS_NAME);
    expect(names).toContain(EXECUTE_TOOL_NAME);
    expect(names).toContain(BROWSE_SERVERS_NAME);
    expect(names).toContain(ADD_SERVER_NAME);
  });

  it('should search and hydrate matching tools dynamically', () => {
    const res = router.searchAndHydrate('postgres SQL query', undefined, 1, true);

    expect(res.foundTools.length).toBe(1);
    expect(res.foundTools[0].name).toBe('postgres__postgres_query');
    expect(res.activatedNewTools).toBe(true);

    // Now the active set in router includes postgres__postgres_query
    const exposed = router.getExposedTools();
    const names = exposed.map((t) => t.name);
    expect(names).toContain('postgres__postgres_query');
  });

  it('should dynamically include a capability manifest in search tools description when servers are connected', () => {
    const exposed = router.getExposedTools();
    const searchTool = exposed.find((t) => t.name === SEARCH_TOOLS_NAME);
    expect(searchTool).toBeDefined();
    expect(searchTool?.description).toContain('Connected MCP servers and available capabilities:');
    expect(searchTool?.description).toContain('• git (Local Git Repository): git_status');
    expect(searchTool?.description).toContain('• postgres (PostgreSQL Database): postgres_query');
  });

  it('should omit capability manifest in search tools description when no upstream servers are connected', () => {
    const emptyRegistry = new ToolRegistry();
    const emptyRouter = new ContextRouter({ strategy: 'hybrid' }, emptyRegistry);
    const exposed = emptyRouter.getExposedTools();
    const searchTool = exposed.find((t) => t.name === SEARCH_TOOLS_NAME);
    expect(searchTool).toBeDefined();
    expect(searchTool?.description).not.toContain('Connected MCP servers');
  });

  it('should expose all tools directly when in passthrough mode', () => {
    const passthroughRouter = new ContextRouter(
      { strategy: 'passthrough' },
      registry
    );
    const exposed = passthroughRouter.getExposedTools();

    expect(exposed.map((t) => t.name)).not.toContain(SEARCH_TOOLS_NAME);
    expect(exposed.length).toBe(mockTools.length);
  });
});
