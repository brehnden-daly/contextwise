import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ServerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NamespacedTool extends Tool {
  /** Original name as reported by upstream server */
  originalName: string;
  /** Scoped name exposed to client: `${serverName}__${originalName}` or unchanged if unconflicted */
  namespacedName: string;
  /** Name of upstream server providing this tool */
  serverName: string;
  /** Inferred domain/category tags for routing */
  tags?: string[];
  /** Behavioral hints */
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
}

export interface UpstreamServerStatus {
  name: string;
  status: ServerConnectionStatus;
  transportType: 'stdio' | 'sse' | 'http' | 'streamable-http';
  toolsCount: number;
  lastConnected?: Date;
  error?: string;
}

export interface ToolExecutionRequest {
  toolName: string;
  arguments?: Record<string, unknown>;
  sessionContext?: string;
}

export interface ToolExecutionResponse {
  result: CallToolResult;
  cached?: boolean;
  latencyMs: number;
  serverName: string;
}

export interface UpstreamClientEvents {
  toolsChanged: (serverName: string, tools: NamespacedTool[]) => void;
  statusChanged: (serverName: string, status: ServerConnectionStatus, error?: string) => void;
}
