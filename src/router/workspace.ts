import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';

export interface WorkspaceContext {
  detectedDomains: string[];
  suggestedQueries: string[];
}

export class WorkspaceContextPrimer {
  /**
   * Scans a workspace directory to detect technical domains and pre-prime relevant tools.
   */
  static analyzeWorkspace(dirPath: string = process.cwd()): WorkspaceContext {
    const domains = new Set<string>();
    const queries = new Set<string>();

    try {
      if (!existsSync(dirPath)) {
        return { detectedDomains: [], suggestedQueries: [] };
      }

      // Check for Git repository
      if (existsSync(resolve(dirPath, '.git'))) {
        domains.add('git');
        queries.add('git status and diff tools');
      }

      // Check for Docker / Containerization
      if (
        existsSync(resolve(dirPath, 'Dockerfile')) ||
        existsSync(resolve(dirPath, 'docker-compose.yml')) ||
        existsSync(resolve(dirPath, 'compose.yaml'))
      ) {
        domains.add('docker');
        queries.add('docker and container tools');
      }

      // Check for SQL / Database files
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name.toLowerCase();
        if (
          name.endsWith('.sql') ||
          name.endsWith('.sqlite') ||
          name.endsWith('.sqlite3') ||
          name === 'prisma' ||
          name.startsWith('prisma.') ||
          name === 'migrations' ||
          name === 'database' ||
          /(?:^|[_.-])(?:db|database|sql)(?:[_.-]|$)/i.test(name)
        ) {
          domains.add('database');
          queries.add('database and SQL query tools');
          break;
        }
      }

      // Always include general filesystem tools
      domains.add('filesystem');

    } catch (err) {
      logger.warn(`Workspace analysis encountered error in ${dirPath}: ${err}`);
    }

    const detectedDomains = Array.from(domains);
    const suggestedQueries = Array.from(queries);

    logger.debug(`Workspace pre-primed domains: ${detectedDomains.join(', ')}`);
    return { detectedDomains, suggestedQueries };
  }
}
