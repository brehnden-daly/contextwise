import type { ContextWiseConfig } from '../config/schema.js';
import type { EncryptedVaultPayload } from '../vault/types.js';

export interface CloudAuthToken {
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
}

export interface DeviceMetadata {
  deviceId: string;
  deviceName: string;
  platform: string;
  publicKey: string; // X25519 public key PEM
  lastSeenAt: number;
}

export interface WorkspaceMetadata {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  activeRevision: number;
  updatedAt: number;
}

export interface EncryptedEnvelope {
  recipientPublicKey: string; // X25519 public key of recipient device/user
  ephemeralPublicKey: string; // Ephemeral X25519 public key used for ECDH
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64 encrypted workspace key
}

export interface SyncPushPayload {
  workspaceId: string;
  deviceId: string;
  baseRevision: number;
  config: ContextWiseConfig;
  encryptedVault: EncryptedVaultPayload;
  envelopes?: EncryptedEnvelope[];
  timestamp: number;
}

export interface SyncPushResult {
  status: 'committed' | 'conflict';
  revision: number;
  serverRevision?: number;
  message?: string;
  serverPayload?: SyncPullResult;
}

export interface SyncPullResult {
  workspaceId: string;
  revision: number;
  config: ContextWiseConfig;
  encryptedVault: EncryptedVaultPayload;
  envelopes?: EncryptedEnvelope[];
  timestamp: number;
}

export interface CloudClientOptions {
  apiUrl?: string;
  authToken?: string;
  storageDir?: string;
  allowOfflineSimulation?: boolean;
}

export interface CloudProfileInfo {
  userId: string;
  email: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  subscriptionStatus: string;
  currentPeriodEnd?: number | null;
  workspaces: WorkspaceMetadata[];
  devices: DeviceMetadata[];
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  plan: string;
  interval: string;
}

export interface BillingPortalResult {
  portalUrl: string;
}
