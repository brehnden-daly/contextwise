import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { ContextWiseProxy } from '../../src/core/proxy.js';
import { ContextWiseConfig, ContextWiseConfigSchema } from '../../src/config/schema.js';
import {
  EXECUTE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
} from '../../src/router/meta_tools.js';

describe('ContextWiseProxy End-to-End Execution Pipeline', () => {
  let proxy: ContextWiseProxy;
  const mockServerPath = resolve(__dirname, '../mocks/mock_server.js');

  const config: ContextWiseConfig = ContextWiseConfigSchema.parse({
    version: '1.0.0',
    proxy: {
      transport: 'stdio',
      port: 3456,
      logLevel: 'silent',
    },
    routing: {
      strategy: 'hybrid',
      topK: 5,
      similarityThreshold: 0.45,
      pinnedTools: [],
    },
    guardrails: {
      enableCache: true,
      cacheTtlSeconds: 60,
      maxCallsPerMinute: 60,
      loopBreakerThreshold: 3,
    },
    upstreams: {
      mock: {
        command: 'node',
        args: [mockServerPath],
        env: {},
        autoRestart: false,
      },
    },
  });

  beforeAll(async () => {
    proxy = new ContextWiseProxy();
    // Connect multiplexer directly for test harness
    await proxy.getMultiplexer().connectAll(config.upstreams);
    const { toolRegistry } = await import('../../src/catalog/registry.js');
    toolRegistry.setAllTools(proxy.getMultiplexer().getAllTools());
  });

  afterAll(async () => {
    await proxy.getMultiplexer().closeAll();
  });

  it('should search for tools using contextwise_search_tools meta-tool', async () => {
    const res = await proxy.handleToolCall(SEARCH_TOOLS_NAME, {
      query: 'echo message',
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe('text');
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('mock__echo');
  });

  it('should universally execute tool using contextwise_execute_tool meta-tool', async () => {
    const res = await proxy.handleToolCall(EXECUTE_TOOL_NAME, {
      tool_name: 'mock__echo',
      arguments: { message: 'hello proxy' },
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0]).toEqual({
      type: 'text',
      text: 'hello proxy',
    });
  });

  it('should enforce JSONSchema argument validation before upstream execution', async () => {
    // mock__echo requires "message" parameter
    const res = await proxy.handleToolCall('mock__echo', {
      wrong_param: 123,
    });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('Pre-flight validation failed');
    expect(text).toContain('required');
  });

  it('should proxy regular tool call when invoked directly', async () => {
    const res = await proxy.handleToolCall('mock__ping', {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0]).toEqual({
      type: 'text',
      text: 'pong',
    });
  });
});
