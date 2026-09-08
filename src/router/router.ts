import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry, toolRegistry } from '../catalog/registry.js';
import { HybridSearchEngine, searchEngine } from '../catalog/search.js';
import type { RoutingConfig } from '../config/schema.js';
import { logger } from '../utils/logger.js';
import {
  ADD_SERVER_DEFINITION,
  BROWSE_SERVERS_DEFINITION,
  EXECUTE_TOOL_DEFINITION,
  SEARCH_TOOLS_DEFINITION,
} from './meta_tools.js';
import { WorkspaceContextPrimer } from './workspace.js';
import { KnownServerRegistry } from '../registry/known_servers.js';

export interface SearchToolsResult {
  message: string;
  foundTools: Array<{
    name: string;
    server: string;
    description: string;
    parameters: unknown;
  }>;
  activatedNewTools: boolean;
}

export class ContextRouter {
  private config: RoutingConfig;
  private registry: ToolRegistry;
  private searchEngine: HybridSearchEngine;

  constructor(
    config: Partial<RoutingConfig> = {},
    registry: ToolRegistry = toolRegistry,
    search: HybridSearchEngine = searchEngine
  ) {
    this.config = {
      strategy: config.strategy ?? 'hybrid',
      topK: config.topK ?? 5,
      similarityThreshold: config.similarityThreshold ?? 0.45,
      pinnedTools: config.pinnedTools ?? [],
      maxActiveTools: config.maxActiveTools ?? 10,
      enableBrowseServers: config.enableBrowseServers ?? false,
      enableAddServer: config.enableAddServer ?? false,
      allowCustomCommands: config.allowCustomCommands ?? false,
      persistAddedServers: config.persistAddedServers ?? false,
    };
    this.registry = registry;
    this.searchEngine = search;
    this.registry.setPinnedTools(this.config.pinnedTools);
    if (this.config.maxActiveTools) {
      this.registry.setMaxActiveTools(this.config.maxActiveTools);
    }
  }

  updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.pinnedTools) {
      this.registry.setPinnedTools(config.pinnedTools);
    }
    if (config.maxActiveTools) {
      this.registry.setMaxActiveTools(config.maxActiveTools);
    }
  }

  getConfig(): RoutingConfig {
    return this.config;
  }

  /**
   * Prime active tools based on workspace environment (Mode 4).
   */
  primeWorkspace(workspaceDir: string = process.cwd()): void {
    if (this.config.strategy === 'passthrough') return;

    const analysis = WorkspaceContextPrimer.analyzeWorkspace(workspaceDir);
    for (const query of analysis.suggestedQueries) {
      const results = this.searchEngine.search(query, { topK: 2, similarityThreshold: this.config.similarityThreshold });
      if (results.length > 0) {
        this.registry.activateTools(results.map((r) => r.tool.namespacedName));
      }
    }
  }

  /**
   * Generates a succinct Dynamic Capability Manifest of connected upstream servers and tools.
   */
  generateCapabilityManifest(): string {
    const allTools = this.registry.getAllTools();
    if (allTools.length === 0) {
      return '';
    }

    const serverMap = new Map<string, string[]>();
    for (const tool of allTools) {
      const server = tool.serverName;
      if (!serverMap.has(server)) {
        serverMap.set(server, []);
      }
      const list = serverMap.get(server)!;
      if (!list.includes(tool.originalName)) {
        list.push(tool.originalName);
      }
    }

    const lines: string[] = [];
    const sortedServers = Array.from(serverMap.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    for (const [serverName, toolNames] of sortedServers) {
      const known = KnownServerRegistry.find(serverName);
      const serverLabel = known?.displayName
        ? `${serverName} (${known.displayName})`
        : serverName;

      const toolSummary =
        toolNames.length <= 4
          ? toolNames.join(', ')
          : `${toolNames.slice(0, 3).join(', ')} (+${toolNames.length - 3} more)`;

      lines.push(`• ${serverLabel}: ${toolSummary}`);
    }

    return lines.join('\n');
  }

  /**
   * Returns list of tools to expose to downstream AI client.
   */
  getExposedTools(): Tool[] {
    // Mode: Passthrough (Expose all tools directly)
    if (this.config.strategy === 'passthrough') {
      return this.registry.getAllTools().map((t) => ({
        ...t,
        name: t.namespacedName,
      }));
    }

    // Dynamic Mode (Mode 1 & 2):
    // Expose Meta-Tools + Currently Active (Pinned + LRU Activated) Tools
    const activeTools = this.registry.getActiveTools().map((t) => ({
      ...t,
      name: t.namespacedName,
    }));

    // Generate Dynamic Capability Manifest snippet for connected servers
    const manifest = this.generateCapabilityManifest();
    const dynamicSearchTool: Tool = {
      ...SEARCH_TOOLS_DEFINITION,
      description: manifest
        ? `${SEARCH_TOOLS_DEFINITION.description}\n\nConnected MCP servers and available capabilities:\n${manifest}`
        : SEARCH_TOOLS_DEFINITION.description,
    };

    // Core meta-tools always exposed in dynamic mode
    const metaTools: Tool[] = [
      dynamicSearchTool,
      EXECUTE_TOOL_DEFINITION,
    ];

    // Optional management tools (gated to conserve tokens and enforce security)
    if (this.config.enableBrowseServers) {
      metaTools.push(BROWSE_SERVERS_DEFINITION);
    }
    if (this.config.enableAddServer) {
      metaTools.push(ADD_SERVER_DEFINITION);
    }

    const metaToolNames = new Set(metaTools.map((m) => m.name));
    const safeActiveTools = activeTools.filter((t) => !metaToolNames.has(t.name));

    return [...metaTools, ...safeActiveTools];
  }

  /**
   * Handles contextwise_search_tools meta-tool call.
   */
  searchAndHydrate(
    query: string,
    domain?: string,
    topK?: number,
    activate: boolean = true
  ): SearchToolsResult {
    const k = topK ?? this.config.topK;
    const results = this.searchEngine.search(query, {
      topK: k,
      domain,
      similarityThreshold: this.config.similarityThreshold,
    });

    if (results.length === 0) {
      return {
        message: `No matching tools found for query "${query}".`,
        foundTools: [],
        activatedNewTools: false,
      };
    }

    const toolNames = results.map((r) => r.tool.namespacedName);
    let activatedNewTools = false;

    if (activate) {
      const beforeSet = new Set(this.registry.getActiveTools().map((t) => t.namespacedName));
      this.registry.activateTools(toolNames);
      const afterSet = new Set(this.registry.getActiveTools().map((t) => t.namespacedName));
      activatedNewTools = beforeSet.size !== afterSet.size || [...afterSet].some((t) => !beforeSet.has(t));
      if (activatedNewTools) {
        logger.info(`Dynamically activated ${afterSet.size - beforeSet.size} tools for query "${query}"`);
      }
    }

    const formatParams = (inputSchema: unknown): string => {
      if (!inputSchema || typeof inputSchema !== 'object') return 'none';
      const s = inputSchema as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      const props = s.properties || {};
      const required = new Set(s.required || []);
      const entries = Object.entries(props);
      if (entries.length === 0) return 'none';
      return entries
        .map(([name, p]) => {
          const type = p.type || 'any';
          const reqStr = required.has(name) ? 'required' : 'optional';
          const descStr = p.description ? ` - ${p.description}` : '';
          return `${name}: ${type} (${reqStr})${descStr}`;
        })
        .join(', ');
    };

    const formatted = results.map((r) => ({
      name: r.tool.namespacedName,
      server: r.tool.serverName,
      description: r.tool.description || '',
      parameters: (r.tool.inputSchema as Record<string, unknown>)?.properties || {},
    }));

    const summaryText = [
      `Found ${results.length} relevant tool(s) for "${query}":`,
      ...results.map(
        (r, idx) =>
          `${idx + 1}. **${r.tool.namespacedName}** (${r.tool.serverName})\n   - ${r.tool.description || 'No description'}\n   - Parameters: ${formatParams(r.tool.inputSchema)}`
      ),
      activate
        ? '\nThese tools have been activated into your active tool set and can also be called immediately via contextwise_execute_tool.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      message: summaryText,
      foundTools: formatted,
      activatedNewTools,
    };
  }
}

export const contextRouter = new ContextRouter();
