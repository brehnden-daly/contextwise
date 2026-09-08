import { logger } from '../utils/logger.js';
import type { RegistryServerItem } from './types.js';

interface OfficialRegistryResponse {
  servers?: Array<{
    server: {
      name: string;
      description?: string;
      title?: string;
      version?: string;
      repository?: { url?: string };
      remotes?: Array<{ type: string; url: string }>;
      packages?: Array<{ registryType: string; identifier: string }>;
    };
  }>;
}

export class OfficialRegistryClient {
  private static readonly BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers';

  /**
   * Searches the official canonical MCP registry for public servers.
   */
  static async search(
    query?: string,
    limit: number = 10,
    timeoutMs: number = 3000
  ): Promise<RegistryServerItem[]> {
    try {
      const url = new URL(this.BASE_URL);
      if (query && query.trim()) {
        url.searchParams.set('search', query.trim());
      }
      url.searchParams.set('limit', String(limit));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      logger.debug(`Querying Official MCP Registry: ${url.toString()}`);
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ContextWise-Proxy/0.1.0',
        },
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.debug(`Official MCP Registry responded with status: ${res.status}`);
        return [];
      }

      const data = (await res.json()) as OfficialRegistryResponse;
      if (!data.servers || !Array.isArray(data.servers)) {
        return [];
      }

      return data.servers
        .filter((item) => Boolean(item && item.server && typeof item.server.name === 'string'))
        .map((item) => {
          const s = item.server;
        const remoteUrl = s.remotes?.[0]?.url;
        const npmPkg = s.packages?.find((p) => p.registryType === 'npm')?.identifier;

        return {
          id: s.name,
          name: s.name,
          displayName: s.title || s.name,
          description: s.description || 'No description provided.',
          source: 'official',
          sourceLabel: 'Official MCP Registry',
          category: 'community',
          tags: ['official', 'mcp-registry'],
          installHint: `contextwise add "${s.name}"`,
          homepage:
            s.repository?.url ||
            s.remotes?.[0]?.url ||
            `https://registry.modelcontextprotocol.io`,
          requiredParams: [],
          suggestedConfig: remoteUrl
            ? { url: remoteUrl, headers: {}, transport: 'auto', autoReconnect: true }
            : npmPkg
              ? { command: 'npx', args: ['-y', npmPkg], env: {}, autoRestart: true }
              : undefined,
        };
      });
    } catch (err) {
      logger.debug(`Official MCP Registry query skipped or timed out: ${err}`);
      return [];
    }
  }
}
