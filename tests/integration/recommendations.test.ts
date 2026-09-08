import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ContextWiseProxy } from '../../src/core/proxy.js';
import {
  ADD_SERVER_NAME,
  EXECUTE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
} from '../../src/router/meta_tools.js';

describe('ContextWise Capability Gap Recommendations', () => {
  let proxy: ContextWiseProxy;

  beforeAll(async () => {
    proxy = new ContextWiseProxy();
  });

  afterAll(async () => {
    await proxy.getMultiplexer().closeAll();
  });

  it('should detect capability gap and recommend MCP servers when no tools match', async () => {
    // Current proxy has no database servers connected
    const res = await proxy.handleToolCall(SEARCH_TOOLS_NAME, {
      query: 'manage postgres database',
    });

    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;

    // Verify capability gap notification is present
    expect(text).toContain('Capability Gap Detected');
    expect(text).toContain('Recommended MCP servers to add');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain(ADD_SERVER_NAME);
  });

  it('should recommend server installation when executing an uninstalled tool', async () => {
    const res = await proxy.handleToolCall(EXECUTE_TOOL_NAME, {
      tool_name: 'postgres__query',
      arguments: { sql: 'SELECT 1' },
    });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;

    expect(text).toContain('Tool "postgres__query" was not found in ContextWise registry.');
    expect(text).toContain('Capability Gap Detected');
    expect(text).toContain(ADD_SERVER_NAME);
  });
});
