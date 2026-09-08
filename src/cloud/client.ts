import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import type {
  BillingPortalResult,
  CheckoutSessionResult,
  CloudAuthToken,
  CloudClientOptions,
  CloudProfileInfo,
  DeviceMetadata,
  SyncPullResult,
  SyncPushPayload,
  SyncPushResult,
  WorkspaceMetadata,
} from './types.js';

export class ContextWiseCloudClient {
  private apiUrl: string;
  private storageDir: string;
  private allowOfflineSimulation: boolean;
  private token: CloudAuthToken | null = null;

  constructor(options: CloudClientOptions = {}) {
    this.apiUrl =
      options.apiUrl ||
      process.env.CONTEXTWISE_API_URL ||
      'https://contextwise.dev';
    this.storageDir =
      options.storageDir ||
      process.env.CONTEXTWISE_STORAGE_DIR ||
      join(homedir(), '.contextwise');
    this.allowOfflineSimulation = options.allowOfflineSimulation ?? false;
    this.loadToken();
  }

  private getTokenPath(): string {
    return join(this.storageDir, 'auth.json');
  }

  private loadToken(): void {
    const tokenPath = this.getTokenPath();
    if (existsSync(tokenPath)) {
      try {
        const raw = readFileSync(tokenPath, 'utf-8');
        this.token = JSON.parse(raw) as CloudAuthToken;
      } catch {
        this.token = null;
      }
    }
  }

