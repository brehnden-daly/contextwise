import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../catalog/registry.js';
import type { ContextWiseConfig } from '../config/schema.js';
import { argumentValidator } from '../guardrails/validator.js';
import { responseCache } from '../guardrails/cache.js';
import { loopBreaker } from '../guardrails/loop_breaker.js';
import { metricsCollector } from '../metrics/collector.js';
import {
  ADD_SERVER_NAME,
  BROWSE_SERVERS_NAME,
  EXECUTE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
} from '../router/meta_tools.js';
import {
  KnownServerRegistry,
  RegistrySource,
  ServerManager,
  ServerRecommender,
  SmitheryClient,
  UnifiedRegistryClient,
} from '../registry/index.js';
import type { UpstreamServerConfig } from '../config/schema.js';
import { contextRouter, ContextRouter } from '../router/router.js';
import { logger } from '../utils/logger.js';
import { UpstreamMultiplexer } from './multiplexer.js';
import { redactionFilter } from '../vault/redaction.js';

export class ContextWiseProxy {
  private server: Server;
  private multiplexer: UpstreamMultiplexer;
  private router: ContextRouter;
  private transport?: StdioServerTransport;
  private config?: ContextWiseConfig;
  private isRunning: boolean = false;

  constructor() {
    this.server = new Server(
      {
        name: 'contextwise',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
      }
    );

    this.multiplexer = new UpstreamMultiplexer();
    this.router = contextRouter;
    this.setupRequestHandlers();
  }

