import type { NamespacedTool } from '../core/types.js';

export interface NormalizedToolDocument {
  id: string; // namespacedName
  toolName: string;
  originalName: string;
  serverName: string;
  description: string;
  parametersText: string;
  tagsText: string;
  fullSearchableText: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

export class ToolNormalizer {
  /**
   * Normalizes a NamespacedTool into a searchable document for BM25 and vector indexing.
   */
  static normalize(tool: NamespacedTool): NormalizedToolDocument {
    const paramsList: string[] = [];
    const schema = tool.inputSchema as Record<string, unknown> | undefined;

    if (schema && typeof schema.properties === 'object' && schema.properties !== null) {
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      for (const [paramName, paramDef] of Object.entries(properties)) {
        const type = typeof paramDef?.type === 'string' ? paramDef.type : 'any';
        const desc = typeof paramDef?.description === 'string' ? paramDef.description : '';
        paramsList.push(`${paramName} (${type}): ${desc}`);
      }
    }

    const parametersText = paramsList.join('; ');
    const tags = this.inferTags(tool);
    const tagsText = tags.join(', ');

    const fullSearchableText = [
      `Tool: ${tool.originalName} (${tool.namespacedName})`,
      `Server: ${tool.serverName}`,
      `Description: ${tool.description || ''}`,
      paramsList.length > 0 ? `Parameters: ${parametersText}` : '',
      tags.length > 0 ? `Tags: ${tagsText}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      id: tool.namespacedName,
      toolName: tool.namespacedName,
      originalName: tool.originalName,
      serverName: tool.serverName,
      description: tool.description || '',
      parametersText,
      tagsText,
      fullSearchableText,
      readOnlyHint: tool.readOnlyHint ?? false,
      destructiveHint: tool.destructiveHint ?? false,
    };
  }

  /**
   * Infers domain categorization tags from tool names and descriptions.
   */
  static inferTags(tool: NamespacedTool): string[] {
    const text = `${tool.namespacedName} ${tool.originalName} ${tool.description || ''}`.toLowerCase();
    const tags = new Set<string>();

    const tagRules: Record<string, RegExp> = {
      database: /\b(db|sql|postgres|mysql|sqlite|mongo|query|table|schema|database)\b/i,
      filesystem: /\b(file|dir|directory|folder|read_file|write_file|fs|path)\b/i,
      git: /\b(git|commit|branch|repo|repository|pull_request|pr|diff|merge)\b/i,
      code: /\b(code|ast|syntax|refactor|symbol|definition|function)\b/i,
      docker: /\b(docker|container|image|compose|podman)\b/i,
      cloud: /\b(aws|gcp|azure|s3|ec2|lambda|cloud)\b/i,
      communication: /\b(slack|discord|email|message|chat|notify|channel)\b/i,
      web: /\b(http|url|fetch|request|scrape|browser|crawl|api)\b/i,
      issue: /\b(jira|issue|linear|ticket|bug|task|tracker)\b/i,
    };

    for (const [tag, regex] of Object.entries(tagRules)) {
      if (regex.test(text)) {
        tags.add(tag);
      }
    }

    if (tool.readOnlyHint) tags.add('read-only');
    if (tool.destructiveHint) tags.add('destructive');

    return Array.from(tags);
  }
}