  saveToken(token: CloudAuthToken): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    this.token = token;
    writeFileSync(this.getTokenPath(), JSON.stringify(token, null, 2), {
      mode: 0o600,
      encoding: 'utf-8',
    });
  }

  clearToken(): void {
    this.token = null;
    const tokenPath = this.getTokenPath();
    if (existsSync(tokenPath)) {
      try {
        unlinkSync(tokenPath);
      } catch {}
    }
  }

  getToken(): CloudAuthToken | null {
    if (!this.token) {
      this.loadToken();
    }
    return this.token;
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;
    return token.expiresAt > Date.now();
  }

  /**
   * Starts RFC 8628 device authorization flow.
   */
  async startDeviceFlow(): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    const res = await fetch(`${this.apiUrl}/v1/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Failed to initiate device login: HTTP ${res.status}`);
    }

    return (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
  }

  /**
   * Polls device token until user approves the code in their browser.
   */
  async pollDeviceToken(
    deviceCode: string,
    intervalSeconds = 5,
    maxWaitMs = 15 * 60 * 1000
  ): Promise<CloudAuthToken> {
    const start = Date.now();
    const intervalMs = Math.max(intervalSeconds * 1000, 2000);

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, intervalMs));

      try {
        const res = await fetch(`${this.apiUrl}/v1/auth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            token: string;
            userId: string;
            email: string;
            expiresAt: number;
          };

          const authToken: CloudAuthToken = {
            token: data.token,
            userId: data.userId,
            email: data.email,
            expiresAt: data.expiresAt,
          };

          this.saveToken(authToken);
          return authToken;
        }

        if (res.status === 428) {
          // Authorization pending, continue polling
          continue;
        }

        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message || `Device authorization failed: HTTP ${res.status}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Device authorization failed')) {
          throw err;
        }
      }
    }

    throw new Error('Device authorization timed out. Please try logging in again.');
  }

  /**
   * Authenticates using a user API token or personal access key.
   */
  async loginWithKey(apiKey: string): Promise<CloudAuthToken> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error('API key cannot be empty');
    }

    try {
      const res = await fetch(`${this.apiUrl}/v1/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmed}`,
        },
      });

      if (!res.ok) {
        // If remote backend is not reachable or endpoint returns 401
        if (res.status === 401 || res.status === 403) {
          throw new Error('Invalid or expired ContextWise Cloud API key.');
        }
        throw new Error(`Cloud API returned HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as {
        userId: string;
        email: string;
        expiresAt: number;
      };

      const authToken: CloudAuthToken = {
        token: trimmed,
        userId: data.userId,
        email: data.email,
        expiresAt: data.expiresAt || Date.now() + 30 * 24 * 3600 * 1000,
      };

      this.saveToken(authToken);
      return authToken;
    } catch (err) {
      // In offline / staging test scenarios, provide fallback verification only if simulation is explicitly permitted
      if (this.allowOfflineSimulation && (trimmed.startsWith('cw_test_') || trimmed.startsWith('cw_live_'))) {
        const dummyToken: CloudAuthToken = {
          token: trimmed,
          userId: 'usr_dev_' + trimmed.slice(-6),
          email: 'developer@contextwise.dev',
          expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
        };
        this.saveToken(dummyToken);
        return dummyToken;
      }
      throw err;
    }
  }

  /**
   * Retrieves profile information for current authenticated account.
   */
  async whoami(): Promise<CloudProfileInfo> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not logged in. Run "contextwise login" first.');
    }

    try {
      const res = await fetch(`${this.apiUrl}/v1/user/profile`, {
        headers: { Authorization: `Bearer ${token.token}` },
      });

      if (res.ok) {
        return (await res.json()) as CloudProfileInfo;
      }
      if (!this.allowOfflineSimulation) {
        throw new Error(`Failed to fetch profile: HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      if (!this.allowOfflineSimulation) {
        throw err;
      }
    }

    return {
      userId: token.userId,
      email: token.email,
      plan: 'free',
      subscriptionStatus: 'inactive',
      currentPeriodEnd: null,
      workspaces: [
        {
          id: 'ws_default',
          name: 'Personal Workspace',
          role: 'owner',
          activeRevision: 1,
          updatedAt: Date.now(),
        },
      ],
      devices: [],
    };
  }

  /**
   * Initiates Stripe Checkout session for Pro or Team upgrade.
   */
  async createCheckoutSession(
    plan: 'pro' | 'team' = 'pro',
    interval: 'month' | 'year' = 'month'
  ): Promise<CheckoutSessionResult> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not logged in. Run "contextwise login" first.');
    }

    const res = await fetch(`${this.apiUrl}/v1/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({ plan, interval }),
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(errData.message || `Failed to create checkout session: HTTP ${res.status}`);
    }

    return (await res.json()) as CheckoutSessionResult;
  }

  /**
   * Generates Stripe Customer Portal session to manage subscription and invoices.
   */
  async createPortalSession(): Promise<BillingPortalResult> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not logged in. Run "contextwise login" first.');
    }

    const res = await fetch(`${this.apiUrl}/v1/billing/portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(errData.message || `Failed to open billing portal: HTTP ${res.status}`);
    }

    return (await res.json()) as BillingPortalResult;
  }

  /**
   * Pushes a workspace snapshot (config + encrypted vault) to the Cloudflare Workers / D1 backend.
   */
  async pushSync(payload: SyncPushPayload): Promise<SyncPushResult> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not logged in. Run "contextwise login" first.');
    }

    try {
      const res = await fetch(`${this.apiUrl}/v1/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return (await res.json()) as SyncPushResult;
      }

      if (res.status === 402) {
        const payData = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          upgradeUrl?: string;
        };
        throw new Error(
          `${payData.message || 'Cloud Sync requires an upgraded subscription.'}\nUpgrade at: ${payData.upgradeUrl || 'https://contextwise.dev/#pricing'}`
        );
      }

      if (res.status === 409) {
        // Conflict detected
        const conflictData = (await res.json()) as SyncPushResult;
        return {
          status: 'conflict',
          revision: payload.baseRevision,
          serverRevision: conflictData.serverRevision,
          serverPayload: conflictData.serverPayload,
        };
      }

      throw new Error(`Push sync failed: HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      // If plan upgrade is required, rethrow error to user
      if (
        err instanceof Error &&
        (err.message.includes('requires an upgraded subscription') ||
          err.message.includes('Cloud Sync requires'))
      ) {
        throw err;
      }

      // Offline / simulation fallback only when explicitly enabled
      if (this.allowOfflineSimulation) {
        logger.debug(`Cloud API push endpoint unreachable (${err}). Using local snapshot commit.`);
        return {
          status: 'committed',
          revision: payload.baseRevision + 1,
        };
      }

      throw err;
    }
  }

  /**
   * Pulls the latest workspace snapshot (config + encrypted vault) from the cloud backend.
   */
  async pullSync(
    workspaceId: string,
    sinceRevision: number = 0
  ): Promise<SyncPullResult | null> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not logged in. Run "contextwise login" first.');
    }

    try {
      const res = await fetch(
        `${this.apiUrl}/v1/sync/pull?workspaceId=${encodeURIComponent(
          workspaceId
        )}&since=${sinceRevision}`,
        {
          headers: { Authorization: `Bearer ${token.token}` },
        }
      );

      if (res.ok) {
        return (await res.json()) as SyncPullResult;
      }
      if (res.status === 304) {
        return null; // Already up to date
      }
    } catch (err) {
      logger.debug(`Cloud API pull endpoint unreachable: ${err}`);
    }

    return null;
  }
}

export const cloudClient = new ContextWiseCloudClient();
