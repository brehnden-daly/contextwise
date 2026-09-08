import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { isAbsolute, join, extname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResult,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  isHttpUpstream,
  isStdioUpstream,
  UpstreamServerConfig,
  warnIfInsecureHttp,
} from '../config/schema.js';
import { logger } from '../utils/logger.js';
import { redactionFilter, SecretResolver } from '../vault/index.js';
import { supervisor } from './supervisor.js';
import type {
  NamespacedTool,
  ServerConnectionStatus,
  ToolExecutionResponse,
  UpstreamServerStatus,
} from './types.js';

interface UpstreamConnection {
  name: string;
  config: UpstreamServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  status: ServerConnectionStatus;
  tools: Map<string, NamespacedTool>;
  lastError?: string;
  reconnectAttempts: number;
}

export function escapeWindowsCmdArg(arg: string): string {
  if (!arg) return '""';
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\+)$/g, '$1$1');
  if (/[\s&|<>()%^"!]/.test(escaped)) {
    escaped = `"${escaped}"`;
  }
  return escaped;
}

export function inferToolHints(
  toolName: string,
  desc: string = '',
  annotations?: Record<string, unknown>
): { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean } {
  let readOnlyHint: boolean;
  let destructiveHint: boolean;
  let idempotentHint: boolean;

  if (annotations && typeof annotations === 'object') {
    if (typeof annotations.readOnlyHint === 'boolean') {
      readOnlyHint = annotations.readOnlyHint;
    } else if (typeof annotations.readOnly === 'boolean') {
      readOnlyHint = annotations.readOnly as boolean;
    } else {
      readOnlyHint = false;
    }

    if (typeof annotations.destructiveHint === 'boolean') {
      destructiveHint = annotations.destructiveHint;
    } else if (typeof annotations.destructive === 'boolean') {
      destructiveHint = annotations.destructive as boolean;
    } else {
      destructiveHint = false;
    }

    if (typeof annotations.idempotentHint === 'boolean') {
      idempotentHint = annotations.idempotentHint;
    } else {
      idempotentHint = readOnlyHint;
    }
  } else {
    // Conservative heuristics: Do NOT treat generic "query", "exec", or "run" as read-only.
    // Require clear read-only verbs like get, read, list, fetch, inspect, describe, view
    const hasReadOnlyVerb = /(?:^|[_.-])(?:read|get|list|fetch|inspect|describe|view)(?:[_.-]|$)/i.test(toolName);
    const hasMutatingVerb = /(?:^|[_.-])(?:query|exec|execute|run|create|update|insert|delete|drop|mutate|write|post|put|patch|set|add|send)(?:[_.-]|$)/i.test(toolName);
    const hasExplicitReadOnlyDesc = /\b(read-only|readonly|does not modify)\b/i.test(desc);

    readOnlyHint = (hasReadOnlyVerb && !hasMutatingVerb) || hasExplicitReadOnlyDesc;

    destructiveHint =
      /(?:^|[_.-])(?:delete|drop|remove|truncate|kill|destroy|terminate|purge)(?:[_.-]|$)/i.test(toolName) ||
      /\b(destructive|irreversible)\b/i.test(desc);

    idempotentHint = readOnlyHint;
  }

  return { readOnlyHint, idempotentHint, destructiveHint };
}

export class UpstreamMultiplexer extends EventEmitter {
  private connections: Map<string, UpstreamConnection> = new Map();
  /** Mapping of exposed tool name -> { serverName, originalName } */
  private toolRoutingTable: Map<
    string,
    { serverName: string; originalName: string; tool: NamespacedTool }
  > = new Map();

  constructor() {
    super();
  }

