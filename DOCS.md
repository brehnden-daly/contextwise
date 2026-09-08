# ContextWise Technical Documentation & Reference Manual

> **Dynamic Model Context Protocol (MCP) Tool Routing, Schema Compression & Execution Gateway**  
> Complete technical reference for ContextWise proxy features, routing algorithms, configuration parameters, CLI commands, secret vault, and guardrails.

---

## Table of Contents

1. [Architecture & Core Concepts](#1-architecture--core-concepts)
2. [Installation & Client Integration](#2-installation--client-integration)
   - [Claude Code](#claude-code)
   - [Cursor IDE](#cursor-ide)
   - [Google Antigravity](#google-antigravity)
   - [Claude Desktop](#claude-desktop)
   - [Windsurf](#windsurf)
3. [Configuration Reference (contextwise.json)](#3-configuration-reference-contextwisejson)
   - [Discovery & Load Hierarchy](#discovery--load-hierarchy)
   - [Full JSON Schema](#full-json-schema)
   - [Proxy Settings (`proxy`)](#proxy-settings-proxy)
   - [Routing Settings (`routing`)](#routing-settings-routing)
   - [Guardrails Settings (`guardrails`)](#guardrails-settings-guardrails)
   - [Upstream Server Declarations (`upstreams`)](#upstream-server-declarations-upstreams)
4. [CLI Command Reference](#4-cli-command-reference)
   - [`contextwise start`](#contextwise-start)
   - [`contextwise init`](#contextwise-init)
   - [`contextwise browse`](#contextwise-browse)
   - [`contextwise add`](#contextwise-add)
   - [`contextwise list`](#contextwise-list)
   - [`contextwise stats`](#contextwise-stats)
   - [`contextwise secret` (Vault Management)](#contextwise-secret-vault-management)
   - [`contextwise` Cloud & Sync Commands](#contextwise-cloud--sync-commands)
5. [In-Chat Meta-Tools Specification](#5-in-chat-meta-tools-specification)
   - [`contextwise_search_tools`](#contextwise_search_tools)
   - [`contextwise_execute_tool`](#contextwise_execute_tool)
   - [`contextwise_browse_servers`](#contextwise_browse_servers)
   - [`contextwise_add_server`](#contextwise_add_server)
6. [Secret Vault & Credential Security](#6-secret-vault--credential-security)
   - [The `vault://` and `env://` Protocols](#the-vault-and-env-protocols)
   - [OS Keystores & File Encryption](#os-keystores--file-encryption)
   - [Stream Redaction Filter](#stream-redaction-filter)
   - [Security Audit Scanner](#security-audit-scanner)
7. [Guardrails & Reliability Engine](#7-guardrails--reliability-engine)
   - [Pre-Flight Ajv Schema Validation](#pre-flight-ajv-schema-validation)
   - [SHA-256 Idempotent Response Cache](#sha-256-idempotent-response-cache)
   - [Runaway Loop Breaker & Velocity Capping](#runaway-loop-breaker--velocity-capping)
   - [Process Supervisor & Windows Escaping](#process-supervisor--windows-escaping)
8. [Multi-Registry Discovery (Official, Smithery, Curated)](#8-multi-registry-discovery-official-smithery-curated)
9. [Metrics & Cost Analytics Engine](#9-metrics--cost-analytics-engine)
10. [Environment Variables Reference](#10-environment-variables-reference)
11. [Troubleshooting & Diagnostics](#11-troubleshooting--diagnostics)

---

## 1. Architecture & Core Concepts

ContextWise operates as a **local reverse proxy** between an AI client application (such as Cursor, Claude Code, Antigravity, or Claude Desktop) and multiple upstream Model Context Protocol (MCP) servers.

```
┌────────────────────────────────────────────────────────────────────────┐
│              AI Client: Cursor / Claude Code / Antigravity             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ JSON-RPC 2.0 (stdio / SSE)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        CONTEXTWISE PROXY GATEWAY                       │
│                                                                        │
│  • Meta-Tools: contextwise_search_tools & contextwise_execute_tool     │
│  • Dynamic Router: BM25 Intent Search + Trigram + Capability Ranking   │
│  • Guardrails: Pre-Flight Ajv Schema Validator + Circuit Loop Breaker  │
│  • Cache: SHA-256 Content-Addressable Read Cache (<1 ms execution)     │
│  • Security: AES-256-GCM OS Keystore Vault + Real-Time Stream Redactor │
└────────┬──────────────────────────┬───────────────────────────┬────────┘
         │ stdio                    │ stdio                     │ SSE / HTTP
         ▼                          ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  Postgres MCP    │       │  GitHub MCP      │       │  Linear MCP      │
│  (32 tools)      │       │  (28 tools)      │       │  (14 tools)      │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

### The Context Bloat Problem
Connecting multiple MCP servers dumps **all** tool schemas directly into every conversation turn. A typical developer stack (Postgres, GitHub, Slack, AWS, Linear, Filesystem) exposes 80–150 tools, consuming **12,000 to 25,000+ input tokens** per prompt turn before any code is sent. This causes:
- Excessive latency and high Time-To-First-Token (TTFT)
- Severe token burn and API cost inflation
- Tool hallucination and argument type confusion
- Unbounded retry loops when tool executions fail

### ContextWise Execution Modes
ContextWise solves context bloat through four operational modes:

1. **Mode 1: Dynamic Meta-Tooling (Default)**  
   ContextWise presents only two lightweight meta-tools (`contextwise_search_tools` and `contextwise_execute_tool`) plus any explicitly `pinnedTools`. Upstream tools are indexed locally. The agent searches by natural language intent and dynamically invokes tools on demand, cutting context tokens by **70–98%**.
2. **Mode 2: List-Changed Event Push**  
   When tools are activated, ContextWise dispatches standard MCP `notifications/tools/list_changed` events so compatible clients refresh their active tool inventory in real-time.
3. **Mode 3: Raw Passthrough Mode**  
   Bypasses indexing and routing, aggregating all upstream tools and exposing them directly. Useful for benchmarking or legacy setups. Enabled via `--passthrough` or `"strategy": "passthrough"`.
4. **Mode 4: Workspace Pre-Priming**  
   ContextWise inspects project markers in the working directory (e.g., `.git`, `package.json`, `Dockerfile`, `Cargo.toml`, `requirements.txt`, SQL migrations) and pre-seeds relevant tools automatically.

---

## 2. Installation & Client Integration

### Global Installation via npm
```bash
npm install -g contextwise
```

### Zero-Install Execution via npx
```bash
npx contextwise start
```

---

### Client Integration Guides

#### Claude Code
Add ContextWise to Claude Code with a single CLI command:
```bash
claude mcp add contextwise -- npx -y contextwise start
```

#### Cursor IDE
Add to your project root in `.cursor/mcp.json` or globally in Cursor Settings > Features > MCP Servers:
```json
{
  "mcpServers": {
    "contextwise": {
      "command": "npx",
      "args": ["-y", "contextwise", "start"]
    }
  }
}
```

#### Google Antigravity
Add to your Antigravity MCP configuration file (`~/.gemini/config/mcp_config.json` or workspace settings):
```json
{
  "mcpServers": {
    "contextwise": {
      "command": "contextwise",
      "args": ["start"]
    }
  }
}
```
*On Windows, wrap batch calls if needed:*
```json
{
  "mcpServers": {
    "contextwise": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "contextwise", "start"]
    }
  }
}
```

#### Claude Desktop
Add to your Claude Desktop configuration file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "contextwise": {
      "command": "npx",
      "args": ["-y", "contextwise", "start"]
    }
  }
}
```

#### Windsurf
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "contextwise": {
      "command": "contextwise",
      "args": ["start"]
    }
  }
}
```

---

## 3. Configuration Reference (contextwise.json)

### Discovery & Load Hierarchy
ContextWise resolves its configuration using the following priority order:
1. Explicit CLI argument: `contextwise start --config <path>`
2. Environment variable: `CONTEXTWISE_CONFIG=<path>`
3. Current working directory: `./contextwise.json`
4. Hidden file in current working directory: `./.contextwise.json`
5. Workspace folder: `./.contextwise/config.json`
6. User home directory: `~/.contextwise/config.json`
7. Auto-Import Fallback: Scans `.cursor/mcp.json`, `claude_desktop_config.json`, and `mcp_config.json` to import existing servers automatically.

---

### Full JSON Schema
```json
{
  "$schema": "https://contextwise.dev/schema/v1.json",
  "version": "1.0.0",
  "proxy": {
    "transport": "stdio",
    "port": 3456,
    "logLevel": "info"
  },
  "routing": {
    "strategy": "hybrid",
    "topK": 5,
    "similarityThreshold": 0.45,
    "pinnedTools": [
      "filesystem__read_file",
      "git__git_status"
    ],
    "maxActiveTools": 15,
    "enableBrowseServers": false,
    "enableAddServer": false,
    "allowCustomCommands": false,
    "persistAddedServers": false
  },
  "guardrails": {
    "enableCache": true,
    "cacheTtlSeconds": 120,
    "maxCallsPerMinute": 60,
    "loopBreakerThreshold": 3,
    "callTimeoutMs": 30000
  },
  "upstreams": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/mydb"],
      "env": {
        "POSTGRES_PASSWORD": "vault://PROD_DB_PASS"
      },
      "cwd": "./",
      "autoRestart": true
    },
    "remote-docs": {
      "url": "https://mcp.docs.example.com/sse",
      "headers": {
        "Authorization": "Bearer vault://DOCS_API_KEY"
      },
      "transport": "auto",
      "autoReconnect": true
    }
  }
}
```

---

### Proxy Settings (`proxy`)

| Field | Type | Default | Valid Values | Description |
| :--- | :--- | :--- | :--- | :--- |
| `transport` | string | `"stdio"` | `"stdio"`, `"sse"`, `"http"` | Transport protocol used to communicate with the client application. |
| `port` | integer | `3456` | `1024` to `65535` | HTTP/SSE server listening port when running in network mode. |
| `logLevel` | string | `"info"` | `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"` | Diagnostic logging threshold. Logs are written to `stderr` or `~/.contextwise/contextwise.log`. |

---

### Routing Settings (`routing`)

| Field | Type | Default | Range / Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| `strategy` | string | `"hybrid"` | `"hybrid"`, `"bm25"`, `"vector"`, `"passthrough"` | Tool discovery algorithm. `hybrid` combines BM25 keyword search with trigram fuzzy matching. |
| `topK` | integer | `5` | `1` to `50` | Maximum number of matching tools returned and activated per search query. |
| `similarityThreshold` | float | `0.45` | `0.0` to `1.0` | Minimum relevance score required for a tool to match an intent query. |
| `pinnedTools` | string[] | `[]` | Array of tool names | Tool names (or `server__tool` names) that are always kept active in the client context window. |
| `maxActiveTools` | integer | `10` | `1` to `100` | Upper boundary on dynamically activated tools in the context window. Evicts least recently used. |
| `enableBrowseServers` | boolean | `false` | `true` / `false` | If `true`, exposes `contextwise_browse_servers` meta-tool to the LLM. |
| `enableAddServer` | boolean | `false` | `true` / `false` | If `true`, exposes `contextwise_add_server` meta-tool allowing the model to install new MCP servers. |
| `allowCustomCommands` | boolean | `false` | `true` / `false` | Guardrail for `add_server`. When `false`, restricts additions to curated presets and verified packages. |
| `persistAddedServers` | boolean | `false` | `true` / `false` | If `true`, servers added in chat are written permanently to `contextwise.json`. |

---

### Guardrails Settings (`guardrails`)

| Field | Type | Default | Range / Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| `enableCache` | boolean | `true` | `true` / `false` | Enables SHA-256 idempotent response caching for read-only tools. |
| `cacheTtlSeconds` | integer | `120` | `>= 1` | Time-to-live for cached tool responses in seconds. |
| `maxCallsPerMinute` | integer | `60` | `>= 1` | Velocity rate-limiter. Blocks runaway scripts or loops exceeding this threshold. |
| `loopBreakerThreshold` | integer | `3` | `>= 1` | Consecutive identical failures before tripping the circuit breaker. |
| `callTimeoutMs` | integer | `30000` | `>= 1000` | Maximum execution time in milliseconds before a tool execution is aborted. |

---

### Upstream Server Declarations (`upstreams`)

The `upstreams` object defines the child MCP servers multiplexed by ContextWise:

#### 1. Stdio Upstreams (Local Processes)
```json
"postgres": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/mydb"],
  "env": {
    "DATABASE_PASSWORD": "vault://PROD_DB_PASS"
  },
  "cwd": "./",
  "autoRestart": true
}
```
- `command` *(string, required)*: Executable command (e.g. `npx`, `python`, `docker`, `node`).
- `args` *(string[], optional)*: Command line arguments array.
- `env` *(Record<string, string>, optional)*: Environment variables. Supports `vault://<KEY>` and `env://<VAR>` resolvers.
- `cwd` *(string, optional)*: Working directory for the child process.
- `autoRestart` *(boolean, default: true)*: Automatically respawns child processes if they crash unexpectedly.

#### 2. HTTP / SSE Upstreams (Remote Servers)
```json
"remote-service": {
  "url": "https://mcp.internal.company.com/sse",
  "headers": {
    "Authorization": "Bearer vault://INTERNAL_BEARER_TOKEN"
  },
  "transport": "auto",
  "autoReconnect": true
}
```
- `url` *(string, required)*: Remote Server-Sent Events (SSE) or HTTP endpoint URL.
- `headers` *(Record<string, string>, optional)*: HTTP request headers sent on connect.
- `transport` *(string, default: "auto")*: `"auto"`, `"sse"`, or `"streamable-http"`.
- `autoReconnect` *(boolean, default: true)*: Re-establishes SSE connections upon network drops.

---

## 4. CLI Command Reference

### `contextwise start`
Starts the ContextWise MCP reverse proxy gateway.

```bash
contextwise start [options]
```

#### Options:
- `-c, --config <path>`: Explicit path to `contextwise.json`.
- `-l, --log-level <level>`: Logging verbosity (`debug`, `info`, `warn`, `error`, `silent`). Default: `info`.
- `--passthrough`: Run in raw passthrough mode without dynamic routing or schema pruning.

---

### `contextwise init`
Scans local environment for existing MCP configurations (Cursor, Claude Desktop, Antigravity) and initializes a clean `contextwise.json`.

```bash
contextwise init [options]
```

#### Options:
- `-f, --force`: Overwrite existing `contextwise.json` file if present.

---

### `contextwise browse`
Explores available MCP servers across curated presets, the Official MCP Registry, and Smithery.

```bash
contextwise browse [category] [options]
```

#### Arguments:
- `category` *(optional)*: Filter by category (`database`, `developer`, `web`, `filesystem`, `communication`, `devops`).

#### Options:
- `-q, --query <query>`: Search keyword filter.
- `-s, --source <source>`: Registry source filter (`all`, `official`, `smithery`, `curated`). Default: `all`.
- `--offline`: Only show local curated presets without querying remote registries.
- `-i, --interactive`: Launches the full-screen terminal interactive navigator UI with keyboard navigation.

---

### `contextwise add`
Configures, verifies, and saves a new upstream MCP server in `contextwise.json`.

```bash
contextwise add <name> [extraArg] [options]
```

#### Examples:
```bash
# Add a verified preset
contextwise add postgres postgresql://user:pass@localhost:5432/mydb
contextwise add sqlite ./app.db
contextwise add github --env GITHUB_PERSONAL_ACCESS_TOKEN=vault://GITHUB_PAT

# Add from Smithery
contextwise add slack -s @smithery/slack

# Add arbitrary stdio command
contextwise add my-server -c "node" -a "./server.js" -e "API_KEY=vault://KEY"

# Add remote SSE server
contextwise add remote-api -u "https://mcp.example.com/sse"
```

#### Options:
- `-s, --smithery [package]`: Install and configure via Smithery CLI runner (`@smithery/cli`).
- `-c, --command <cmd>`: Executable command for local stdio process.
- `-a, --args <args...>`: Arguments array passed to command.
- `-e, --env <env...>`: Environment variables in `KEY=VALUE` format.
- `-u, --url <url>`: Remote SSE endpoint URL.
- `--no-test`: Skip upfront connection testing before saving to config.

---

### `contextwise list`
Connects to all configured upstreams, inspects their status, and displays a comprehensive table of all aggregated tools, descriptions, and input schemas.

```bash
contextwise list [options]
```

#### Options:
- `-c, --config <path>`: Path to `contextwise.json`.

---

### `contextwise stats`
Displays persistent ROI metrics, token savings, cost avoidance by model family, and cache hit rates.

```bash
contextwise stats [options]
```

#### Options:
- `--reset`: Resets all lifetime counters and metrics history.
- `--json`: Outputs raw telemetry data in JSON format for scripting or CI.

---

### `contextwise secret` (Vault Management)
Manages encrypted credentials, tokens, and database passwords without plaintext configuration files.

#### `contextwise secret set <key> [value]`
Encrypts and stores a secret in the vault. If `value` is omitted, prompts securely without terminal echo.
- `-s, --scope <scope>`: Secret scope (`personal`, `workspace`, `team`). Default: `personal`.

#### `contextwise secret get <key>`
Retrieves metadata and a masked preview of a stored secret.
- `--reveal`: Prints the complete plaintext secret.

#### `contextwise secret list`
Lists all secrets currently registered in the local vault (keys, scopes, drivers, update timestamps).

#### `contextwise secret delete <key>` (alias: `rm`)
Permanently removes a secret from the vault.

#### `contextwise secret audit`
Performs an automated security audit of `contextwise.json`, flagging:
- Plaintext API tokens (e.g. `sk-...`, `ghp_...`)
- Embedded database passwords in connection strings
- Unmasked credentials not using the `vault://` protocol

---

### `contextwise` Cloud & Sync Commands

ContextWise Cloud enables end-to-end zero-knowledge synchronization of workspace configurations and encrypted secrets across workstations.

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `contextwise login [apiKey]` | `[apiKey]` (optional) | Authenticates via browser RFC 8628 device flow or directly using an API key. |
| `contextwise logout` | None | Clears local session tokens stored in `~/.contextwise/auth.json`. |
| `contextwise whoami` | None | Displays authenticated user profile, subscription plan, renewal date, and accessible workspaces. |
| `contextwise push [workspaceId]` | `[workspaceId]` (optional) | Pushes local config and encrypted vault snapshot to ContextWise Cloud. |
| `contextwise pull [workspaceId]` | `[workspaceId]` (optional) | Pulls and applies the latest cloud snapshot into the local workspace. |
| `contextwise sync` | None | Displays real-time synchronization status, active revision, and last sync timestamp. |
| `contextwise upgrade` | `--team`, `--annual` | Initiates Stripe Checkout session for Pro or Team subscriptions. |
| `contextwise billing` | None | Opens Stripe Customer Portal to manage subscriptions, invoices, and payment cards. |

---

## 5. In-Chat Meta-Tools Specification

When running in dynamic routing mode, ContextWise provides the model with specialized meta-tools:

### `contextwise_search_tools`
Discovers tools in the aggregated catalog using natural language intent.

```json
{
  "name": "contextwise_search_tools",
  "description": "Searches ContextWise tool catalog for relevant tools based on natural language intent. Returns matched tool signatures, parameter descriptions, and automatically makes them available to invoke.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language query describing the desired action (e.g., 'read customer table from postgres', 'create github pull request')"
      },
      "domain": {
        "type": "string",
        "description": "Optional category tag (e.g., 'database', 'git', 'filesystem', 'web')"
      },
      "topK": {
        "type": "number",
        "description": "Maximum number of tools to return (default: 5)"
      },
      "activate": {
        "type": "boolean",
        "description": "Whether to inject matched tools into the active context window (default: true)"
      }
    },
    "required": ["query"]
  }
}
```

---

### `contextwise_execute_tool`
Universally executes any tool in the indexed catalog on demand—even if its schema was never loaded into the client context window.

```json
{
  "name": "contextwise_execute_tool",
  "description": "Universally executes any indexed upstream tool, even if its schema is not pre-loaded into your active context window. Use this after finding tools via contextwise_search_tools.",
  "parameters": {
    "type": "object",
    "properties": {
      "tool_name": {
        "type": "string",
        "description": "The exact name or namespaced name of the target tool (e.g., 'postgres__query' or 'query')"
      },
      "arguments": {
        "type": "object",
        "description": "JSON arguments matching the tool's expected schema",
        "default": {}
      }
    },
    "required": ["tool_name"]
  }
}
```

---

### `contextwise_browse_servers`
Allows the LLM to search for and recommend MCP servers when a capability gap is detected.

```json
{
  "name": "contextwise_browse_servers",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Keyword search (e.g., 's3', 'linear', 'docker')" },
      "category": { "type": "string", "enum": ["database", "developer", "web", "filesystem", "communication", "devops"] },
      "source": { "type": "string", "enum": ["all", "official", "smithery", "curated"] }
    }
  }
}
```

---

### `contextwise_add_server`
Hot-loads a new MCP server in real-time during a conversation.
- Configurable via `routing.enableAddServer`.
- Supports preset names, Smithery packages, custom stdio commands, and remote SSE URLs.

---

## 6. Secret Vault & Credential Security

### The `vault://` and `env://` Protocols
Never store plaintext tokens in configuration files. ContextWise provides protocol resolvers that resolve secrets ephemerally at child-process spawn time:

```json
{
  "upstreams": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "vault://GITHUB_PERSONAL_TOKEN",
        "SYSTEM_USER": "env://USER"
      }
    }
  }
}
```

- `vault://<KEY>`: Fetches the decrypted secret from the local OS vault.
- `env://<VAR>`: Injects the specified environment variable from the host process.

### OS Keystores & File Encryption
ContextWise negotiates with native operating system keyrings:
1. **macOS**: macOS Keychain via Darwin `security` CLI.
2. **Windows**: Windows Data Protection API (DPAPI) via PowerShell cryptographic bindings.
3. **Linux / Fallback**: Authenticated **AES-256-GCM** with 96-bit random IV and 128-bit authentication tag stored at `~/.contextwise/vault.enc.json`.
   - **Key Derivation**: PBKDF2 with SHA-512 and **210,000 iterations** (OWASP standard).
   - **Machine Salt**: Generated with 32 cryptographically secure bytes at `~/.contextwise/.machine_salt` (mode `0600`).
   - **User Passphrase (Optional)**: Set `CONTEXTWISE_VAULT_PASSPHRASE` for multi-factor master key derivation.

### Stream Redaction Filter
The built-in `RedactionFilter` monitors all process streams (`stdout`, `stderr`, logs, and tool error messages). Any string matching a registered vault secret, OpenAI key (`sk-...`), Anthropic key (`sk-ant-...`), GitHub token (`ghp_...`, `github_pat_...`), AWS credentials, or database passwords is automatically masked to `[REDACTED_SECRET]` before leaving the proxy.

---

## 7. Guardrails & Reliability Engine

### Pre-Flight Ajv Schema Validation
ContextWise compiles the JSONSchema definitions of all upstream tools using Ajv. When an LLM sends a tool call:
- Parameters are validated before any child process is executed.
- If parameters violate the schema (e.g. missing required property, wrong type, invalid format), ContextWise rejects the request locally in **< 1 millisecond**, returning a precise error message to the model without burning API credits on subshell executions.

### SHA-256 Idempotent Response Cache
- Read-only tools (such as schema inspections, file reads, or status lookups) are hashed by tool name and argument JSON using SHA-256.
- Subsequent identical calls are served instantly from in-memory cache (< 1 ms latency, saving ~800 tokens per call).
- Automatic Cache Invalidation: When any tool classified as a mutation/write action executes (e.g., `write_file`, `execute_query`, `create_issue`), the cache is invalidated.

### Runaway Loop Breaker & Velocity Capping
Agentic models can get caught in death spirals—calling the same failing tool repeatedly with identical inputs.
- ContextWise records rolling call hashes.
- If an identical tool call fails consecutively `loopBreakerThreshold` times (default: 3), the circuit breaker **trips**, rejecting subsequent calls and instructing the LLM to alter its plan.

### Process Supervisor & Windows Escaping
- Manages cross-platform child process lifecycles.
- Windows Command Wrapping: Detects batch and cmd scripts (`npx`, `npm`, `cmd`), automatically routing through `cmd.exe /c` with deterministic escaping for metacharacters (`&`, `|`, `<`, `>`, `%`).
- Clean Signal Teardown: Listens to `SIGINT`, `SIGTERM`, and client disconnection to terminate all upstream process trees without orphan or zombie processes.

---

## 8. Multi-Registry Discovery (Official, Smithery, Curated)

ContextWise aggregates three MCP catalogs into a single interface:

1. **Curated Presets**: Zero-config definitions for standard servers (`postgres`, `sqlite`, `github`, `git`, `filesystem`, `memory`, `fetch`, `puppeteer`, `brave-search`, `slack`).
2. **Official MCP Registry**: Direct integration with the canonical registry at `registry.modelcontextprotocol.io`.
3. **Smithery.ai Marketplace**: Search and instant execution of over 500+ community MCP servers via `@smithery/cli`.

Search registries via CLI:
```bash
contextwise browse -q "kubernetes" --source official
contextwise browse -q "jira" --source smithery
```

---

## 9. Metrics & Cost Analytics Engine

ContextWise continuously tracks token avoidance and estimated dollar savings:
- **Pruning Metric**: 150 tokens avoided per hidden tool schema on every conversation turn.
- **Cache Metric**: ~800 tokens saved per cached read hit.
- **Loop Prevention Metric**: ~2,500 tokens avoided per tripped runaway loop.

### Pricing Models Supported:
- **Claude 3.5 / 3.7 Sonnet**: $3.00 / 1M input tokens
- **OpenAI GPT-4o**: $2.50 / 1M input tokens
- **Claude 3 Opus**: $15.00 / 1M input tokens
- **Claude 3.5 Haiku / GPT-4o mini**: $0.25 / 1M input tokens

View your lifetime stats:
```bash
contextwise stats
```

---

## 10. Environment Variables Reference

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `CONTEXTWISE_CONFIG` | string | None | Path to custom `contextwise.json` file. |
| `CONTEXTWISE_LOG_LEVEL` | string | `"info"` | Diagnostic logging level (`debug`, `info`, `warn`, `error`, `silent`). |
| `CONTEXTWISE_API_URL` | string | `"https://contextwise.dev"` | Base URL for ContextWise Cloud authentication and sync API. |
| `CONTEXTWISE_VAULT_PASSPHRASE` | string | None | Optional master passphrase for PBKDF2 vault key derivation. |
| `CONTEXTWISE_METRICS_PATH` | string | `"~/.contextwise/metrics.json"` | Filepath for persistent session telemetry data. |
| `SMITHERY_API_KEY` | string | None | Optional Smithery API key for searching private or authenticated packages. |

---

## 11. Troubleshooting & Diagnostics

### Child Process Fails on Windows (`spawn ENOENT`)
**Cause:** Windows requires shell execution for `.cmd` and `.bat` wrappers like `npx`.  
**Solution:** ContextWise automatically wraps `npx` commands on Windows. Ensure `node` and `npm` are available in your system `%PATH%`.

### High Memory Consumption
**Cause:** Too many active tools or unbounded response cache.  
**Solution:** Set `"maxActiveTools": 10` and `"cacheTtlSeconds": 60` in `contextwise.json`.

### Tools Not Discovered by LLM
**Cause:** Intent search query did not meet `similarityThreshold`.  
**Solution:** Lower `similarityThreshold` to `0.3` or add critical tools to `pinnedTools` in `contextwise.json`.

---

## License

ContextWise is open source software released under the [MIT License](LICENSE).
