import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  decryptAesGcm,
  deriveSharedSecretX25519,
  encryptAesGcm,
  generateKeyPairX25519,
} from '../vault/crypto.js';
import type { EncryptedEnvelope } from './types.js';

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Creates an asymmetric public-key envelope (X25519 ECDH + AES-256-GCM)
 * encrypting a workspace key specifically for a recipient's device public key.
 */
export function createEnvelope(
  workspaceKey: Buffer,
  recipientPublicKeyPem: string
): EncryptedEnvelope {
  // Generate a one-time ephemeral keypair
  const ephemeral = generateKeyPairX25519();

  // Derive shared ECDH symmetric secret
  const sharedKey = deriveSharedSecretX25519(ephemeral.privateKey, recipientPublicKeyPem);

  // Encrypt the workspace symmetric key using AES-256-GCM
  const { iv, authTag, ciphertext } = encryptAesGcm(
    workspaceKey.toString('base64'),
    sharedKey
  );

  return {
    recipientPublicKey: recipientPublicKeyPem,
    ephemeralPublicKey: ephemeral.publicKey,
    iv,
    authTag,
    ciphertext,
  };
}

/**
 * Opens an asymmetric envelope using the recipient's private key.
 */
export function openEnvelope(
  envelope: EncryptedEnvelope,
  recipientPrivateKeyPem: string
): Buffer {
  const sharedKey = deriveSharedSecretX25519(
    recipientPrivateKeyPem,
    envelope.ephemeralPublicKey
  );

  const decryptedBase64 = decryptAesGcm(
    envelope.ciphertext,
    sharedKey,
    envelope.iv,
    envelope.authTag
  );

  return Buffer.from(decryptedBase64, 'base64');
}

/**
 * Retrieves or generates the local device identity and asymmetric X25519 keypair.
 */
export function getOrCreateDeviceIdentity(storageDir?: string): DeviceIdentity {
  const dir =
    storageDir ||
    process.env.CONTEXTWISE_STORAGE_DIR ||
    join(homedir(), '.contextwise');
  const filePath = join(dir, 'device.json');

  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (data.deviceId && data.publicKey && data.privateKey) {
        return data as DeviceIdentity;
      }
    } catch {
      // Fall through to regenerate if file is corrupt
    }
  }

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const { publicKey, privateKey } = generateKeyPairX25519();
  const deviceId = `cw_dev_${randomBytes(8).toString('hex')}`;

  const identity: DeviceIdentity = {
    deviceId,
    publicKey,
    privateKey,
  };

  writeFileSync(filePath, JSON.stringify(identity, null, 2), {
    mode: 0o600,
    encoding: 'utf-8',
  });

  return identity;
}
