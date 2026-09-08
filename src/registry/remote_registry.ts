import { KnownServerRegistry } from './known_servers.js';
import { OfficialRegistryClient } from './official_client.js';
import { SmitheryClient } from './smithery_client.js';
import type { RegistrySearchOptions, RegistryServerItem } from './types.js';

export class UnifiedRegistryClient {
  /**
   * Searches across all available registries (Curated Presets, Official MCP Registry, and Smithery).
   */
  static async search(options: RegistrySearchOptions = {}): Promise<RegistryServerItem[]> {
    const query = options.query?.trim();
    const category = options.category?.trim();
    const source = options.source ?? 'all';
    const limit = options.limit ?? 15;
    const timeoutMs = options.timeoutMs ?? 3000;

    const results: RegistryServerItem[] = [];
    const seenIds = new Set<string>();

    // 1. Curated Built-in Presets
    if (source === 'all' || source === 'curated') {
      const curated = KnownServerRegistry.search(query, category);
      for (const s of curated) {
        seenIds.add(s.id.toLowerCase());
        seenIds.add(s.name.toLowerCase());
        results.push({
          id: s.id,
          name: s.name,
          displayName: s.displayName,
          description: s.description,
          source: 'curated',
          sourceLabel: 'Curated / Verified',
          category: s.category,
          tags: s.tags,
          installHint: `contextwise add ${s.id}`,
          homepage: s.documentationUrl,
          verified: true,
          requiredParams: s.requiredParams,
          suggestedConfig: KnownServerRegistry.buildConfig(s),
        });
      }
    }

    // 2. Fetch remote registries in parallel (fallback to category if query not set)
    const remoteQuery = query || category;
    const promises: Promise<RegistryServerItem[]>[] = [];

    if (source === 'all' || source === 'official') {
      promises.push(OfficialRegistryClient.search(remoteQuery, limit, timeoutMs));
    }

    if (source === 'all' || source === 'smithery') {
      promises.push(
        SmitheryClient.search(remoteQuery, options.smitheryApiKey, timeoutMs)
      );
    }

    if (promises.length > 0) {
      const settled = await Promise.allSettled(promises);
      for (const res of settled) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          for (const server of res.value) {
            const cleanId = server.id.toLowerCase();
            const cleanName = server.name.toLowerCase();

            // Deduplicate if already present from curated list
            if (!seenIds.has(cleanId) && !seenIds.has(cleanName)) {
              seenIds.add(cleanId);
              seenIds.add(cleanName);
              results.push(server);
            }
          }
        }
      }
    }

    return results;
  }
}
