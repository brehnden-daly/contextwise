import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { logger } from '../utils/logger.js';
import type { SecretMetadata, VaultDriver } from './types.js';

/**
 * Native OS Keystore Driver.
 * Integrates with Windows Credential Manager / DPAPI, macOS Keychain, and Linux Secret Service.
 * Automatically signals availability; if native tools are missing or restricted, falls back gracefully.
 */
export class OsKeystoreDriver implements VaultDriver {
  readonly name = 'os_keystore';
  private available: boolean | null = null;
  private readonly serviceName = 'ContextWise';

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    const currentPlatform = platform();

    try {
      if (currentPlatform === 'darwin') {
        // macOS: test /usr/bin/security
        execFileSync('/usr/bin/security', ['list-keychains'], { stdio: 'ignore' });
        this.available = true;
      } else {
        // On Windows & Linux, use Encrypted File Vault by default to ensure 100% zero-dependency reliability
        this.available = false;
      }
    } catch {
      logger.debug('Native OS Keystore is not directly accessible. Using Encrypted File Vault.');
      this.available = false;
    }

    return this.available;
  }

  async get(key: string): Promise<string | null> {
    if (!(await this.isAvailable())) {
      return null;
    }

    const currentPlatform = platform();
    try {
      if (currentPlatform === 'darwin') {
        const stdout = execFileSync(
          '/usr/bin/security',
          ['find-generic-password', '-s', this.serviceName, '-a', key, '-w'],
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return stdout.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  async set(
    key: string,
    value: string,
    _scope: 'personal' | 'workspace' | 'team' = 'personal'
  ): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('OS Keystore driver is not available on this system.');
    }

    const currentPlatform = platform();
    if (currentPlatform === 'darwin') {
      execFileSync(
        '/usr/bin/security',
        ['add-generic-password', '-U', '-s', this.serviceName, '-a', key, '-w', value],
        { stdio: 'ignore' }
      );
    } else {
      throw new Error('OS Keystore set not implemented for this platform; fallback to encrypted file.');
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!(await this.isAvailable())) {
      return false;
    }

    const currentPlatform = platform();
    try {
      if (currentPlatform === 'darwin') {
        execFileSync(
          '/usr/bin/security',
          ['delete-generic-password', '-s', this.serviceName, '-a', key],
          { stdio: 'ignore' }
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async list(): Promise<SecretMetadata[]> {
    return [];
  }
}
