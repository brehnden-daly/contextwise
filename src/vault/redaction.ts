/**
 * Stream & Text Redaction Engine for ContextWise.
 * Prevents sensitive API keys, database passwords, and vault tokens
 * from leaking into stdout, stderr, logs, or MCP prompt outputs.
 */
export class RedactionFilter {
  private static instance: RedactionFilter | null = null;
  private registeredSecrets: Set<string> = new Set();

  static getInstance(): RedactionFilter {
    if (!RedactionFilter.instance) {
      RedactionFilter.instance = new RedactionFilter();
    }
    return RedactionFilter.instance;
  }

  /**
   * Registers a plaintext secret value to be masked across all output streams.
   */
  registerSecret(secret: string): void {
    if (secret && typeof secret === 'string') {
      const trimmed = secret.trim();
      // Minimum 4 characters to avoid masking common small tokens/integers
      if (trimmed.length >= 4) {
        this.registeredSecrets.add(trimmed);
      }
    }
  }

  registerSecrets(secrets: string[]): void {
    for (const s of secrets) {
      this.registerSecret(s);
    }
  }

  getRegisteredCount(): number {
    return this.registeredSecrets.size;
  }

  clear(): void {
    this.registeredSecrets.clear();
  }

  /**
   * Redacts registered secrets and known API key patterns from an input string.
   */
  redact(input: string): string {
    if (!input || typeof input !== 'string') {
      return input;
    }

    let sanitized = input;

    // 1. Redact exact registered secret values
    for (const secret of this.registeredSecrets) {
      sanitized = sanitized.replaceAll(secret, '[REDACTED_SECRET]');
    }

    // 2. Redact common token patterns as a secondary safety net
    // GitHub PATs
    sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36}/g, 'ghp_[REDACTED_GITHUB_TOKEN]');
    // Anthropic API keys
    sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, 'sk-ant-[REDACTED_ANTHROPIC_KEY]');
    // OpenAI API keys
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{32,}/g, 'sk-[REDACTED_OPENAI_KEY]');
    // Database connection strings containing passwords
    sanitized = sanitized.replace(
      /([a-zA-Z0-9+]+:\/\/[^:]+:)([^@]+)(@.+)/g,
      '$1[REDACTED_PASSWORD]$3'
    );

    return sanitized;
  }
}

export const redactionFilter = RedactionFilter.getInstance();
