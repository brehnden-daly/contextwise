import type { UpstreamServerConfig } from '../config/schema.js';
import type { RequiredParam } from './known_servers.js';

export type RegistrySource = 'curated' | 'official' | 'smithery';

export interface RegistryServerItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  source: RegistrySource;
  sourceLabel: string;
  category: string;
  tags: string[];
  installHint: string;
  homepage?: string;
  verified?: boolean;
  requiredParams: RequiredParam[];
  suggestedConfig?: UpstreamServerConfig;
}

export interface RegistrySearchOptions {
  query?: string;
  category?: string;
  source?: RegistrySource | 'all';
  limit?: number;
  timeoutMs?: number;
  smitheryApiKey?: string;
}
