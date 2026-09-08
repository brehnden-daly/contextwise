import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigLoader } from '../config/loader.js';
import {
  ContextWiseConfig,
  ContextWiseConfigSchema,
  isStdioUpstream,
} from '../config/schema.js';
import { logger } from '../utils/logger.js';
import { getDefaultVaultFilePath } from '../vault/file_driver.js';
import type { EncryptedVaultPayload } from '../vault/types.js';
import { cloudClient } from './client.js';
import { getOrCreateDeviceIdentity } from './crypto.js';
import type { SyncPullResult, SyncPushPayload, SyncPushResult } from './types.js';

interface LocalSyncState {
  workspaceId: string;
  revision: number;
  lastSyncedAt: number;
}

export class SyncManager {
  private syncStatePath: string;
  private localConfigPath?: string;

  constructor(storageDir?: string, localConfigPath?: string) {
    const dir = storageDir || join(homedir(), '.contextwise');
    this.syncStatePath = join(dir, 'sync.json');
    this.localConfigPath = localConfigPath;
  }

  private loadSyncState(): LocalSyncState {
    if (existsSync(this.syncStatePath)) {
      try {
        const raw = readFileSync(this.syncStatePath, 'utf-8');
        return JSON.parse(raw) as LocalSyncState;
      } catch {
        // Corrupt file fallback
      }
    }
    return {
      workspaceId: 'ws_default',
      revision: 0,
      lastSyncedAt: 0,
    };
  }

  private saveSyncState(state: LocalSyncState): void {
    writeFileSync(this.syncStatePath, JSON.stringify(state, null, 2), {
      mode: 0o600,
      encoding: 'utf-8',
    });
  }

  /**
   * Pushes local configuration and encrypted vault payload to the cloud.
   */
  async push(workspaceId?: string): Promise<SyncPushResult> {
    const state = this.loadSyncState();
    const wsId = workspaceId || state.workspaceId;
    const device = getOrCreateDeviceIdentity();
    const localConfig = ConfigLoader.load();

    const vaultPath = getDefaultVaultFilePath();
    let encryptedVault: EncryptedVaultPayload;

    if (existsSync(vaultPath)) {
      try {
        const rawVault = readFileSync(vaultPath, 'utf-8');
        encryptedVault = JSON.parse(rawVault) as EncryptedVaultPayload;
      } catch {
        encryptedVault = this.createEmptyEncryptedVault();
      }
    } else {
      encryptedVault = this.createEmptyEncryptedVault();
    }

    const payload: SyncPushPayload = {
      workspaceId: wsId,
      deviceId: device.deviceId,
      baseRevision: state.revision,
      config: localConfig,
      encryptedVault,
      timestamp: Date.now(),
    };

    const result = await cloudClient.pushSync(payload);

    if (result.status === 'committed') {
      state.workspaceId = wsId;
      state.revision = result.revision;
      state.lastSyncedAt = Date.now();
      this.saveSyncState(state);
      logger.info(`Successfully pushed revision #${result.revision} to ContextWise Cloud.`);
    }

    return result;
  }

  /**
   * Pulls the latest cloud configuration and merges upstream servers.
   */
  async pull(workspaceId?: string): Promise<SyncPullResult | null> {
    const state = this.loadSyncState();
    const wsId = workspaceId || state.workspaceId;

    const pullResult = await cloudClient.pullSync(wsId, state.revision);
    if (!pullResult) {
      logger.info('Local configuration is already up to date.');
      return null;
    }

    // Merge upstreams into local contextwise.json if present
    if (pullResult.config && pullResult.config.upstreams) {
      this.mergeConfigIntoLocal(pullResult.config);
    }

    // Update encrypted vault if newer
    if (pullResult.encryptedVault && pullResult.encryptedVault.data) {
      const vaultPath = getDefaultVaultFilePath();
      writeFileSync(vaultPath, JSON.stringify(pullResult.encryptedVault, null, 2), {
        mode: 0o600,
        encoding: 'utf-8',
      });
    }

    state.revision = pullResult.revision;
    state.lastSyncedAt = Date.now();
    this.saveSyncState(state);

    logger.info(`Pulled and applied cloud revision #${pullResult.revision}.`);
    return pullResult;
  }

  /**
   * Semantically merges remote configuration into local contextwise.json.
   */
  private mergeConfigIntoLocal(remoteConfig: ContextWiseConfig): void {
    const validatedRemote = ContextWiseConfigSchema.parse(remoteConfig);
    const configPath =
      this.localConfigPath ||
      process.env.CONTEXTWISE_CONFIG ||
      join(process.cwd(), 'contextwise.json');
    let localConfig: ContextWiseConfig;

    if (existsSync(configPath)) {
      try {
        localConfig = ContextWiseConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf-8')));
      } catch {
        localConfig = ContextWiseConfigSchema.parse({});
      }
    } else {
      localConfig = ContextWiseConfigSchema.parse({});
    }

    // Security Guard: Check for new stdio commands from remote
    for (const [name, s] of Object.entries(validatedRemote.upstreams || {})) {
      if (isStdioUpstream(s) && !localConfig.upstreams[name]) {
        logger.warn(
          `[Cloud Sync Security] Remote configuration contains new stdio upstream "${name}" (${s.command}). ` +
          `Verify this server in contextwise.json before execution.`
        );
      }
    }

    // Merge upstreams: preserve local ones, add new remote ones
    const mergedUpstreams = {
      ...(validatedRemote.upstreams || {}),
      ...(localConfig.upstreams || {}),
    };

    const merged: ContextWiseConfig = {
      ...localConfig,
      upstreams: mergedUpstreams,
    };

    writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  private createEmptyEncryptedVault(): EncryptedVaultPayload {
    return {
      version: 1,
      kdf: {
        algorithm: 'pbkdf2-sha512',
        salt: 'empty',
        iterations: 50_000,
      },
      cipher: 'aes-256-gcm',
      iv: '',
      authTag: '',
      data: '',
    };
  }

  getStatus(): {
    isLoggedIn: boolean;
    userEmail?: string;
    workspaceId: string;
    revision: number;
    lastSyncedAt: number;
    deviceId: string;
  } {
    const token = cloudClient.getToken();
    const state = this.loadSyncState();
    const device = getOrCreateDeviceIdentity();

    return {
      isLoggedIn: cloudClient.isAuthenticated(),
      userEmail: token?.email,
      workspaceId: state.workspaceId,
      revision: state.revision,
      lastSyncedAt: state.lastSyncedAt,
      deviceId: device.deviceId,
    };
  }
}

export const syncManager = new SyncManager();
