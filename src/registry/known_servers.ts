import type { UpstreamServerConfig } from '../config/schema.js';

export type ServerCategory =
  | 'database'
  | 'developer'
  | 'web'
  | 'filesystem'
  | 'communication'
  | 'devops';

export interface RequiredParam {
  name: string;
  type: 'env' | 'arg';
  description: string;
  default?: string;
  placeholder?: string;
}

export interface KnownServerDefinition {
  id: string;
  name: string;
  displayName: string;
  category: ServerCategory;
  description: string;
  tags: string[];
  command: string;
  defaultArgs: string[];
  defaultEnv: Record<string, string>;
  requiredParams: RequiredParam[];
  documentationUrl?: string;
}

export const KNOWN_SERVERS: KnownServerDefinition[] = [
  // --- Databases ---
  {
    id: 'postgres',
    name: 'postgres',
    displayName: 'PostgreSQL Database',
    category: 'database',
    description: 'Inspect schemas, browse tables, and execute read/write SQL queries on PostgreSQL.',
    tags: ['database', 'sql', 'postgres', 'tables'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-postgres'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'connectionString',
        type: 'arg',
        description: 'PostgreSQL connection URL',
        placeholder: 'postgresql://username:password@localhost:5432/mydb',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    displayName: 'SQLite Database',
    category: 'database',
    description: 'Inspect schemas, browse tables, and execute SQL queries on local SQLite database files.',
    tags: ['database', 'sqlite', 'sql', 'local'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'dbPath',
        type: 'arg',
        description: 'Absolute or relative path to SQLite .db file',
        placeholder: './database.sqlite',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },

  // --- Developer Tools ---
  {
    id: 'github',
    name: 'github',
    displayName: 'GitHub Integration',
    category: 'developer',
    description: 'Search repositories, manage pull requests, create issues, and inspect commit history on GitHub.',
    tags: ['git', 'github', 'prs', 'issues', 'code'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-github'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        type: 'env',
        description: 'GitHub Personal Access Token (classic or fine-grained)',
        placeholder: 'ghp_...',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'git',
    name: 'git',
    displayName: 'Local Git Repository',
    category: 'developer',
    description: 'Inspect working trees, git diffs, commits, branches, and logs directly on local git repos.',
    tags: ['git', 'diff', 'commit', 'branches', 'repository'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-git', '--repository'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'repositoryPath',
        type: 'arg',
        description: 'Path to local Git repository root',
        default: '.',
        placeholder: '.',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'gitlab',
    name: 'gitlab',
    displayName: 'GitLab Integration',
    category: 'developer',
    description: 'Manage GitLab projects, merge requests, issues, and pipelines.',
    tags: ['git', 'gitlab', 'ci', 'mr', 'issues'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-gitlab'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        type: 'env',
        description: 'GitLab Personal Access Token',
        placeholder: 'glpat-...',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
  },
  {
    id: 'linear',
    name: 'linear',
    displayName: 'Linear Project Tracking',
    category: 'developer',
    description: 'Search, create, and update Linear issues, teams, projects, and cycles.',
    tags: ['issue', 'linear', 'ticket', 'project', 'tasks'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-linear'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'LINEAR_API_KEY',
        type: 'env',
        description: 'Linear API Key',
        placeholder: 'lin_api_...',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/linear',
  },

  // --- Web, Search & Browser Automation ---
  {
    id: 'brave-search',
    name: 'brave-search',
    displayName: 'Brave Web Search',
    category: 'web',
    description: 'Privacy-preserving real-time web search and local location searches.',
    tags: ['web', 'search', 'brave', 'internet', 'news'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'BRAVE_API_KEY',
        type: 'env',
        description: 'Brave Search API Key from brave.com/search/api',
        placeholder: 'BSA...',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'fetch',
    name: 'fetch',
    displayName: 'Web Fetch & Scraper',
    category: 'web',
    description: 'Fetch web pages, convert HTML to clean Markdown, and inspect HTTP headers.',
    tags: ['web', 'fetch', 'http', 'html', 'scrape'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-fetch'],
    defaultEnv: {},
    requiredParams: [],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'puppeteer',
    name: 'puppeteer',
    displayName: 'Puppeteer Browser Automation',
    category: 'web',
    description: 'Control headless Chrome to navigate pages, capture screenshots, evaluate JS, and interact with web apps.',
    tags: ['web', 'browser', 'puppeteer', 'automation', 'screenshot'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-puppeteer'],
    defaultEnv: {},
    requiredParams: [],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },

  // --- Filesystem & Memory ---
  {
    id: 'filesystem',
    name: 'filesystem',
    displayName: 'Local Filesystem Access',
    category: 'filesystem',
    description: 'Secure scoped filesystem access to read, write, search, and manage files in allowed directories.',
    tags: ['filesystem', 'files', 'disk', 'directory', 'storage'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'allowedDirectory',
        type: 'arg',
        description: 'Root directory allowed for file operations',
        default: '.',
        placeholder: './',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'memory',
    name: 'memory',
    displayName: 'Graph Knowledge Memory',
    category: 'filesystem',
    description: 'Long-term persistent knowledge graph memory using entities, relations, and observations.',
    tags: ['memory', 'knowledge', 'graph', 'persistence', 'history'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-memory'],
    defaultEnv: {},
    requiredParams: [],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },

  // --- Communication ---
  {
    id: 'slack',
    name: 'slack',
    displayName: 'Slack Workspace',
    category: 'communication',
    description: 'Read and send messages, list channels, and reply to threads in Slack workspaces.',
    tags: ['slack', 'chat', 'communication', 'message', 'channels'],
    command: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-slack'],
    defaultEnv: {},
    requiredParams: [
      {
        name: 'SLACK_BOT_TOKEN',
        type: 'env',
        description: 'Slack Bot User OAuth Token (xoxb-...)',
        placeholder: 'xoxb-...',
      },
      {
        name: 'SLACK_TEAM_ID',
        type: 'env',
        description: 'Slack Workspace Team ID (T...)',
        placeholder: 'T...',
      },
    ],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },

  // --- DevOps & Cloud ---
  {
    id: 'docker',
    name: 'docker',
    displayName: 'Docker Container Engine',
    category: 'devops',
    description: 'List, start, stop, and inspect Docker containers, images, and volumes.',
    tags: ['docker', 'container', 'devops', 'images'],
    command: 'npx',
    defaultArgs: ['-y', 'mcp-server-docker'],
    defaultEnv: {},
    requiredParams: [],
    documentationUrl: 'https://github.com/modelcontextprotocol/servers',
  },
];

export class KnownServerRegistry {
  /**
   * Returns all known server definitions.
   */
  static getAll(): KnownServerDefinition[] {
    return KNOWN_SERVERS;
  }

  /**
   * Finds a known server by ID or name.
   */
  static find(idOrName: string): KnownServerDefinition | undefined {
    const clean = idOrName.trim().toLowerCase();
    return KNOWN_SERVERS.find(
      (s) => s.id === clean || s.name.toLowerCase() === clean
    );
  }

  /**
   * Searches known servers by query string and/or category.
   */
  static search(query?: string, category?: ServerCategory | string): KnownServerDefinition[] {
    let list = KNOWN_SERVERS;

    if (category) {
      const catClean = category.toLowerCase();
      list = list.filter((s) => s.category === catClean);
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.includes(q))
      );
    }

    return list;
  }

  /**
   * Returns all unique categories available.
   */
  static getCategories(): string[] {
    const set = new Set<string>();
    for (const s of KNOWN_SERVERS) {
      set.add(s.category);
    }
    return Array.from(set);
  }

  /**
   * Builds an UpstreamServerConfig from a KnownServerDefinition and supplied parameters.
   */
  static buildConfig(
    serverDef: KnownServerDefinition,
    params: {
      args?: string[];
      env?: Record<string, string>;
    } = {}
  ): UpstreamServerConfig {
    const finalArgs = [...serverDef.defaultArgs, ...(params.args ?? [])];
    const finalEnv = { ...serverDef.defaultEnv, ...(params.env ?? {}) };

    return {
      command: serverDef.command,
      args: finalArgs,
      env: finalEnv,
      autoRestart: true,
    };
  }
}
