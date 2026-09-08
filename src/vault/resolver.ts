import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { redactionFilter } from './redaction.js';
import { secretVault } from './vault.js';

/**
 * Secret Reference Resolver.
 * Resolves secret references in upstream server environment configurations:
 * - vault://<key> -> Resolves from ContextWise encrypted vault
 * - auth://<server> or mcp-auth://<server> -> Resolves from OpenCode mcp-auth.json
 * - env://${VAR_NAME} or env://VAR_NAME -> Resolves from system environment variables
 * - literal string -> Passed through directly (and registered for redaction if sensitive)
 */
export class SecretResolver {
  /**
   * Resolves a single secret token reference (vault://, auth://, env://).
   */
  static async resolveSingleRef(ref: string, allowReferences: boolean = true): Promise<string> {
    const trimmed = ref.trim();

    // 1. Vault reference: vault://<key>
    if (trimmed.startsWith('vault://')) {
      if (!allowReferences) {
        throw new Error(
          'Security violation: "vault://" secret references are strictly prohibited in dynamic/untrusted server configurations.'
        );
      }

      const secretKey = trimmed.slice('vault://'.length).trim();
      if (!secretKey) {
        throw new Error('Invalid vault reference format: expected "vault://<key>"');
      }

      const secretValue = await secretVault.get(secretKey);
      if (secretValue === null || secretValue === undefined) {
        throw new Error(
          `Vault secret "${secretKey}" was not found in the ContextWise vault. ` +
          `Set it using: contextwise secret set "${secretKey}" <value>`
        );
      }

      redactionFilter.registerSecret(secretValue);
      return secretValue;
    }

    // 2. OpenCode OAuth store reference: auth://<server> or mcp-auth://<server>
    if (trimmed.startsWith('auth://') || trimmed.startsWith('mcp-auth://')) {
      if (!allowReferences) {
        throw new Error(
          'Security violation: "auth://" secret references are strictly prohibited in dynamic/untrusted server configurations.'
        );
      }

      const serverKey = trimmed.replace(/^(?:auth|mcp-auth):\/\//, '').trim();
      if (!serverKey) {
        throw new Error('Invalid auth reference format: expected "auth://<server>"');
      }

      const mcpAuthPath = join(homedir(), '.local', 'share', 'opencode', 'mcp-auth.json');
      if (existsSync(mcpAuthPath)) {
        try {
          const authData = JSON.parse(readFileSync(mcpAuthPath, 'utf-8'));
          const token = authData[serverKey]?.tokens?.accessToken;
          if (token) {
            redactionFilter.registerSecret(token);
            return token;
          }
        } catch (e) {
          logger.warn(`Failed to read token from ${mcpAuthPath}: ${e}`);
        }
      }

      throw new Error(
        `OAuth access token for "${serverKey}" was not found in ${mcpAuthPath}. ` +
        `Ensure you are authenticated in OpenCode with: opencode mcp auth ${serverKey}`
      );
    }

    // 3. Environment variable reference: env://${VAR_NAME} or env://VAR_NAME
    if (trimmed.startsWith('env://')) {
      if (!allowReferences) {
        throw new Error(
          'Security violation: "env://" environment variable references are strictly prohibited in dynamic/untrusted server configurations.'
        );
      }

      let varName = trimmed.slice('env://'.length).trim();
      if (varName.startsWith('${') && varName.endsWith('}')) {
        varName = varName.slice(2, -1).trim();
      }

      const envVal = process.env[varName];
      if (envVal === undefined) {
        logger.warn(`Environment variable "${varName}" referenced via env:// is not defined`);
        return '';
      }

      redactionFilter.registerSecret(envVal);
      return envVal;
    }

    return trimmed;
  }

  /**
   * Resolves a single configuration value that may contain a vault://, auth://, or env:// reference.
   * If allowReferences is false, secret references are rejected to prevent unauthorized vault access.
   */
  static async resolveValue(val: string, allowReferences: boolean = true): Promise<string> {
    if (!val || typeof val !== 'string') {
      return val;
    }

    const trimmed = val.trim();

    // Check for references anywhere in the string (e.g. "Bearer auth://robinhood")
    const matches = Array.from(
      trimmed.matchAll(/(vault:\/\/[^\s"',]+|auth:\/\/[^\s"',]+|mcp-auth:\/\/[^\s"',]+|env:\/\/(?:\$\{[^}]+\}|[^\s"',]+))/g)
    );
    if (matches.length > 0) {
      let result = trimmed;
      for (const m of matches) {
        const fullRef = m[0];
        const resolved = await this.resolveSingleRef(fullRef, allowReferences);
        result = result.replace(fullRef, resolved);
      }
      return result;
    }

    // Plaintext/Literal value
    // Check if it matches high-confidence sensitive token patterns to register with redaction
    if (
      trimmed.startsWith('sk-') ||
      trimmed.startsWith('ghp_') ||
      trimmed.startsWith('gho_') ||
      trimmed.startsWith('glpat-') ||
      trimmed.startsWith('xoxb-') ||
      trimmed.startsWith('xoxp-') ||
      /^eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(trimmed)
    ) {
      redactionFilter.registerSecret(trimmed);
    }

    return val;
  }

  /**
   * Resolves an environment dictionary, replacing all vault:// and env:// references.
   */
  static async resolveEnv(
    envMap?: Record<string, string>,
    allowReferences: boolean = true
  ): Promise<Record<string, string>> {
    if (!envMap || typeof envMap !== 'object') {
      return {};
    }

    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(envMap)) {
      if (typeof value === 'string') {
        resolved[key] = await this.resolveValue(value, allowReferences);
      } else {
        resolved[key] = String(value);
      }
    }

    return resolved;
  }
}
