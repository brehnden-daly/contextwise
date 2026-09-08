import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ContextWiseConfig,
  ContextWiseConfigSchema,
  UpstreamServerConfig,
} from '../config/schema.js';
import { logger } from '../utils/logger.js';

export class ServerManager {
  /**
   * Finds the path to contextwise.json in the current working directory.
   */
  static findConfigPath(customPath?: string, cwd: string = process.cwd()): string {
    if (customPath) {
      return resolve(cwd, customPath);
    }
    if (process.env.CONTEXTWISE_CONFIG) {
      return resolve(cwd, process.env.CONTEXTWISE_CONFIG);
    }
    const standardPath = resolve(cwd, 'contextwise.json');
    if (existsSync(standardPath)) {
      return standardPath;
    }
    const dotPath = resolve(cwd, '.contextwise.json');
    if (existsSync(dotPath)) {
      return dotPath;
    }
    return standardPath; // Default fallback to create contextwise.json
  }

  /**
   * Loads the current configuration or returns an empty default config.
   */
  static loadConfig(configPath?: string, cwd: string = process.cwd()): { config: ContextWiseConfig; path: string } {
    const filePath = this.findConfigPath(configPath, cwd);
    if (!existsSync(filePath)) {
      return {
        config: ContextWiseConfigSchema.parse({}),
        path: filePath,
      };
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      return {
        config: ContextWiseConfigSchema.parse(JSON.parse(raw)),
        path: filePath,
      };
    } catch (err) {
      logger.warn(`Could not parse existing config at ${filePath}: ${err}. Starting fresh.`);
      return {
        config: ContextWiseConfigSchema.parse({}),
        path: filePath,
      };
    }
  }

  /**
   * Persists an upstream server configuration to contextwise.json.
   */
  static saveUpstream(
    name: string,
    serverConfig: UpstreamServerConfig,
    configPath?: string,
    cwd: string = process.cwd()
  ): string {
    const { config, path: filePath } = this.loadConfig(configPath, cwd);

    config.upstreams[name] = serverConfig;

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Persisted upstream "${name}" into ${filePath}`);
    return filePath;
  }

  /**
   * Removes an upstream server from contextwise.json.
   */
  static removeUpstream(
    name: string,
    configPath?: string,
    cwd: string = process.cwd()
  ): boolean {
    const { config, path: filePath } = this.loadConfig(configPath, cwd);

    if (!config.upstreams[name]) {
      return false;
    }

    delete config.upstreams[name];
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Removed upstream "${name}" from ${filePath}`);
    return true;
  }
}
