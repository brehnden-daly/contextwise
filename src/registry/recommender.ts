import { ADD_SERVER_NAME } from '../router/meta_tools.js';
import { UnifiedRegistryClient } from './remote_registry.js';
import type { RegistryServerItem } from './types.js';

export interface RecommendationOutput {
  hasRecommendations: boolean;
  message: string;
  recommendedServers: RegistryServerItem[];
}

export class ServerRecommender {
  /**
   * Generates actionable server recommendations when an agent lacks tools for a given task.
   */
  static async recommendForTask(
    query: string,
    domain?: string,
    limit: number = 3
  ): Promise<RecommendationOutput> {
    const servers = await UnifiedRegistryClient.search({
      query,
      category: domain,
      limit,
    });

    if (servers.length === 0) {
      return {
        hasRecommendations: false,
        message: `No matching tools found for query "${query}", and no matching MCP servers were found in online registries.`,
        recommendedServers: [],
      };
    }

    const lines: string[] = [
      `⚠️ Capability Gap Detected: No active tools in your connected ContextWise servers match "${query}".`,
      '',
      `💡 Recommended MCP servers to add for this capability:`,
    ];

    servers.forEach((s, idx) => {
      let installExample = `${ADD_SERVER_NAME}(name: "${s.id}", preset: "${s.id}")`;
      if (s.source === 'smithery') {
        installExample = `${ADD_SERVER_NAME}(name: "${s.id}", smithery: "${s.id}")`;
      } else if (s.source === 'official') {
        installExample = `${ADD_SERVER_NAME}(name: "${s.id}")`;
      }

      const params = s.requiredParams && s.requiredParams.length > 0
        ? `\n   - Required configuration: ${s.requiredParams.map((p) => `\`${p.name}\` (${p.type}: ${p.description})`).join(', ')}`
        : '';

      lines.push(
        `${idx + 1}. **${s.displayName}** (\`${s.id}\`) — Registry: **${s.sourceLabel}**`
      );
      lines.push(`   - ${s.description}${params}`);
      lines.push(`   - Direct install call: \`${installExample}\``);
    });

    lines.push('');
    lines.push(
      `To proceed with this task, invoke \`${ADD_SERVER_NAME}\` with the chosen server (asking the user for any required credentials if needed). ContextWise will immediately hot-load the server and make its tools available in this session without restarting.`
    );

    return {
      hasRecommendations: true,
      message: lines.join('\n'),
      recommendedServers: servers,
    };
  }
}
