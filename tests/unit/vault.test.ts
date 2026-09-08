import { rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  decryptAesGcm,
  deriveKeyFromPassphrase,
  deriveSharedSecretX25519,
  encryptAesGcm,
  generateKeyPairX25519,
} from '../../src/vault/crypto.js';
import { EncryptedFileVaultDriver } from '../../src/vault/file_driver.js';
import { redactionFilter } from '../../src/vault/redaction.js';
import { SecretResolver } from '../../src/vault/resolver.js';
import { VaultAuditor } from '../../src/vault/audit.js';
import { SecretVault } from '../../src/vault/vault.js';
import { createEnvelope, openEnvelope } from '../../src/cloud/crypto.js';
import { ContextWiseConfig, ContextWiseConfigSchema } from '../../src/config/schema.js';

describe('Secret Vault & Cryptographic Core', () => {
  describe('AES-256-GCM & PBKDF2 Crypto', () => {
    it('should encrypt and decrypt plaintext reliably', () => {
      const key = randomBytes(32);
      const plaintext = 'sk-ant-api03-very-secret-agent-key-1234567890';

      const encrypted = encryptAesGcm(plaintext, key);
      expect(encrypted.ciphertext).not.toBe(plaintext);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();

      const decrypted = decryptAesGcm(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );
      expect(decrypted).toBe(plaintext);
    });

    it('should throw error if authentication tag is tampered with', () => {
      const key = randomBytes(32);
      const plaintext = 'confidential-database-password';
      const encrypted = encryptAesGcm(plaintext, key);

      // Tamper with ciphertext
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
      tamperedCiphertext[0] ^= 0xff;

      expect(() => {
        decryptAesGcm(
          tamperedCiphertext.toString('base64'),
          key,
          encrypted.iv,
          encrypted.authTag
        );
      }).toThrow();
    });

    it('should deterministically derive 256-bit keys using PBKDF2', async () => {
      const salt = randomBytes(16);
      const pass = 'super-secure-passphrase';

      const key1 = await deriveKeyFromPassphrase(pass, salt, 10_000);
      const key2 = await deriveKeyFromPassphrase(pass, salt, 10_000);

      expect(key1.length).toBe(32);
      expect(key1.equals(key2)).toBe(true);
    });
  });

  describe('Asymmetric X25519 Envelope Encryption', () => {
    it('should generate valid X25519 keypairs and derive shared secret', () => {
      const alice = generateKeyPairX25519();
      const bob = generateKeyPairX25519();

      expect(alice.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(bob.publicKey).toContain('BEGIN PUBLIC KEY');

      // Alice derives shared secret with Bob's public key
      const sharedAlice = deriveSharedSecretX25519(alice.privateKey, bob.publicKey);
      // Bob derives shared secret with Alice's public key
      const sharedBob = deriveSharedSecretX25519(bob.privateKey, alice.publicKey);

      expect(sharedAlice.length).toBe(32);
      expect(sharedAlice.equals(sharedBob)).toBe(true);
    });

    it('should encrypt workspace key via createEnvelope and open with private key', () => {
      const member = generateKeyPairX25519();
      const workspaceKey = randomBytes(32);

      const envelope = createEnvelope(workspaceKey, member.publicKey);
      expect(envelope.recipientPublicKey).toBe(member.publicKey);
      expect(envelope.ciphertext).toBeDefined();

      const openedKey = openEnvelope(envelope, member.privateKey);
      expect(openedKey.equals(workspaceKey)).toBe(true);
    });

    it('should fail to decrypt envelope with incorrect private key', () => {
      const member = generateKeyPairX25519();
      const attacker = generateKeyPairX25519();
      const workspaceKey = randomBytes(32);

      const envelope = createEnvelope(workspaceKey, member.publicKey);

      expect(() => {
        openEnvelope(envelope, attacker.privateKey);
      }).toThrow();
    });
  });

  describe('EncryptedFileVaultDriver', () => {
    let testVaultPath: string;
    let driver: EncryptedFileVaultDriver;
    const testKey = randomBytes(32);

    beforeEach(() => {
      testVaultPath = join(tmpdir(), `cw_vault_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
      driver = new EncryptedFileVaultDriver(testVaultPath, testKey);
    });

    afterEach(async () => {
      await driver.clear();
      if (existsSync(testVaultPath)) {
        try { rmSync(testVaultPath); } catch {}
      }
    });

    it('should store, retrieve, list, and delete secrets', async () => {
      expect(await driver.get('API_KEY')).toBeNull();

      await driver.set('API_KEY', 'secret_token_123', 'workspace');
      expect(await driver.get('API_KEY')).toBe('secret_token_123');

      const list = await driver.list();
      expect(list.length).toBe(1);
      expect(list[0].key).toBe('API_KEY');
      expect(list[0].scope).toBe('workspace');

      const deleted = await driver.delete('API_KEY');
      expect(deleted).toBe(true);
      expect(await driver.get('API_KEY')).toBeNull();
      expect((await driver.list()).length).toBe(0);
    });

    it('should persist encrypted content to disk and survive reload', async () => {
      await driver.set('GITHUB_PAT', 'ghp_1234567890abcdef1234567890abcdef');
      expect(existsSync(testVaultPath)).toBe(true);

      // New driver instance pointing to same file and key
      const newDriver = new EncryptedFileVaultDriver(testVaultPath, testKey);
      const retrieved = await newDriver.get('GITHUB_PAT');
      expect(retrieved).toBe('ghp_1234567890abcdef1234567890abcdef');
    });
  });

  describe('RedactionFilter', () => {
    beforeEach(() => {
      redactionFilter.clear();
    });

    it('should redact registered custom secrets from output text', () => {
      redactionFilter.registerSecret('my-super-secret-password-xyz');
      const log = 'Connecting to db with password: my-super-secret-password-xyz on port 5432';

      const sanitized = redactionFilter.redact(log);
      expect(sanitized).not.toContain('my-super-secret-password-xyz');
      expect(sanitized).toContain('[REDACTED_SECRET]');
    });

    it('should automatically redact known API key patterns', () => {
      const openAiLog = 'Request sent with Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const anthropicLog = 'Header x-api-key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
      const dbUriLog = 'Connecting to postgres://admin:superSecretPass123@db.example.com:5432/main';

      expect(redactionFilter.redact(openAiLog)).toContain('sk-[REDACTED_OPENAI_KEY]');
      expect(redactionFilter.redact(anthropicLog)).toContain('sk-ant-[REDACTED_ANTHROPIC_KEY]');
      expect(redactionFilter.redact(dbUriLog)).toContain('postgres://admin:[REDACTED_PASSWORD]@db.example.com:5432/main');
    });
  });

  describe('SecretResolver', () => {
    let customDriver: EncryptedFileVaultDriver;
    let customVault: SecretVault;

    beforeEach(async () => {
      customDriver = new EncryptedFileVaultDriver(undefined, randomBytes(32));
      customVault = new SecretVault(customDriver);
      await customVault.set('TEST_API_KEY', 'resolved-secret-abc-999');
    });

    it('should resolve env:// references from environment variables', async () => {
      process.env.CW_TEST_ENV_VAR = 'hello-from-env';
      try {
        const resolved = await SecretResolver.resolveValue('env://${CW_TEST_ENV_VAR}');
        expect(resolved).toBe('hello-from-env');

        const resolvedWithoutBrackets = await SecretResolver.resolveValue('env://CW_TEST_ENV_VAR');
        expect(resolvedWithoutBrackets).toBe('hello-from-env');
      } finally {
        delete process.env.CW_TEST_ENV_VAR;
      }
    });

    it('should pass through literal values untouched', async () => {
      const resolved = await SecretResolver.resolveValue('https://example.com/api');
      expect(resolved).toBe('https://example.com/api');
    });

    it('should resolve full environment dictionary', async () => {
      process.env.CW_PORT = '8080';
      try {
        const envMap = {
          PORT: 'env://${CW_PORT}',
          MODE: 'production',
        };

        const resolved = await SecretResolver.resolveEnv(envMap);
        expect(resolved.PORT).toBe('8080');
        expect(resolved.MODE).toBe('production');
      } finally {
        delete process.env.CW_PORT;
      }
    });
  });

  describe('VaultAuditor', () => {
    it('should detect exposed plaintext API keys and database credentials in config', async () => {
      const insecureConfig: ContextWiseConfig = ContextWiseConfigSchema.parse({
        version: '1.0.0',
        proxy: { transport: 'stdio', port: 3456, logLevel: 'info' },
        routing: { strategy: 'hybrid', topK: 5, similarityThreshold: 0.45, pinnedTools: [] },
        guardrails: { enableCache: true, cacheTtlSeconds: 120, maxCallsPerMinute: 60, loopBreakerThreshold: 3 },
        upstreams: {
          openaiServer: {
            command: 'node',
            args: ['server.js'],
            env: {
              OPENAI_API_KEY: 'sk-1234567890abcdef1234567890abcdef',
              DATABASE_URL: 'postgres://user:secretpass@localhost:5432/mydb',
            },
            autoRestart: true,
          },
          anthropicServer: {
            command: 'node',
            args: ['server.js'],
            env: {
              ANTHROPIC_KEY: 'sk-ant-api03-abcdef1234567890',
            },
            autoRestart: true,
          },
        },
      });

      const report = await VaultAuditor.audit(insecureConfig);
      expect(report.plaintextWarnings.length).toBeGreaterThanOrEqual(3);
      const envVarsWarned = report.plaintextWarnings.map((w) => w.envVar);
      expect(envVarsWarned).toContain('OPENAI_API_KEY');
      expect(envVarsWarned).toContain('DATABASE_URL');
      expect(envVarsWarned).toContain('ANTHROPIC_KEY');
    });

    it('should pass cleanly when config references vault:// and env://', async () => {
      const secureConfig: ContextWiseConfig = ContextWiseConfigSchema.parse({
        version: '1.0.0',
        proxy: { transport: 'stdio', port: 3456, logLevel: 'info' },
        routing: { strategy: 'hybrid', topK: 5, similarityThreshold: 0.45, pinnedTools: [] },
        guardrails: { enableCache: true, cacheTtlSeconds: 120, maxCallsPerMinute: 60, loopBreakerThreshold: 3 },
        upstreams: {
          secureServer: {
            command: 'node',
            args: ['server.js'],
            env: {
              API_KEY: 'vault://SECURE_API_KEY',
              APP_ENV: 'env://${NODE_ENV}',
            },
            autoRestart: true,
          },
        },
      });

      const report = await VaultAuditor.audit(secureConfig);
      expect(report.plaintextWarnings.length).toBe(0);
      expect(report.vaultReferencedCount).toBe(1);
    });
  });
});
