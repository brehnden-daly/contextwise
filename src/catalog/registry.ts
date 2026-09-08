import type { NamespacedTool } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { searchEngine } from './search.js';

export interface ToolRegistryOptions {
  pinnedToolNames?: string[];
  maxActiveTools?: number;
}

export class ToolRegistry {
  private allTools: Map<string, NamespacedTool> = new Map();
  private pinnedToolNames: Set<string> = new Set();
  /** Set of dynamically activated tools in current session */
  private dynamicActiveTools: Map<string, number> = new Map(); // toolName -> lastUsedTimestamp
  private maxActiveTools: number;

  constructor(options: ToolRegistryOptions = {}) {
    this.maxActiveTools = options.maxActiveTools ?? 10;
    if (options.pinnedToolNames) {
      this.setPinnedTools(options.pinnedToolNames);
    }
  }

  setMaxActiveTools(max: number): void {
    this.maxActiveTools = Math.max(1, max);
  }

  /**
   * Updates LRU timestamp when a tool is invoked.
   */
  touchTool(name: string): void {
    const tool = this.getTool(name);
    if (tool && this.dynamicActiveTools.has(tool.namespacedName)) {
      this.dynamicActiveTools.set(tool.namespacedName, Date.now());
    }
  }

  setPinnedTools(toolNames: string[]): void {
    this.pinnedToolNames = new Set(toolNames);
    logger.debug(`Configured ${this.pinnedToolNames.size} pinned tools.`);
  }

  /**
   * Registers or updates all tools from upstreams into the catalog.
   */
  setAllTools(tools: NamespacedTool[]): void {
    this.allTools.clear();

    // Pass 1: Count occurrences of originalName across all tools
    const toolNameCounts = new Map<string, number>();
    for (const tool of tools) {
      toolNameCounts.set(tool.originalName, (toolNameCounts.get(tool.originalName) ?? 0) + 1);
    }

    const RESERVED_NAMES = new Set([
      'contextwise_search_tools',
      'contextwise_execute_tool',
      'contextwise_browse_servers',
      'contextwise_add_server',
    ]);

    // Pass 2: Register namespaced and unconflicted short names
    for (const tool of tools) {
      this.allTools.set(tool.namespacedName, tool);
      if (toolNameCounts.get(tool.originalName) === 1 && !RESERVED_NAMES.has(tool.originalName)) {
        this.allTools.set(tool.originalName, tool);
      }
    }

    // Update search index
    searchEngine.indexTools(tools);

    // Prune obsolete active tools that no longer exist in upstreams
    for (const key of this.dynamicActiveTools.keys()) {
      if (!this.allTools.has(key)) {
        this.dynamicActiveTools.delete(key);
      }
    }

    logger.debug(`Catalog registry updated with ${tools.length} tools.`);
  }

  /**
   * Retrieves a tool by either its namespaced name or original name.
   */
  getTool(name: string): NamespacedTool | undefined {
    return this.allTools.get(name);
  }

  /**
   * Activates tools dynamically (e.g. when summoned by contextwise_search_tools).
   * Evicts least-recently-activated tools if exceeding maxActiveTools.
   */
  activateTools(toolNames: string[]): NamespacedTool[] {
    const activated: NamespacedTool[] = [];
    const now = Date.now();

    for (const name of toolNames) {
      const tool = this.getTool(name);
      if (tool) {
        this.dynamicActiveTools.set(tool.namespacedName, now);
        activated.push(tool);
      }
    }

    // Evict excess dynamic tools (LRU)
    while (this.dynamicActiveTools.size > this.maxActiveTools) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, time] of this.dynamicActiveTools.entries()) {
        // Do not evict if pinned
        if (this.isPinned(key)) continue;
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.dynamicActiveTools.delete(oldestKey);
        logger.debug(`Evicted inactive tool from session: ${oldestKey}`);
      } else {
        break;
      }
    }

    return activated;
  }

  /**
   * Returns whether a tool is pinned.
   */
  isPinned(name: string): boolean {
    const tool = this.getTool(name);
    if (!tool) return false;
    return (
      this.pinnedToolNames.has(tool.originalName) ||
      this.pinnedToolNames.has(tool.namespacedName)
    );
  }

  /**
   * Returns current active tool set to be presented to the AI client:
   * (Pinned tools + Dynamically activated tools)
   */
  getActiveTools(): NamespacedTool[] {
    const activeMap = new Map<string, NamespacedTool>();

    // 1. Add all pinned tools that exist in catalog
    for (const pinned of this.pinnedToolNames) {
      const tool = this.getTool(pinned);
      if (tool) {
        activeMap.set(tool.namespacedName, tool);
      }
    }

    // 2. Add dynamically activated tools
    for (const activeName of this.dynamicActiveTools.keys()) {
      const tool = this.getTool(activeName);
      if (tool) {
        activeMap.set(tool.namespacedName, tool);
      }
    }

    return Array.from(activeMap.values());
  }

  /**
   * Returns all known tools in the catalog.
   */
  getAllTools(): NamespacedTool[] {
    const unique = new Map<string, NamespacedTool>();
    for (const tool of this.allTools.values()) {
      unique.set(tool.namespacedName, tool);
    }
    return Array.from(unique.values());
  }
}

export const toolRegistry = new ToolRegistry();
