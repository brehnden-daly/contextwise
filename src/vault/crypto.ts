import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  pbkdf2,
  randomBytes,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, homedir, hostname, platform, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export interface AesGcmResult {
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

/**
 * Encrypts UTF-8 plaintext using AES-256-GCM with a 96-bit random IV.
 */
export function encryptAesGcm(plaintext: string, key: Buffer): AesGcmResult {
  if (key.length !== 32) {
    throw new Error(`Invalid AES-256 key length: expected 32 bytes, got ${key.length}`);
  }

  const iv = randomBytes(12); // 96 bits recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
  ciphertext += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext,
  };
}

/**
 * Decrypts AES-256-GCM ciphertext, verifying the 128-bit authentication tag.
 */
export function decryptAesGcm(
  ciphertext: string,
  key: Buffer,
  ivBase64: string,
  authTagBase64: string
): string {
  if (key.length !== 32) {
    throw new Error(`Invalid AES-256 key length: expected 32 bytes, got ${key.length}`);
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

/**
 * Standard OWASP-recommended PBKDF2 iterations for SHA-512 key derivation.
 */
export const VAULT_PBKDF2_ITERATIONS = 210_000;

/**
 * Derives a 256-bit encryption key from a passphrase using PBKDF2 with SHA-512.
 */
export function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Buffer,
  iterations: number = VAULT_PBKDF2_ITERATIONS
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(passphrase, salt, iterations, 32, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Derives a key for the local encrypted vault.
 *
 * Security & Threat Model:
 * By default, this derives a deterministic machine-bound key from OS user and hardware
 * parameters and a random 32-byte salt stored at ~/.contextwise/.machine_salt (mode 0600).
 * This protects secrets against accidental repository commits, copy-pasting, and unprivileged processes.
 * For defense-in-depth against local attackers with read access to ~/.contextwise, users can set
 * the CONTEXTWISE_VAULT_PASSPHRASE environment variable, which derives the key directly from
 * their secret user passphrase instead of machine identifiers.
 */
export async function getOrCreateMachineKey(): Promise<Buffer> {
  const saltDir = join(homedir(), '.contextwise');
  const saltPath = join(saltDir, '.machine_salt');

  let salt: Buffer;
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath);
  } else {
    mkdirSync(saltDir, { recursive: true });
    salt = randomBytes(32);
    writeFileSync(saltPath, salt, { mode: 0o600 });
  }

  // Passphrase mode takes precedence if provided
  if (process.env.CONTEXTWISE_VAULT_PASSPHRASE) {
    return deriveKeyFromPassphrase(process.env.CONTEXTWISE_VAULT_PASSPHRASE, salt, VAULT_PBKDF2_ITERATIONS);
  }

  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return 'default_user';
    }
  })();

  const machineId = `${hostname()}-${user}-${platform()}-${arch()}-contextwise-vault-v1`;
  return deriveKeyFromPassphrase(machineId, salt, VAULT_PBKDF2_ITERATIONS);
}

/**
 * Generates an asymmetric X25519 keypair for team member envelope encryption.
 */
export function generateKeyPairX25519(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Derives a shared symmetric secret using ECDH / X25519 for team secret sharing.
 */
export function deriveSharedSecretX25519(privateKeyPem: string, publicKeyPem: string): Buffer {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(publicKeyPem);
  const shared = diffieHellman({
    privateKey,
    publicKey,
  });
  // Hash the raw shared secret with SHA-256 to produce an exact 32-byte AES key
  return createHash('sha256').update(shared).digest();
}
