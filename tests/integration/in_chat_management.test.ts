import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { ContextWiseProxy } from '../../src/core/proxy.js';
import {
  ADD_SERVER_NAME,
  BROWSE_SERVERS_NAME,
  EXECUTE_TOOL_NAME,
} from '../../src/router/meta_tools.js';

describe('In-Chat Server Management Meta-Tools', () => {
  let proxy: ContextWiseProxy;
  const mockServerPath = resolve(__dirname, '../mocks/mock_server.js');
  const tempConfigPath = resolve(__dirname, '../mocks/temp_in_chat_test_contextwise.json');

  beforeAll(async () => {
    process.env.CONTEXTWISE_CONFIG = tempConfigPath;
    proxy = new ContextWiseProxy();
    // Enable add_server and browse_servers for this test suite
    proxy.getRouter().updateConfig({
      enableBrowseServers: true,
      enableAddServer: true,
      allowCustomCommands: true,
      persistAddedServers: true,
    });
  });

  afterAll(async () => {
    await proxy.getMultiplexer().closeAll();
    const { ServerManager } = await import('../../src/registry/manager.js');
    ServerManager.removeUpstream('dynamic_mock', tempConfigPath);
    if (existsSync(tempConfigPath)) {
      try { unlinkSync(tempConfigPath); } catch {}
    }
    delete process.env.CONTEXTWISE_CONFIG;
  });

  it('should browse verified servers using contextwise_browse_servers', async () => {
    const res = await proxy.handleToolCall(BROWSE_SERVERS_NAME, {
      category: 'database',
    });

    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('PostgreSQL Database');
    expect(text).toContain('SQLite Database');
    expect(text).toContain(ADD_SERVER_NAME);
  });

  it('should dynamically hot-load a new server using contextwise_add_server', async () => {
    const res = await proxy.handleToolCall(ADD_SERVER_NAME, {
      name: 'dynamic_mock',
      command: 'node',
      args: [mockServerPath],
      env: {},
    });

    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('Successfully added and connected');
    expect(text).toContain('dynamic_mock__ping');
    expect(text).toContain('dynamic_mock__echo');

    // Verify tool can be immediately executed!
    const execRes = await proxy.handleToolCall(EXECUTE_TOOL_NAME, {
      tool_name: 'dynamic_mock__ping',
      arguments: {},
    });

    expect(execRes.isError).toBeFalsy();
    expect(execRes.content[0]).toEqual({ type: 'text', text: 'pong' });
  });
});
