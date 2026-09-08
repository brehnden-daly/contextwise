import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  ContextWiseConfig,
  ContextWiseConfigSchema,
  UpstreamServerConfig,
} from './schema.js';

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
  autoImport?: boolean;
}

export class ConfigLoader {
  /**
   * Discovers and loads configuration from contextwise.json or imported client configs.
   */
  static load(options: LoadConfigOptions = {}): ContextWiseConfig {
    const cwd = options.cwd ?? process.cwd();

    // 0. Environment variable override
    if (process.env.CONTEXTWISE_CONFIG && !options.configPath) {
      const envPath = isAbsolute(process.env.CONTEXTWISE_CONFIG)
        ? process.env.CONTEXTWISE_CONFIG
        : resolve(cwd, process.env.CONTEXTWISE_CONFIG);
      if (existsSync(envPath)) {
        return this.parseConfigFile(envPath);
      }
    }
    if (options.configPath) {
      const explicitPath = isAbsolute(options.configPath)
        ? options.configPath
        : resolve(cwd, options.configPath);

      if (existsSync(explicitPath)) {
        return this.parseConfigFile(explicitPath);
      }
      throw new Error(`Configuration file not found at: ${explicitPath}`);
    }

    // 2. Look for native contextwise.json in current directory or parent
    const candidatePaths = [
      resolve(cwd, 'contextwise.json'),
      resolve(cwd, '.contextwise.json'),
      resolve(cwd, '.contextwise/config.json'),
      resolve(homedir(), '.contextwise/config.json'),
    ];

    for (const candidate of candidatePaths) {
      if (existsSync(candidate)) {
        logger.debug(`Loaded configuration from ${candidate}`);
        return this.parseConfigFile(candidate);
      }
    }

    // 3. Auto-import from known AI client configurations if requested
    if (options.autoImport !== false) {
      const imported = this.autoImportClientConfigs(cwd);
      if (imported && Object.keys(imported.upstreams).length > 0) {
        logger.info(`Auto-discovered MCP servers from existing client configurations`);
        return imported;
      }
    }

    // 4. Return default empty configuration
    logger.debug('No configuration file found. Using defaults.');
    return ContextWiseConfigSchema.parse({});
  }

  /**
   * Parses and validates a JSON file against ContextWiseConfigSchema.
   */
  static parseConfigFile(filePath: string): ContextWiseConfig {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return ContextWiseConfigSchema.parse(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse config at ${filePath}: ${msg}`);
    }
  }

  /**
   * Scans for Cursor and Claude Desktop configs to auto-import upstreams.
   */
  static autoImportClientConfigs(cwd: string): ContextWiseConfig | null {
    const upstreams: Record<string, UpstreamServerConfig> = {};

    // Check .cursor/mcp.json
    const cursorMcp = resolve(cwd, '.cursor', 'mcp.json');
    if (existsSync(cursorMcp)) {
      try {
        const raw = JSON.parse(readFileSync(cursorMcp, 'utf-8'));
        if (raw.mcpServers && typeof raw.mcpServers === 'object') {
          for (const [name, server] of Object.entries(raw.mcpServers)) {
            if (name === 'contextwise') continue; // Skip self
            const s = server as Record<string, unknown>;
            if (typeof s.command === 'string') {
              upstreams[name] = {
                command: s.command,
                args: Array.isArray(s.args) ? (s.args as string[]) : [],
                env: (s.env as Record<string, string>) ?? {},
                autoRestart: true,
              };
            } else if (typeof s.url === 'string') {
              upstreams[name] = {
                url: s.url,
                headers: (s.headers as Record<string, string>) ?? {},
                transport: 'auto',
                autoReconnect: true,
              };
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed reading ${cursorMcp}: ${err}`);
      }
    }

    // Check Claude Desktop config
    const claudePath = this.getClaudeDesktopConfigPath();
    if (claudePath && existsSync(claudePath)) {
      try {
        const raw = JSON.parse(readFileSync(claudePath, 'utf-8'));
        if (raw.mcpServers && typeof raw.mcpServers === 'object') {
          for (const [name, server] of Object.entries(raw.mcpServers)) {
            if (name === 'contextwise') continue;
            const s = server as Record<string, unknown>;
            if (typeof s.command === 'string' && !upstreams[name]) {
              upstreams[name] = {
                command: s.command,
                args: Array.isArray(s.args) ? (s.args as string[]) : [],
                env: (s.env as Record<string, string>) ?? {},
                autoRestart: true,
              };
            } else if (typeof s.url === 'string' && !upstreams[name]) {
              upstreams[name] = {
                url: s.url,
                headers: (s.headers as Record<string, string>) ?? {},
                transport: 'auto',
                autoReconnect: true,
              };
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed reading Claude config at ${claudePath}: ${err}`);
      }
    }

    if (Object.keys(upstreams).length === 0) {
      return null;
    }

    return ContextWiseConfigSchema.parse({
      upstreams,
    });
  }

  static getClaudeDesktopConfigPath(): string | null {
    const platform = process.platform;
    const home = homedir();

    if (platform === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appData, 'Claude', 'claude_desktop_config.json');
    } else if (platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else {
      return join(home, '.config', 'Claude', 'claude_desktop_config.json');
    }
  }
}
