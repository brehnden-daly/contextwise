import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  decryptAesGcm,
  encryptAesGcm,
  getOrCreateMachineKey,
  VAULT_PBKDF2_ITERATIONS,
} from './crypto.js';
import type { EncryptedVaultPayload, SecretMetadata, VaultDriver } from './types.js';

interface StoredSecretEntry {
  value: string;
  metadata: SecretMetadata;
}

export function getDefaultVaultFilePath(): string {
  if (process.env.CONTEXTWISE_VAULT_PATH) {
    return process.env.CONTEXTWISE_VAULT_PATH;
  }
  return join(homedir(), '.contextwise', 'vault.enc.json');
}

export class EncryptedFileVaultDriver implements VaultDriver {
  readonly name = 'encrypted_file';
  private filePath: string;
  private keyPromise: Promise<Buffer>;
  private cache: Map<string, StoredSecretEntry> | null = null;

  constructor(filePath?: string, customKey?: Buffer) {
    this.filePath = filePath ?? getDefaultVaultFilePath();
    this.keyPromise = customKey ? Promise.resolve(customKey) : getOrCreateMachineKey();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private async load(): Promise<Map<string, StoredSecretEntry>> {
    if (this.cache) {
      return this.cache;
    }

    this.cache = new Map();

    if (!existsSync(this.filePath)) {
      return this.cache;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const payload = JSON.parse(raw) as EncryptedVaultPayload;

      if (payload.cipher !== 'aes-256-gcm' || !payload.data) {
        logger.warn(`Corrupt or incompatible vault file at ${this.filePath}`);
        return this.cache;
      }

      const key = await this.keyPromise;
      const decryptedJson = decryptAesGcm(payload.data, key, payload.iv, payload.authTag);
      const entries = JSON.parse(decryptedJson) as Record<string, StoredSecretEntry>;

      for (const [k, v] of Object.entries(entries)) {
        this.cache.set(k, v);
      }
    } catch (err) {
      logger.warn(`Failed to decrypt vault file at ${this.filePath}: ${err}`);
    }

    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const key = await this.keyPromise;
    const entries: Record<string, StoredSecretEntry> = {};
    for (const [k, v] of this.cache.entries()) {
      entries[k] = v;
    }

    const plaintext = JSON.stringify(entries);
    const { iv, authTag, ciphertext } = encryptAesGcm(plaintext, key);

    const payload: EncryptedVaultPayload = {
      version: 1,
      kdf: {
        algorithm: 'pbkdf2-sha512',
        salt: 'machine-bound',
        iterations: VAULT_PBKDF2_ITERATIONS,
      },
      cipher: 'aes-256-gcm',
      iv,
      authTag,
      data: ciphertext,
    };

    const tempPath = `${this.filePath}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600, encoding: 'utf-8' });
    try {
      renameSync(tempPath, this.filePath);
    } catch {
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), { mode: 0o600, encoding: 'utf-8' });
      try { unlinkSync(tempPath); } catch {}
    }
  }

  async get(key: string): Promise<string | null> {
    const store = await this.load();
    const entry = store.get(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    scope: 'personal' | 'workspace' | 'team' = 'personal'
  ): Promise<void> {
    const store = await this.load();
    const now = Date.now();
    const existing = store.get(key);

    store.set(key, {
      value,
      metadata: {
        key,
        scope,
        backend: this.name,
        createdAt: existing?.metadata.createdAt ?? now,
        updatedAt: now,
      },
    });

    await this.persist();
    logger.debug(`Stored secret "${key}" in ${this.name} vault`);
  }

  async delete(key: string): Promise<boolean> {
    const store = await this.load();
    if (!store.has(key)) {
      return false;
    }

    store.delete(key);
    await this.persist();
    logger.debug(`Deleted secret "${key}" from ${this.name} vault`);
    return true;
  }

  async list(): Promise<SecretMetadata[]> {
    const store = await this.load();
    return Array.from(store.values()).map((e) => e.metadata);
  }

  /**
   * Resets and clears all cached and persisted secrets.
   */
  async clear(): Promise<void> {
    this.cache = new Map();
    if (existsSync(this.filePath)) {
      try {
        unlinkSync(this.filePath);
      } catch {}
    }
  }
}
