import { z } from 'zod';

export const StdioUpstreamConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  cwd: z.string().optional(),
  autoRestart: z.boolean().default(true),
});

export const HttpUpstreamConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  transport: z.enum(['streamable-http', 'sse', 'auto']).default('auto'),
  autoReconnect: z.boolean().default(true),
});

export const UpstreamServerConfigSchema = z.union([
  StdioUpstreamConfigSchema,
  HttpUpstreamConfigSchema,
]);

export function warnIfInsecureHttp(urlStr: string, headers?: Record<string, string>): void {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'http:') {
      const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
      if (!isLocalhost && headers) {
        const hasAuthHeader = Object.keys(headers).some((h) =>
          ['authorization', 'cookie', 'x-api-key', 'api-key', 'token'].includes(h.toLowerCase())
        );
        if (hasAuthHeader) {
          console.warn(
            `[SECURITY WARNING] Upstream URL "${urlStr}" is using unencrypted HTTP with sensitive authentication headers to non-localhost destination "${parsed.hostname}".`
          );
        }
      }
    }
  } catch {
    // ignore invalid URL
  }
}

export function isStdioUpstream(
  config: UpstreamServerConfig
): config is z.infer<typeof StdioUpstreamConfigSchema> {
  return 'command' in config;
}

export function isHttpUpstream(
  config: UpstreamServerConfig
): config is z.infer<typeof HttpUpstreamConfigSchema> {
  return 'url' in config;
}

export const ProxyConfigSchema = z.object({
  transport: z.enum(['stdio', 'sse', 'http']).default('stdio'),
  port: z.number().int().min(1024).max(65535).default(3456),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export const RoutingConfigSchema = z.object({
  strategy: z.enum(['hybrid', 'bm25', 'vector', 'passthrough']).default('hybrid'),
  topK: z.number().int().min(1).max(50).default(5),
  similarityThreshold: z.number().min(0).max(1).default(0.45),
  pinnedTools: z.array(z.string()).default([]),
  maxActiveTools: z.number().int().min(1).max(100).default(10),
  enableBrowseServers: z.boolean().default(false),
  enableAddServer: z.boolean().default(false),
  allowCustomCommands: z.boolean().default(false),
  persistAddedServers: z.boolean().default(false),
});

export const GuardrailsConfigSchema = z.object({
  enableCache: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().min(1).default(120),
  maxCallsPerMinute: z.number().int().min(1).default(60),
  loopBreakerThreshold: z.number().int().min(1).default(3),
  callTimeoutMs: z.number().int().min(1000).default(30000),
});

export const ContextWiseConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.string().default('1.0.0'),
  proxy: ProxyConfigSchema.default({}),
  routing: RoutingConfigSchema.default({}),
  guardrails: GuardrailsConfigSchema.default({}),
  upstreams: z.record(UpstreamServerConfigSchema).default({}),
});

export type StdioUpstreamConfig = z.infer<typeof StdioUpstreamConfigSchema>;
export type HttpUpstreamConfig = z.infer<typeof HttpUpstreamConfigSchema>;
export type UpstreamServerConfig = z.infer<typeof UpstreamServerConfigSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
export type GuardrailsConfig = z.infer<typeof GuardrailsConfigSchema>;
export type ContextWiseConfig = z.infer<typeof ContextWiseConfigSchema>;