  /**
   * Initializes connections to all configured upstream servers in parallel.
   */
  async connectAll(upstreams: Record<string, UpstreamServerConfig>): Promise<void> {
    const entries = Object.entries(upstreams);
    if (entries.length === 0) {
      logger.info('No upstream MCP servers configured.');
      return;
    }

    logger.info(`Connecting to ${entries.length} upstream MCP servers...`);
    const promises = entries.map(([name, config]) => this.connectServer(name, config));
    await Promise.allSettled(promises);
    this.rebuildRoutingTable();
    logger.info(
      `Multiplexer initialized. Total aggregated tools: ${this.toolRoutingTable.size}`
    );
  }

  /**
   * Connects to a single upstream server.
   */
  async connectServer(name: string, config: UpstreamServerConfig): Promise<void> {
    try {
      logger.info(`Connecting upstream [${name}]...`);
      let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

      if (isStdioUpstream(config)) {
        // Safe environment subset allowlist: never inherit full process.env
        const baseEnv = getDefaultEnvironment();
        const mergedEnv: Record<string, string> = { ...baseEnv };

        if (config.env) {
          const resolvedCustomEnv = await SecretResolver.resolveEnv(config.env);
          for (const [k, v] of Object.entries(resolvedCustomEnv)) {
            mergedEnv[k] = v;
          }
        }

        let command = config.command;
        let args = config.args ?? [];

        if (process.platform === 'win32') {
          const cmdLower = config.command.toLowerCase();
          if (
            ['npx', 'npm', 'pnpm', 'yarn', 'bunx'].includes(cmdLower) ||
            cmdLower.endsWith('.cmd') ||
            cmdLower.endsWith('.bat')
          ) {
            command = 'cmd.exe';
            args = ['/d', '/s', '/c', config.command, ...args.map(escapeWindowsCmdArg)];
          }
        }

        transport = new StdioClientTransport({
          command,
          args,
          env: mergedEnv,
          cwd: config.cwd,
          stderr: 'pipe',
        });
      } else if (isHttpUpstream(config)) {
        warnIfInsecureHttp(config.url, config.headers);
        const resolvedHeaders = config.headers
          ? await SecretResolver.resolveEnv(config.headers)
          : {};

        const transportType = config.transport ?? 'auto';
        if (transportType === 'streamable-http') {
          transport = new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: {
              headers: resolvedHeaders,
            },
          });
        } else if (transportType === 'sse') {
          transport = new SSEClientTransport(new URL(config.url), {
            requestInit: {
              headers: resolvedHeaders,
            },
          });
        } else {
          // Auto: default to SSE for backwards compatibility
          transport = new SSEClientTransport(new URL(config.url), {
            requestInit: {
              headers: resolvedHeaders,
            },
          });
        }
      } else {
        throw new Error(`Unsupported upstream configuration for server "${name}"`);
      }

      const client = new Client(
        {
          name: `contextwise-${name}`,
          version: '0.1.0',
        },
        {
          capabilities: {},
        }
      );

      const conn: UpstreamConnection = {
        name,
        config,
        client,
        transport,
        status: 'connecting',
        tools: new Map(),
        reconnectAttempts: 0,
      };

      this.connections.set(name, conn);

      // Handle stdio stderr forwarding and supervisor tracking
      if (transport instanceof StdioClientTransport) {
        if (transport.stderr) {
          transport.stderr.on('data', (chunk: Buffer) => {
            const str = chunk.toString('utf-8').trim();
            if (str) {
              logger.debug(`[upstream:${name}:stderr] ${redactionFilter.redact(str)}`);
            }
          });
        }
      }

      // Connect transport to client
      await client.connect(transport);

      // Track PID in supervisor once connected
      if (transport instanceof StdioClientTransport && transport.pid) {
        supervisor.track(transport.pid, name);
      }

      conn.status = 'connected';
      conn.reconnectAttempts = 0;
      logger.info(`Upstream [${name}] connected successfully.`);

      // Discover and catalog tools
      await this.refreshServerTools(name);

