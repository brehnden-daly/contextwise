import type { ContextWiseConfig } from '../config/schema.js';
import { isHttpUpstream, isStdioUpstream } from '../config/schema.js';
import { redactionFilter } from './redaction.js';
import type { SecretAuditReport } from './types.js';
import { secretVault } from './vault.js';

export class VaultAuditor {
  /**
   * Scans configuration for plaintext API keys, database credentials, and unvaulted secrets.
   */
  static async audit(config: ContextWiseConfig): Promise<SecretAuditReport> {
    await secretVault.initialize();

    const upstreams = config.upstreams || {};
    const serverNames = Object.keys(upstreams);
    let vaultReferencedCount = 0;
    const warnings: SecretAuditReport['plaintextWarnings'] = [];

    for (const serverName of serverNames) {
      const server = upstreams[serverName];

      if (isStdioUpstream(server) && server.env) {
        for (const [envVar, val] of Object.entries(server.env)) {
          const strVal = String(val);

          if (strVal.startsWith('vault://')) {
            vaultReferencedCount++;
            continue;
          }

          if (strVal.startsWith('env://')) {
            continue;
          }

          const finding = this.evaluateSecret(serverName, envVar, strVal);
          if (finding) {
            warnings.push(finding);
          }
        }
      }

      if (isHttpUpstream(server) && server.headers) {
        for (const [headerKey, headerVal] of Object.entries(server.headers)) {
          const strVal = String(headerVal);

          if (strVal.startsWith('vault://')) {
            vaultReferencedCount++;
            continue;
          }

          if (strVal.startsWith('env://')) {
            continue;
          }

          const finding = this.evaluateSecret(serverName, `header:${headerKey}`, strVal);
          if (finding) {
            warnings.push(finding);
          }
        }
      }
    }

    return {
      timestamp: Date.now(),
      totalUpstreams: serverNames.length,
      vaultReferencedCount,
      plaintextWarnings: warnings,
      activeDriver: secretVault.getActiveDriverName(),
      registeredSecretCount: redactionFilter.getRegisteredCount(),
    };
  }

  private static evaluateSecret(
    serverName: string,
    keyName: string,
    value: string
  ): SecretAuditReport['plaintextWarnings'][number] | null {
    const trimmed = value.trim();

    // 1. Check known API key signatures
    if (trimmed.startsWith('sk-ant-')) {
      return {
        serverName,
        envVar: keyName,
        severity: 'critical',
        reason: 'Plaintext Anthropic API key exposed in configuration',
        suggestion: `Store in vault: contextwise secret set ${serverName.toUpperCase()}_ANTHROPIC_KEY <value>`,
      };
    }

    if (trimmed.startsWith('sk-')) {
      return {
        serverName,
        envVar: keyName,
        severity: 'critical',
        reason: 'Plaintext OpenAI API key exposed in configuration',
        suggestion: `Store in vault: contextwise secret set ${serverName.toUpperCase()}_OPENAI_KEY <value>`,
      };
    }

    if (trimmed.startsWith('ghp_') || trimmed.startsWith('github_pat_')) {
      return {
        serverName,
        envVar: keyName,
        severity: 'critical',
        reason: 'Plaintext GitHub Personal Access Token exposed in configuration',
        suggestion: `Store in vault: contextwise secret set ${serverName.toUpperCase()}_GITHUB_TOKEN <value>`,
      };
    }

    if (/^[a-zA-Z0-9+]+:\/\/[^:]+:[^@]+@.+/.test(trimmed)) {
      return {
        serverName,
        envVar: keyName,
        severity: 'critical',
        reason: 'Database URI with embedded password exposed in configuration',
        suggestion: `Store connection string in vault: contextwise secret set ${serverName.toUpperCase()}_DB_URL <value>`,
      };
    }

    // 2. Check variable naming heuristics
    const lowerKey = keyName.toLowerCase();
    const sensitiveNamePattern = /(key|token|secret|password|passwd|auth|bearer|credential)/;
    if (sensitiveNamePattern.test(lowerKey)) {
      return {
        serverName,
        envVar: keyName,
        severity: 'warn',
        reason: `Potential credential stored in plaintext ("${keyName}")`,
        suggestion: `Store in vault: contextwise secret set ${serverName.toUpperCase()}_${keyName.toUpperCase()} <value>`,
      };
    }

    return null;
  }
}
