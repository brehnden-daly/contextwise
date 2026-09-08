import { EncryptedFileVaultDriver } from './file_driver.js';
import { OsKeystoreDriver } from './os_driver.js';
import { redactionFilter } from './redaction.js';
import type { SecretMetadata, VaultDriver } from './types.js';

export class SecretVault {
  private driver: VaultDriver;
  private initialized: boolean = false;

  constructor(customDriver?: VaultDriver) {
    this.driver = customDriver ?? new EncryptedFileVaultDriver();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if OS Keystore is available and preferred
    const osDriver = new OsKeystoreDriver();
    if (await osDriver.isAvailable()) {
      this.driver = osDriver;
    } else {
      this.driver = new EncryptedFileVaultDriver();
    }

    this.initialized = true;
  }

  getActiveDriverName(): string {
    return this.driver.name;
  }

  setDriver(driver: VaultDriver): void {
    this.driver = driver;
    this.initialized = true;
  }

  async get(key: string): Promise<string | null> {
    await this.initialize();
    const val = await this.driver.get(key);
    if (val) {
      redactionFilter.registerSecret(val);
    }
    return val;
  }

  async set(
    key: string,
    value: string,
    scope: 'personal' | 'workspace' | 'team' = 'personal'
  ): Promise<void> {
    await this.initialize();
    await this.driver.set(key, value, scope);
    redactionFilter.registerSecret(value);
  }

  async delete(key: string): Promise<boolean> {
    await this.initialize();
    return this.driver.delete(key);
  }

  async list(): Promise<SecretMetadata[]> {
    await this.initialize();
    return this.driver.list();
  }
}

export const secretVault = new SecretVault();
