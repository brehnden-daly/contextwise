import type { UpstreamServerConfig } from '../config/schema.js';
import { logger } from '../utils/logger.js';
import type { RegistryServerItem } from './types.js';

interface SmitheryServerItem {
  id?: string;
  qualifiedName: string;
  displayName?: string;
  description?: string;
  verified?: boolean;
  useCount?: number;
  homepage?: string;
  remote?: boolean;
  deploymentUrl?: string;
}

interface SmitheryResponse {
  servers?: SmitheryServerItem[];
}

export class SmitheryClient {
  private static readonly BASE_URL = 'https://api.smithery.ai/servers';

  /**
   * Searches the Smithery.ai registry for community and hosted MCP servers.
   */
  static async search(
    query?: string,
    apiKey?: string,
    timeoutMs: number = 3000
  ): Promise<RegistryServerItem[]> {
    try {
      const url = new URL(this.BASE_URL);
      if (query && query.trim()) {
        url.searchParams.set('q', query.trim());
      }

      const key = apiKey || process.env.SMITHERY_API_KEY;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'ContextWise-Proxy/0.1.0',
      };

      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      logger.debug(`Querying Smithery Registry: ${url.toString()}`);
      const res = await fetch(url.toString(), {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.debug(`Smithery API responded with status: ${res.status}`);
        return [];
      }

      const data = (await res.json()) as SmitheryResponse;
      if (!data.servers || !Array.isArray(data.servers)) {
        return [];
      }

      return data.servers
        .filter((item) => Boolean(item && typeof item.qualifiedName === 'string'))
        .map((item) => ({
          id: item.qualifiedName,
        name: item.qualifiedName,
        displayName: item.displayName || item.qualifiedName,
        description: item.description || 'No description provided.',
        source: 'smithery',
        sourceLabel: 'Smithery',
        category: 'marketplace',
        tags: ['smithery', ...(item.verified ? ['verified'] : [])],
        installHint: `contextwise add "${item.qualifiedName}" --smithery`,
        homepage: item.homepage || `https://smithery.ai/servers/${item.qualifiedName}`,
        verified: item.verified,
        requiredParams: [],
        suggestedConfig: this.buildServerConfig(item.qualifiedName, { apiKey: key }),
      }));
    } catch (err) {
      logger.debug(`Smithery Registry query skipped or timed out: ${err}`);
      return [];
    }
  }

  /**
   * Builds an UpstreamServerConfig that runs a Smithery MCP server using @smithery/cli runner.
   */
  static buildServerConfig(
    qualifiedName: string,
    options: { apiKey?: string; env?: Record<string, string> } = {}
  ): UpstreamServerConfig {
    const key = options.apiKey || process.env.SMITHERY_API_KEY;
    const env = { ...(options.env || {}) };

    if (key) {
      env['SMITHERY_API_KEY'] = key;
    }

    return {
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', qualifiedName],
      env,
      autoRestart: true,
    };
  }
}
