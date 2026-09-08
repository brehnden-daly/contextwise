import { describe, it, expect, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { UpstreamMultiplexer } from '../../src/core/multiplexer.js';

describe('UpstreamMultiplexer Integration', () => {
  const multiplexer = new UpstreamMultiplexer();
  const mockServerPath = resolve(__dirname, '../mocks/mock_server.js');

  afterAll(async () => {
    await multiplexer.closeAll();
  });

  it('should connect to mock stdio MCP server and discover tools', async () => {
    await multiplexer.connectServer('mock', {
      command: 'node',
      args: [mockServerPath],
      autoRestart: false,
      env: {},
    });

    const status = multiplexer.getStatus();
    expect(status.length).toBe(1);
    expect(status[0].name).toBe('mock');
    expect(status[0].status).toBe('connected');
    expect(status[0].toolsCount).toBe(2);

    const allTools = multiplexer.getAllTools();
    const toolNames = allTools.map((t) => t.namespacedName);
    expect(toolNames).toContain('mock__ping');
    expect(toolNames).toContain('mock__echo');
  });

  it('should execute tools on mock stdio server and return result', async () => {
    const pingRes = await multiplexer.executeTool('mock__ping', {});
    expect(pingRes.serverName).toBe('mock');
    expect(pingRes.result.content[0]).toEqual({ type: 'text', text: 'pong' });

    const echoRes = await multiplexer.executeTool('mock__echo', {
      message: 'ContextWise works!',
    });
    expect(echoRes.result.content[0]).toEqual({
      type: 'text',
      text: 'ContextWise works!',
    });
  });

  it('should execute unconflicted tool by short name', async () => {
    const echoRes = await multiplexer.executeTool('echo', {
      message: 'short name works',
    });
    expect(echoRes.result.content[0]).toEqual({
      type: 'text',
      text: 'short name works',
    });
  });
});
