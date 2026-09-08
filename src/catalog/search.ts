import MiniSearch from 'minisearch';
import type { NamespacedTool } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { NormalizedToolDocument, ToolNormalizer } from './normalizer.js';

export interface SearchResult {
  tool: NamespacedTool;
  score: number;
  matchTerms: string[];
}

export interface SearchOptions {
  topK?: number;
  domain?: string;
  serverName?: string;
  minScore?: number;
  similarityThreshold?: number;
}

export class HybridSearchEngine {
  private miniSearch: MiniSearch<NormalizedToolDocument>;
  private toolMap: Map<string, NamespacedTool> = new Map();

  constructor() {
    this.miniSearch = new MiniSearch<NormalizedToolDocument>({
      fields: ['originalName', 'toolName', 'tagsText', 'description', 'parametersText'],
      storeFields: ['id', 'originalName', 'serverName'],
      searchOptions: {
        boost: {
          originalName: 4,
          toolName: 3,
          tagsText: 2.5,
          description: 1.5,
          parametersText: 1,
        },
        prefix: true,
        fuzzy: 0.2,
      },
    });
  }

  /**
   * Indexes a collection of tools.
   */
  indexTools(tools: NamespacedTool[]): void {
    this.miniSearch.removeAll();
    this.toolMap.clear();

    const documents: NormalizedToolDocument[] = [];

    for (const tool of tools) {
      this.toolMap.set(tool.namespacedName, tool);
      const doc = ToolNormalizer.normalize(tool);
      documents.push(doc);
    }

    if (documents.length > 0) {
      this.miniSearch.addAll(documents);
      logger.debug(`Indexed ${documents.length} tools in hybrid search engine.`);
    }
  }

  /**
   * Adds or updates a single tool in the search index.
   */
  addTool(tool: NamespacedTool): void {
    if (this.toolMap.has(tool.namespacedName)) {
      this.miniSearch.discard(tool.namespacedName);
    }
    this.toolMap.set(tool.namespacedName, tool);
    this.miniSearch.add(ToolNormalizer.normalize(tool));
  }

  /**
   * Searches for tools matching query string.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const topK = Math.max(1, options.topK ?? 5);
    const cleanQuery = (query || '').trim();

    if (!cleanQuery) {
      return [];
    }

    try {
      const rawResults = this.miniSearch.search(cleanQuery, {
        filter: (result) => {
          const tool = this.toolMap.get(result.id);
          if (!tool) return false;
          if (options.serverName && tool.serverName !== options.serverName) return false;
          if (options.domain) {
            const tags = ToolNormalizer.inferTags(tool);
            if (!tags.includes(options.domain.toLowerCase())) return false;
          }
          return true;
        },
      });

      if (rawResults.length === 0) {
        return [];
      }

      const topScore = rawResults[0].score;
      // Absolute relevance baseline (drops random partial-character matches)
      const baseMinScore = options.minScore ?? 0.8;
      if (topScore < baseMinScore) {
        return [];
      }

      // Relative cutoff: drop tools that score below similarityThreshold * topScore
      const relativeThreshold = options.similarityThreshold ?? 0.35;
      const scoreCutoff = Math.max(baseMinScore, topScore * relativeThreshold);

      const results: SearchResult[] = [];
      for (const res of rawResults) {
        const tool = this.toolMap.get(res.id);
        if (!tool) continue;

        if (res.score < scoreCutoff) {
          continue;
        }

        results.push({
          tool,
          score: res.score,
          matchTerms: res.match ? Object.keys(res.match) : [cleanQuery],
        });

        if (results.length >= topK) {
          break;
        }
      }

      return results;
    } catch (err) {
      logger.debug(`MiniSearch error on query "${cleanQuery}": ${err}`);
      return [];
    }
  }

  /**
   * Returns total count of indexed tools.
   */
  get size(): number {
    return this.toolMap.size;
  }
}

export const searchEngine = new HybridSearchEngine();