  private setupRequestHandlers(): void {
    // 1. tools/list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const exposedTools = this.router.getExposedTools();
      const allToolsCount = toolRegistry.getAllTools().length;

      metricsCollector.updateToolCounts(allToolsCount, exposedTools.length);
      metricsCollector.recordSchemaPruning(allToolsCount, exposedTools.length);
      logger.debug(
        `Serving tools/list: exposing ${exposedTools.length} tools (out of ${allToolsCount} upstream tools)`
      );

      return {
        tools: exposedTools,
      };
    });

    // 2. tools/call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      return this.handleToolCall(name, args as Record<string, unknown>);
    });
  }

  /**
   * Main tool execution pipeline handling meta-tools and proxied calls.
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CallToolResult> {
    // A. Handle search meta-tool (contextwise_search_tools)
    if (name === SEARCH_TOOLS_NAME) {
      return this.handleSearchToolsCall(args);
    }

    // B. Handle universal execute meta-tool (contextwise_execute_tool)
    if (name === EXECUTE_TOOL_NAME) {
      const targetToolName = String(args.tool_name || '');
      const targetArgs = (args.arguments as Record<string, unknown>) || {};
      if (!targetToolName) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Error: Missing required parameter "tool_name" in contextwise_execute_tool.',
            },
          ],
        };
      }
      return this.dispatchProxiedToolCall(targetToolName, targetArgs);
    }

    // C. Handle browse servers meta-tool (contextwise_browse_servers)
    if (name === BROWSE_SERVERS_NAME) {
      return this.handleBrowseServersCall(args);
    }

    // D. Handle add server meta-tool (contextwise_add_server)
    if (name === ADD_SERVER_NAME) {
      return this.handleAddServerCall(args);
    }

    // E. Regular tool call (proxied directly to upstream)
    return this.dispatchProxiedToolCall(name, args);
  }

  /**
   * Handles contextwise_browse_servers execution.
   */
  private async handleBrowseServersCall(
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const query = args.query ? String(args.query) : undefined;
    const category = args.category ? String(args.category) : undefined;
    const source = (args.source as RegistrySource | 'all') ?? 'all';

    const servers = await UnifiedRegistryClient.search({
      query,
      category,
      source,
      limit: 12,
    });

    if (servers.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No MCP servers found matching query: "${query || ''}" in category "${category || 'all'}". You can still add any custom MCP server using ${ADD_SERVER_NAME}.`,
          },
        ],
      };
    }

    const lines: string[] = [
      `### ContextWise MCP Server Catalog (${servers.length} results from online registries & local presets)`,
      '',
    ];

    for (const s of servers) {
      const verifiedBadge = s.verified ? ' [Verified]' : '';
      lines.push(
        `• **${s.displayName}** (\`${s.id}\`) — Registry: **${s.sourceLabel}**${verifiedBadge}`
      );
      lines.push(`  ${s.description}`);

      if (s.requiredParams && s.requiredParams.length > 0) {
        lines.push(`  *Required Configuration:*`);
        for (const p of s.requiredParams) {
          lines.push(`    - \`${p.name}\` (${p.type}): ${p.description}`);
        }
      }

      if (s.source === 'smithery') {
        lines.push(`  *Install with:* \`${ADD_SERVER_NAME}(name: "${s.id}", smithery: "${s.id}")\``);
      } else if (s.source === 'curated') {
        lines.push(`  *Install with:* \`${ADD_SERVER_NAME}(name: "${s.name}", preset: "${s.id}")\``);
      } else {
        lines.push(`  *Install with:* \`${ADD_SERVER_NAME}(name: "${s.id}", ...)\``);
      }
      lines.push('');
    }

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  }

  /**
   * Handles contextwise_add_server execution (hot-loading & persistence).
   */
  private async handleAddServerCall(
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const routingConfig = this.router.getConfig();
    if (!routingConfig.enableAddServer) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Error: Dynamic server addition is disabled by configuration for security. Enable it in contextwise.json with routing.enableAddServer: true.',
          },
        ],
      };
    }

    const rawName = String(args.name || '').trim();
    if (!rawName) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Error: Missing required parameter "name".' }],
      };
    }

    // Security Guard: Never resolve vault://, auth://, or env:// from LLM-supplied input
    const envObj = (args.env as Record<string, unknown>) || {};
    const paramsObj = (args.params as Record<string, unknown>) || {};
    const headersObj = (args.headers as Record<string, unknown>) || {};
    for (const [source, obj] of Object.entries({ env: envObj, params: paramsObj, headers: headersObj })) {
      for (const [key, val] of Object.entries(obj)) {
        if (
          typeof val === 'string' &&
          /(?:vault|auth|mcp-auth|env):\/\//.test(val)
        ) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Security violation: "vault://" and "env://" secret references cannot be passed via dynamic server addition (detected in ${source}.${key}).`,
              },
            ],
          };
        }
      }
    }

    // Auto-detect Smithery package if passed as name (e.g. @smithery/slack or smithery:package)
    let smitheryPackage = typeof args.smithery === 'string' ? args.smithery : undefined;
    if (!smitheryPackage && (rawName.startsWith('@smithery/') || rawName.startsWith('smithery:'))) {
      smitheryPackage = rawName.replace(/^smithery:/, '');
    }

    // Sanitize server name for valid MCP tool namespacing (alphanumeric, underscore, hyphen)
    const name = rawName.replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

    let serverConfig: UpstreamServerConfig;

    const presetId = String(args.preset || name).toLowerCase();
    const knownPreset = KnownServerRegistry.find(presetId);

    // Check if a preset was specified or matches a known server
    if (knownPreset) {
      serverConfig = KnownServerRegistry.buildConfig(knownPreset, {
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        env: (args.env as Record<string, string>) || {},
      });
    } else if (smitheryPackage) {
      serverConfig = SmitheryClient.buildServerConfig(smitheryPackage, {
        env: (args.env as Record<string, string>) || {},
      });
    } else if (!routingConfig.allowCustomCommands) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Security restriction: Arbitrary commands and unverified URLs are restricted. Only verified presets and Smithery packages are permitted unless routing.allowCustomCommands is explicitly enabled in configuration.`,
          },
        ],
      };
    } else if (args.url && typeof args.url === 'string') {
      serverConfig = {
        url: args.url,
        headers: (args.headers as Record<string, string>) || {},
        transport: 'auto',
        autoReconnect: true,
      };
    } else if (args.command && typeof args.command === 'string') {
      serverConfig = {
        command: args.command,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        env: (args.env as Record<string, string>) || {},
        autoRestart: true,
      };
    } else {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Could not configure server "${name}". Please specify a known "preset" (e.g. "postgres", "github", "sqlite", "fetch") or a "smithery" package name.`,
          },
        ],
      };
    }

    logger.info(`Adding and hot-loading new upstream server "${name}"...`);

    try {
      // 1. Connect and test upstream
      await this.multiplexer.connectServer(name, serverConfig);

      const status = this.multiplexer.getStatus().find((s) => s.name === name);
      if (!status || status.status !== 'connected') {
        const errorDetail = status?.error || 'Unknown connection failure';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to connect to newly added upstream server "${name}": ${errorDetail}`,
            },
          ],
        };
      }

      // 2. Persist to contextwise.json only if confirmed/configured
      if (routingConfig.persistAddedServers) {
        ServerManager.saveUpstream(name, serverConfig);
      }

      // 3. Update active catalog
      const allTools = this.multiplexer.getAllTools();
      toolRegistry.setAllTools(allTools);

      // 4. Notify AI client of list changed (Mode 2)
      try {
        await this.server.sendToolListChanged();
      } catch (notifyErr) {
        logger.debug(`Client notification push: ${notifyErr}`);
      }

      // Collect names of tools from the new server
      const newTools = allTools
        .filter((t) => t.serverName === name)
        .map((t) => t.namespacedName);

      const persistMsg = routingConfig.persistAddedServers
        ? 'persisted to contextwise.json, '
        : 'loaded in session, ';

      return {
        content: [
          {
            type: 'text',
            text: `✓ Successfully added and connected upstream server "${name}"!\n\nDiscovered ${newTools.length} tools:\n${newTools.map((t) => `• ${t}`).join('\n')}\n\nThese tools are now indexed, ${persistMsg}and ready for immediate invocation in this session.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error adding server "${name}": ${msg}`,
          },
        ],
      };
    }
  }

  /**
   * Handles contextwise_search_tools execution.
   */
  private async handleSearchToolsCall(
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const query = String(args.query || '');
    const domain = args.domain ? String(args.domain) : undefined;
    const topK = typeof args.topK === 'number' ? args.topK : undefined;
    const activate = args.activate !== false;

    if (!query) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Error: Missing required parameter "query".',
          },
        ],
      };
    }

    const searchResult = this.router.searchAndHydrate(query, domain, topK, activate);

    // If new tools were dynamically activated, notify client to re-read tools/list (Mode 2)
    if (searchResult.activatedNewTools) {
      try {
        await this.server.sendToolListChanged();
        logger.debug('Fired notifications/tools/list_changed notification to client.');
      } catch (err) {
        logger.debug(`Could not push list_changed notification: ${err}`);
      }
    }

    // Capability Gap Detection: If no matching tools exist in connected servers,
    // automatically recommend the best MCP servers to install from registries.
    if (searchResult.foundTools.length === 0) {
      logger.info(`No active tools found for "${query}". Checking registries for recommended servers...`);
      const rec = await ServerRecommender.recommendForTask(query, domain);
      if (rec.hasRecommendations) {
        return {
          content: [
            {
              type: 'text',
              text: rec.message,
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: searchResult.message,
        },
      ],
    };
  }

  /**
   * Dispatches tool call through guardrails and upstream multiplexer.
   */
  private async dispatchProxiedToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const resolved = this.multiplexer.resolveTool(toolName);
    if (!resolved) {
      // Check if toolName references an uninstalled capability/server and recommend it
      const rec = await ServerRecommender.recommendForTask(toolName);
      const errorMsg = rec.hasRecommendations
        ? `Tool "${toolName}" was not found in ContextWise registry.\n\n${rec.message}`
        : `Tool "${toolName}" was not found in ContextWise registry. Use ${SEARCH_TOOLS_NAME} to find available tools.`;

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: errorMsg,
          },
        ],
      };
    }

    const { serverName, originalName, tool } = resolved;

    const redactResult = (result: CallToolResult): CallToolResult => {
      if (!result || !Array.isArray(result.content)) return result;
      return {
        ...result,
        content: result.content.map((item) => {
          if (item && item.type === 'text' && typeof item.text === 'string') {
            return {
              ...item,
              text: redactionFilter.redact(item.text),
            };
          }
          return item;
        }),
      };
    };

    // 1. Guardrail: Pre-flight JSONSchema Argument Validation
    // (Executed first so that type coercion applies before loop-breaker checks)
    if (tool.inputSchema) {
      const validation = argumentValidator.validate(
        toolName,
        tool.inputSchema,
        args
      );
      if (!validation.valid) {
        const errorMsg = `Pre-flight validation failed for "${toolName}":\n${validation.errors?.join('\n')}`;
        loopBreaker.recordCall(serverName, originalName, args, true);
        return {
          isError: true,
          content: [{ type: 'text', text: redactionFilter.redact(errorMsg) }],
        };
      }
    }

    // 2. Guardrail: Circuit Breaker & Velocity Check
    const preFlight = loopBreaker.checkPreFlightDetailed(serverName, originalName, args);
    if (!preFlight.allowed) {
      if (preFlight.reason === 'rate_limited') {
        metricsCollector.recordThrottle(toolName, serverName);
      } else {
        metricsCollector.recordLoopPrevented(toolName, serverName);
      }
      return {
        isError: true,
        content: [{ type: 'text', text: preFlight.message! }],
      };
    }

    // 3. Guardrail: Read-Only Cache Check
    const isReadOnly = tool.readOnlyHint || tool.idempotentHint;
    if (isReadOnly && this.config?.guardrails.enableCache !== false) {
      const cached = responseCache.get(serverName, originalName, args);
      if (cached) {
        toolRegistry.touchTool(toolName);
        metricsCollector.recordExecution({
          toolName,
          serverName,
          latencyMs: 1,
          cached: true,
        });
        return redactResult(cached);
      }
    }

    // 4. Upstream Execution
    try {
      const timeoutMs = this.config?.guardrails.callTimeoutMs ?? 30_000;
      const execution = await this.multiplexer.executeTool(toolName, args, timeoutMs);
      const isError = Boolean(execution.result.isError);

      // Record in loop breaker
      loopBreaker.recordCall(serverName, originalName, args, isError);

      if (!isError) {
        toolRegistry.touchTool(toolName);
      }

      // 5. Post-Execution Cache & Invalidation
      if (isError) {
        // Do not cache error responses
      } else if (isReadOnly && this.config?.guardrails.enableCache !== false) {
        responseCache.set(serverName, originalName, args, execution.result);
      } else {
        // Mutating / destructive call invalidates server cache
        responseCache.invalidateServer(serverName);
      }

      // Record metrics
      metricsCollector.recordExecution({
        toolName,
        serverName,
        latencyMs: execution.latencyMs,
        cached: false,
        isError,
      });

      return redactResult(execution.result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loopBreaker.recordCall(serverName, originalName, args, true);
      metricsCollector.recordExecution({
        toolName,
        serverName,
        latencyMs: 10,
        cached: false,
        isError: true,
      });

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: redactionFilter.redact(`Upstream error executing "${toolName}": ${msg}`),
          },
        ],
      };
    }
  }

  /**
   * Starts ContextWise proxy using given configuration.
   */
  async start(config: ContextWiseConfig): Promise<void> {
    this.config = config;
    this.isRunning = true;

    logger.setLevel(config.proxy.logLevel);
    logger.info('Starting ContextWise MCP Proxy Gateway...');

    // Apply router configuration
    this.router.updateConfig(config.routing);

    // Apply guardrails configuration
    responseCache.setTtlSeconds(config.guardrails.cacheTtlSeconds);
    loopBreaker.updateConfig({
      maxCallsPerMinute: config.guardrails.maxCallsPerMinute,
      consecutiveFailureThreshold: config.guardrails.loopBreakerThreshold,
    });

    // Connect to upstreams
    await this.multiplexer.connectAll(config.upstreams);

    // Sync catalog
    const allTools = this.multiplexer.getAllTools();
    toolRegistry.setAllTools(allTools);

    // Listen for upstream catalog updates
    this.multiplexer.on('toolsChanged', async (_serverName, updatedTools) => {
      toolRegistry.setAllTools(updatedTools);
      try {
        await this.server.sendToolListChanged();
      } catch (err) {
        logger.debug(`Notification push error: ${err}`);
      }
    });

    // Mode 4: Prime workspace context
    this.router.primeWorkspace(process.cwd());

    // Connect downstream transport (stdio default)
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);

    logger.info('ContextWise MCP Proxy is running and ready for client connections.');
  }

  /**
   * Gracefully shuts down proxy and upstream connections.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    metricsCollector.flushSync();
    logger.info('Shutting down ContextWise proxy...');
    await this.multiplexer.closeAll();
    if (this.transport) {
      await this.transport.close();
    }
    await this.server.close();
    logger.info('ContextWise proxy stopped cleanly.');
  }

  getMultiplexer(): UpstreamMultiplexer {
    return this.multiplexer;
  }

  getRouter(): ContextRouter {
    return this.router;
  }
}

export const proxy = new ContextWiseProxy();
