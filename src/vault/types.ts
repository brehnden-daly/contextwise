export interface SecretMetadata {
  key: string;
  scope: 'personal' | 'workspace' | 'team';
  backend: string;
  createdAt: number;
  updatedAt: number;
}

export interface EncryptedVaultPayload {
  version: number;
  kdf: {
    algorithm: string;
    salt: string; // base64
    iterations: number;
  };
  cipher: 'aes-256-gcm';
  iv: string; // base64
  authTag: string; // base64
  data: string; // base64 ciphertext of JSON Record<string, { value: string; metadata: SecretMetadata }>
}

export interface VaultDriver {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, scope?: 'personal' | 'workspace' | 'team'): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<SecretMetadata[]>;
}

export interface SecretAuditReport {
  timestamp: number;
  totalUpstreams: number;
  vaultReferencedCount: number;
  plaintextWarnings: Array<{
    serverName: string;
    envVar: string;
    severity: 'critical' | 'warn';
    reason: string;
    suggestion: string;
  }>;
  activeDriver: string;
  registeredSecretCount: number;
}
