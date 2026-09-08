import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SEARCH_TOOLS_NAME = 'contextwise_search_tools';
export const EXECUTE_TOOL_NAME = 'contextwise_execute_tool';
export const BROWSE_SERVERS_NAME = 'contextwise_browse_servers';
export const ADD_SERVER_NAME = 'contextwise_add_server';

export const SEARCH_TOOLS_DEFINITION: Tool = {
  name: SEARCH_TOOLS_NAME,
  description:
    'Searches ContextWise tool catalog for relevant tools based on natural language intent. Returns matched tool signatures, parameter descriptions, and automatically makes them available to invoke.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural language query describing what task you want to perform or which tool you need (e.g., "query postgres database", "read a file", "create git commit")',
      },
      domain: {
        type: 'string',
        description:
          'Optional domain tag to filter tools (e.g., "database", "filesystem", "git", "web", "docker")',
      },
      topK: {
        type: 'number',
        description: 'Maximum number of tools to return (default: 5)',
      },
      activate: {
        type: 'boolean',
        description:
          'Whether to activate the matched tools into the active context window (default: true)',
      },
    },
    required: ['query'],
  },
};

export const EXECUTE_TOOL_DEFINITION: Tool = {
  name: EXECUTE_TOOL_NAME,
  description:
    'Universally executes any indexed upstream tool, even if its schema is not pre-loaded into your active context window. Use this after finding tools via contextwise_search_tools.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'The name or namespaced name of the tool to execute',
      },
      arguments: {
        type: 'object',
        description: 'Arguments to pass to the target tool',
        default: {},
      },
    },
    required: ['tool_name'],
  },
};

export const BROWSE_SERVERS_DEFINITION: Tool = {
  name: BROWSE_SERVERS_NAME,
  description:
    'Browses available MCP servers from local curated presets, the Official MCP Registry, and Smithery. Displays which registry each server is listed in.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional keyword to search for specific servers (e.g., "database", "git", "search", "linear")',
      },
      category: {
        type: 'string',
        description:
          'Optional category filter: "database", "developer", "web", "filesystem", "communication", "devops"',
        enum: ['database', 'developer', 'web', 'filesystem', 'communication', 'devops'],
      },
      source: {
        type: 'string',
        description: 'Filter by registry source: "all" (default), "official", "smithery", or "curated"',
        enum: ['all', 'official', 'smithery', 'curated'],
      },
    },
  },
};

export const ADD_SERVER_DEFINITION: Tool = {
  name: ADD_SERVER_NAME,
  description:
    'Hot-loads a new MCP server into ContextWise in real time, persists it to contextwise.json, and immediately makes all its tools available to this session. Supports presets, Smithery packages, custom stdio commands, and remote SSE URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique identifier name for this server (e.g., "postgres", "github", "my-server")',
      },
      preset: {
        type: 'string',
        description:
          'Optional name of a verified preset to configure (e.g., "postgres", "sqlite", "github", "linear", "fetch", "puppeteer", "brave-search", "slack")',
      },
      smithery: {
        type: 'string',
        description:
          'Optional Smithery package name to install and run via @smithery/cli (e.g. "@smithery-ai/github" or "github")',
      },
      command: {
        type: 'string',
        description: 'Executable command for stdio server (e.g., "npx", "python", "docker")',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command-line arguments to pass to the executable',
      },
      env: {
        type: 'object',
        description: 'Environment variables to pass (e.g., API keys, tokens)',
      },
      url: {
        type: 'string',
        description: 'Remote SSE endpoint URL if connecting to a remote MCP server over HTTP/SSE',
      },
      headers: {
        type: 'object',
        description: 'HTTP headers for remote SSE server (e.g. Authorization)',
      },
    },
    required: ['name'],
  },
};