      // Lifecycle & Reconnection handling
      transport.onclose = () => {
        logger.warn(`Upstream [${name}] transport closed.`);
        conn.status = 'disconnected';
        this.rebuildRoutingTable();
        this.emit('toolsChanged', name, this.getAllTools());

        const shouldReconnect = isStdioUpstream(config)
          ? config.autoRestart !== false
          : config.autoReconnect !== false;

        if (shouldReconnect && conn.reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, conn.reconnectAttempts), 15000);
          conn.reconnectAttempts += 1;
          logger.info(`Scheduling auto-reconnect for [${name}] in ${delay}ms (attempt ${conn.reconnectAttempts}/5)...`);
          setTimeout(() => {
            if (this.connections.has(name)) {
              this.connectServer(name, config).catch((err) => {
                logger.error(`Reconnect attempt failed for [${name}]: ${err}`);
              });
            }
          }, delay);
        }
      };

      transport.onerror = (err: Error) => {
        logger.error(`Upstream [${name}] transport error: ${err.message || err}`);
        conn.lastError = err.message || String(err);
      };

      // Listen for upstream tool list changes if supported
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        logger.info(`[${name}] Received notifications/tools/list_changed. Refreshing tools...`);
        await this.refreshServerTools(name);
        this.emit('toolsChanged', name, this.getAllTools());
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to connect upstream [${name}]: ${msg}`);
      const conn = this.connections.get(name);
      if (conn) {
        conn.status = 'error';
        conn.lastError = msg;
      }
    }
  }

  /**
   * Refreshes the tools catalog for a specific upstream server.
   */
  async refreshServerTools(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn || conn.status !== 'connected') return;

    try {
      const response = await conn.client.listTools();
      conn.tools.clear();

      for (const tool of response.tools) {
        const namespacedName = `${name}__${tool.name}`;
        const desc = tool.description || '';
        
        // 1. Honor explicit annotations if present
        const annotations = (tool as unknown as { annotations?: Record<string, unknown> }).annotations;
        
        const { readOnlyHint, idempotentHint, destructiveHint } = inferToolHints(tool.name, desc, annotations);

        const namespacedTool: NamespacedTool = {
          ...tool,
          originalName: tool.name,
          namespacedName,
          serverName: name,
          readOnlyHint,
          idempotentHint,
          destructiveHint,
        };

        conn.tools.set(tool.name, namespacedTool);
      }

      logger.debug(`Loaded ${conn.tools.size} tools from upstream [${name}]`);
      this.rebuildRoutingTable();
    } catch (err) {
      logger.error(`Error listing tools for [${name}]: ${err}`);
    }
  }

  /**
   * Rebuilds the global tool routing table with namespacing and fallback alias mapping.
   */
  private rebuildRoutingTable(): void {
    this.toolRoutingTable.clear();

    // Pass 1: Register all fully-qualified namespaced names (${server}__${tool})
    for (const [serverName, conn] of this.connections.entries()) {
      if (conn.status !== 'connected') continue;

      for (const [origName, tool] of conn.tools.entries()) {
        this.toolRoutingTable.set(tool.namespacedName, {
          serverName,
          originalName: origName,
          tool,
        });
      }
    }

    // Pass 2: Register unadorned names if unique across all active servers
    const toolNameCounts = new Map<string, number>();
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue;
      for (const origName of conn.tools.keys()) {
        toolNameCounts.set(origName, (toolNameCounts.get(origName) ?? 0) + 1);
      }
    }

    const RESERVED_NAMES = new Set([
      'contextwise_search_tools',
      'contextwise_execute_tool',
      'contextwise_browse_servers',
      'contextwise_add_server',
    ]);

    for (const [serverName, conn] of this.connections.entries()) {
      if (conn.status !== 'connected') continue;
      for (const [origName, tool] of conn.tools.entries()) {
        if (toolNameCounts.get(origName) === 1 && !RESERVED_NAMES.has(origName)) {
          // Unconflicted tool name can be called directly without namespace prefix
          this.toolRoutingTable.set(origName, {
            serverName,
            originalName: origName,
            tool,
          });
        }
      }
    }
  }

  /**
   * Returns all aggregated tools with namespaced definitions.
   */
  getAllTools(): NamespacedTool[] {
    const list: NamespacedTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue;
      for (const tool of conn.tools.values()) {
        list.push(tool);
      }
    }
    return list;
  }

  /**
   * Resolves a tool by name (namespaced or short name).
   */
  resolveTool(name: string): { serverName: string; originalName: string; tool: NamespacedTool } | undefined {
    let resolved = this.toolRoutingTable.get(name);
    if (resolved) return resolved;

    // Handle single underscore prefix: server_tool -> server__tool
    const doubleUnderscore = name.replace(/^([a-zA-Z0-9_-]+?)_(.+)$/, '$1__$2');
    resolved = this.toolRoutingTable.get(doubleUnderscore);
    if (resolved) return resolved;

    // Handle dot prefix: server.tool -> server__tool
    const dotToDouble = name.replace(/^([a-zA-Z0-9_-]+?)\.(.+)$/, '$1__$2');
    resolved = this.toolRoutingTable.get(dotToDouble);
    if (resolved) return resolved;

    // Handle stripping known server prefix: robinhood_get_accounts -> get_accounts
    for (const serverName of this.connections.keys()) {
      if (name.startsWith(`${serverName}_`) || name.startsWith(`${serverName}.`)) {
        const stripped = name.slice(serverName.length + 1);
        resolved = this.toolRoutingTable.get(stripped);
        if (resolved) return resolved;
      }
    }

    return undefined;
  }

  /**
   * Executes a tool against its upstream MCP server with a timeout.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = 30_000
  ): Promise<ToolExecutionResponse> {
    const target = this.resolveTool(toolName);
    if (!target) {
      throw new Error(`Tool "${toolName}" not found in ContextWise registry.`);
    }

    const conn = this.connections.get(target.serverName);
    if (!conn || conn.status !== 'connected') {
      throw new Error(
        `Upstream server "${target.serverName}" for tool "${toolName}" is not currently connected.`
      );
    }

    const safeArgs = args && typeof args === 'object' ? args : {};
    const start = performance.now();
    logger.debug(`Dispatching tool call to [${target.serverName}]: ${target.originalName}`);

    try {
      const callPromise = conn.client.callTool({
        name: target.originalName,
        arguments: safeArgs,
      }) as Promise<CallToolResult>;

      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Tool execution for [${target.serverName}] ${target.originalName} timed out after ${timeoutMs}ms.`
            )
          );
        }, timeoutMs);
      });

      const result = await Promise.race([callPromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      const latencyMs = Math.round(performance.now() - start);

      return {
        result,
        latencyMs,
        serverName: target.serverName,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `Execution failed for [${target.serverName}] ${target.originalName}: ${msg}`
      );
      throw err;
    }
  }

  /**
   * Returns status summaries for all configured upstreams.
   */
  getStatus(): UpstreamServerStatus[] {
    const statuses: UpstreamServerStatus[] = [];
    for (const [name, conn] of this.connections.entries()) {
      statuses.push({
        name,
        status: conn.status,
        transportType: isStdioUpstream(conn.config)
          ? 'stdio'
          : conn.transport instanceof StreamableHTTPClientTransport
            ? 'streamable-http'
            : 'sse',
        toolsCount: conn.tools.size,
        error: conn.lastError,
      });
    }
    return statuses;
  }

  /**
   * Shuts down all upstream connections and processes.
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all upstream multiplexer connections...');
    for (const [name, conn] of this.connections.entries()) {
      try {
        if (conn.transport instanceof StdioClientTransport && conn.transport.pid) {
          supervisor.killProcessTree(conn.transport.pid, name);
        }
        await conn.client.close();
      } catch {
        // Ignore error on shutdown
      }
    }
    this.connections.clear();
    this.toolRoutingTable.clear();
  }
}
