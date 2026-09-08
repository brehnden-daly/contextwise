import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getOrCreateDeviceIdentity } from '../../src/cloud/crypto.js';
import { ContextWiseCloudClient } from '../../src/cloud/client.js';
import { SyncManager } from '../../src/cloud/sync_manager.js';
import { ContextWiseConfig, ContextWiseConfigSchema } from '../../src/config/schema.js';

describe('ContextWise Cloud Sync', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `cw_cloud_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('Device Identity & Key Management', () => {
    it('should generate and persist device identity and X25519 keypair', () => {
      const identity1 = getOrCreateDeviceIdentity(testDir);
      expect(identity1.deviceId).toMatch(/^cw_dev_[a-f0-9]{16}$/);
      expect(identity1.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(identity1.privateKey).toContain('BEGIN PRIVATE KEY');

      // Re-read should return identical keypair
      const identity2 = getOrCreateDeviceIdentity(testDir);
      expect(identity2.deviceId).toBe(identity1.deviceId);
      expect(identity2.publicKey).toBe(identity1.publicKey);
      expect(identity2.privateKey).toBe(identity1.privateKey);
    });
  });

  describe('ContextWiseCloudClient', () => {
    it('should throw network errors by default when offline and simulation is false', async () => {
      // Default: allowOfflineSimulation is false
      const client = new ContextWiseCloudClient({ storageDir: testDir, apiUrl: 'https://invalid-nonexistent-domain-12345.xyz' });
      await expect(client.loginWithKey('cw_test_developer_key')).rejects.toThrow();
    });

    it('should authenticate with developer test key in simulation mode and persist token', async () => {
      const client = new ContextWiseCloudClient({ storageDir: testDir, allowOfflineSimulation: true });
      expect(client.isAuthenticated()).toBe(false);

      const token = await client.loginWithKey('cw_test_developer_key_999');
      expect(token.email).toBe('developer@contextwise.dev');
      expect(client.isAuthenticated()).toBe(true);

      const retrieved = client.getToken();
      expect(retrieved?.token).toBe('cw_test_developer_key_999');

      client.clearToken();
      expect(client.isAuthenticated()).toBe(false);
      expect(client.getToken()).toBeNull();
    });

    it('should return whoami profile for authenticated account in simulation mode', async () => {
      const client = new ContextWiseCloudClient({ storageDir: testDir, allowOfflineSimulation: true });
      await client.loginWithKey('cw_test_user_key');

      const profile = await client.whoami();
      expect(profile.email).toBe('developer@contextwise.dev');
      expect(profile.workspaces.length).toBeGreaterThan(0);
      expect(profile.workspaces[0].role).toBe('owner');
    });

    it('should commit push sync payloads and increment revision in simulation mode', async () => {
      const client = new ContextWiseCloudClient({ storageDir: testDir, allowOfflineSimulation: true });
      await client.loginWithKey('cw_test_sync_key');

      const config: ContextWiseConfig = ContextWiseConfigSchema.parse({
        version: '1.0.0',
        proxy: { transport: 'stdio', port: 3456, logLevel: 'info' },
        routing: { strategy: 'hybrid', topK: 5, similarityThreshold: 0.45, pinnedTools: [] },
        guardrails: { enableCache: true, cacheTtlSeconds: 120, maxCallsPerMinute: 60, loopBreakerThreshold: 3 },
        upstreams: {},
      });

      const result = await client.pushSync({
        workspaceId: 'ws_test',
        deviceId: 'dev_test',
        baseRevision: 0,
        config,
        encryptedVault: {
          version: 1,
          kdf: { algorithm: 'pbkdf2-sha512', salt: '', iterations: 50000 },
          cipher: 'aes-256-gcm',
          iv: '',
          authTag: '',
          data: '',
        },
        timestamp: Date.now(),
      });

      expect(result.status).toBe('committed');
      expect(result.revision).toBe(1);
    });
  });

  describe('SyncManager', () => {
    it('should initialize and report local sync status', () => {
      const manager = new SyncManager(testDir);
      const status = manager.getStatus();

      expect(status.revision).toBe(0);
      expect(status.lastSyncedAt).toBe(0);
      expect(status.workspaceId).toBe('ws_default');
    });
  });
});
