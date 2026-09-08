# ContextWise

<p align="center">
  <a href="https://www.npmjs.com/package/contextwise"><img src="https://img.shields.io/npm/v/contextwise.svg?color=blue" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js Version" /></a>
  <a href="#testing"><img src="https://img.shields.io/badge/tests-84%20passed-success.svg" alt="Tests passing" /></a>
</p>

> **Dynamic Model Context Protocol (MCP) Tool Routing, Schema Compression & Execution Gateway**  
> *Eliminate context-window bloat, reduce LLM token consumption by 70–90%, and visibly quantify your API cost savings.*

---

## Overview

Connecting multiple MCP servers (Postgres, GitHub, Linear, AWS, Filesystem, Slack) easily dumps **50 to 300+ tool schemas** into the model's active context window. This creates severe operational issues:
- **Token Inflation**: Burns 5,000 to 25,000+ input tokens per turn on redundant JSONSchema definitions.
- **Tool Hallucination**: Model selection accuracy drops dramatically when forced to pick from dozens of irrelevant tools.
- **Runaway Loops**: Repeating failures and unvalidated parameters burn expensive API credits.

**ContextWise** acts as an intelligent MCP reverse proxy between your AI client (Claude Code, Cursor, Claude Desktop, Antigravity, Windsurf) and upstream MCP servers. ContextWise exposes only contextually relevant tools on-demand plus two meta-tools:
1. `contextwise_search_tools(query, domain?)`: Discovers tools by natural language intent and hydrates them into the active toolset.
2. `contextwise_execute_tool(tool_name, arguments)`: Universally executes any indexed tool on demand, even if its schema was never loaded into the context window.

---

## 💰 Quantifiable Token & Cost Savings

ContextWise actively tracks and quantifies dollar savings across your sessions based on industry LLM pricing models:

```bash
contextwise stats
```

```
══════════════════════════════════════════════════════════════════════════
         💰 ContextWise Performance, Token & Cost Analytics
══════════════════════════════════════════════════════════════════════════

  SAVINGS   ContextWise has saved you ~$42.50 in LLM API costs!
            14,166,667 total tokens avoided across all sessions

  ┌── 💡 ESTIMATED SAVINGS BY MODEL ───────────────────────────────────────┐
  │ Model Family                   │ Benchmark Rate     │ Dollar Saved     │
  ├────────────────────────────────┼────────────────────┼──────────────────┤
  │ Claude 3.5 / 3.7 Sonnet (def)  │ $3.00 / 1M         │ $42.50           │
  │ OpenAI GPT-4o                  │ $2.50 / 1M         │ $35.42           │
  │ Claude 3 Opus                  │ $15.00 / 1M        │ $212.50          │
  │ Haiku / GPT-4o mini            │ $0.25 / 1M         │ $3.54            │
  └────────────────────────────────┴────────────────────┴──────────────────┘

  ┌── 📊 TOKEN REDUCTION BREAKDOWN ──────────────────────────────────────────┐
  │ Source                   │ Tokens Saved       │ Details                  │
  ├──────────────────────────┼────────────────────┼──────────────────────────┤
  │ Schema Pruning           │ 13,850,000         │ 42 tools hidden/turn     │
  │ Response Cache           │ 266,667            │ 48 read calls cached     │
  │ Loop Prevention          │ 50,000             │ 2 runaway loops stopped  │
  └──────────────────────────┴────────────────────┴──────────────────────────┘

  ┌── ⚡ PROXY PERFORMANCE & RELIABILITY ─────────────────────────────────────┐
  │ Total Proxied Calls:       │ 128                                         │
  │ Cache Hit Efficiency:      │ 37.5% (48 cached / 128 calls)               │
  │ Avg Execution Latency:     │ 42 ms                                       │
  │ Tripped Loops / Errors:    │ 0 loops / 0 errors                          │
  │ Metrics Tracking Since:    │ Sep 6, 2026                                 │
  └────────────────────────────┴─────────────────────────────────────────────┘

  Tip: Run "contextwise stats --reset" to clear counters or "--json" for raw exports.
```

- **Schema Pruning**: Filters ~150 tokens per tool schema on every conversation turn.
- **Response Caching**: Caches idempotent and read-only calls (saving ~800 tokens per hit with sub-millisecond execution).
- **Runaway Loop Breaker**: Trips the circuit after repeating consecutive failures, stopping 2,500+ token agent death spirals.

---

## Quick Start

### 1. Installation

Install globally via npm:

```bash
npm install -g contextwise
```

Or run zero-install via npx:

```bash
npx contextwise start
```

### 2. Auto-Import Existing MCP Servers

ContextWise can automatically scan and import your existing MCP configurations from Cursor (`.cursor/mcp.json`) or Claude Desktop:

```bash
contextwise init
```

### 3. Connect to Your AI Client

#### Claude Code (Anthropic CLI)
```bash
claude mcp add contextwise -- npx -y contextwise start
```

#### Antigravity CLI / IDE (`~/.gemini/config/mcp_config.json`)
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

#### Cursor (`.cursor/mcp.json`) or Claude Desktop (`claude_desktop_config.json`)
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

---

## Server Management & Marketplace CLI

ContextWise makes finding and installing MCP servers seamless:

### 1. Browse Multi-Registry Catalog
Browse verified servers across the **Official MCP Registry**, **Smithery.ai**, and **Curated Presets**:

```bash
# Browse all verified servers
contextwise browse

# Search specific database or search tools
contextwise browse database
contextwise browse -q "github"

# Interactive keyboard navigation
contextwise browse --interactive
```

### 2. Add New Upstream Servers
Add servers with instant connection testing and persistence:

```bash
# Add from curated preset
contextwise add postgres postgresql://user:pass@localhost:5432/mydb
contextwise add sqlite ./app.db
contextwise add github --env GITHUB_PERSONAL_ACCESS_TOKEN=your_token

# Add any custom stdio command
contextwise add my-server --command "npx" --args "-y" "my-mcp-package"

# Add from Smithery
contextwise add slack -s @smithery/slack
```

### 3. Inspect Connections & Metrics
```bash
# List all configured servers and aggregated tools
contextwise list

# View ROI, dollar savings, and performance analytics
contextwise stats

# Export raw JSON metrics
contextwise stats --json
```

---

## 🔐 Secret Vault & Zero-Leakage Credential Management

Never commit plaintext API keys or database passwords to `contextwise.json`. ContextWise includes an encrypted secret vault backed by native OS Keystores (macOS Keychain / Windows DPAPI / Linux Secret Service) and AES-256-GCM encrypted file storage.

### 1. Storing & Managing Secrets
```bash
# Store a secret (interactive secure prompt if value omitted)
contextwise secret set GITHUB_TOKEN ghp_yourSecretToken123

# List all stored secrets (metadata only, values never printed)
contextwise secret list

# Preview secret with automatic masking
contextwise secret get GITHUB_TOKEN
# Or reveal full plaintext
contextwise secret get GITHUB_TOKEN --reveal

# Delete a secret
contextwise secret delete GITHUB_TOKEN
```

### 2. Referencing Secrets in `contextwise.json`
Use the `vault://` protocol to inject secrets at child-process spawn time:
```json
{
  "upstreams": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "vault://GITHUB_TOKEN"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_URL": "vault://PROD_DB_URL"
      }
    }
  }
}
```

### 3. Security Audit & Stream Redaction
```bash
# Scan workspace configuration for exposed plaintext keys and credentials
contextwise secret audit
```
All secrets registered in the vault are continuously sanitized across `stdout`, `stderr`, logs, and tool error messages by ContextWise's automated **RedactionFilter**.

---

## ☁️ Zero-Knowledge Cloud Sync & Team Sharing

Synchronize your MCP configurations and encrypted secrets securely across multiple workstations and teammates.

- **Zero-Knowledge**: Master encryption keys never leave your machine; the cloud backend only stores ciphertext.
- **Asymmetric Envelope Encryption**: Team secrets are encrypted with recipients' X25519 public keys so teammates can share credentials without sharing account passwords.

```bash
# Authenticate with ContextWise Cloud
contextwise login

# Inspect cloud identity and accessible workspaces
contextwise whoami

# Push local workspace configuration and encrypted secrets
contextwise push

# Pull and merge cloud snapshot into your local workspace
contextwise pull

# Check synchronization status
contextwise sync
```

---

## 📖 Developer Documentation & How-To Guides

Explore full step-by-step implementation recipes and interactive guides at [contextwise.dev/docs](https://contextwise.dev/docs):

1. **[Recipe 1: Slashing 90%+ Tokens in Heavy MCP Environments](https://contextwise.dev/docs#howto-token-slashing)**: Benchmarking 50+ Robinhood and Postgres MCP endpoints, dropping schema tokens from 18,300 to 680 tokens/turn.
2. **[Recipe 2: Zero-Knowledge Secret Management (`vault://`)](https://contextwise.dev/docs#howto-vault-secrets)**: AES-256-GCM encrypted keystore with in-memory stream redaction to prevent secret leaks.
3. **[Recipe 3: Multi-Device Cloud Sync (`push` / `pull`)](https://contextwise.dev/docs#howto-cloud-sync)**: Seamlessly sync MCP tools and encrypted credentials across laptops and cloud workstations.
4. **[Recipe 4: Team Envelope Sharing & Key Distribution](https://contextwise.dev/docs#howto-team-envelopes)**: Asymmetric X25519 ECDH envelope distribution for team staging environments.
5. **[Recipe 5: Enterprise Guardrails & Circuit Breakers](https://contextwise.dev/docs#howto-guardrails)**: Pre-flight Ajv validation, SHA-256 caching, and runaway loop prevention.
6. **[Recipe 6: Dynamic Server Discovery & Autonomous In-Chat Installation](https://contextwise.dev/docs#howto-dynamic-servers)**: Keyboard TUI registry browser and autonomous LLM server hot-loading.

---

## Architecture & Features

```
+─────────────────────────────────────────────────────────────+
|                     AI Client Applications                  |
|        (Claude Code, Cursor, Antigravity, Claude Desktop)   |
+─────────────────────────────────────────────────────────────+
                               │  [JSON-RPC 2.0 / stdio]
                               ▼
+─────────────────────────────────────────────────────────────+
|                      CONTEXTWISE PROXY                      |
|                                                             |
|  [Dynamic Router]            [Pre-Flight Execution Guard]   |
|   • BM25 + Vector Search      • AJV JSONSchema Validator    |
|   • Top-K Context Routing     • Read-Only Response Cache    |
|   • Pinned Core Tools         • Runaway Loop Breaker        |
|   • LRU Tool Eviction         • Velocity Rate Limiter       |
|                              │                              |
|  [Upstream Multiplexer & Supervisor]                        |
|   • Cross-platform child process management                 |
|   • Stdio & SSE upstream multiplexing                       |
|   • Persistent ROI & Token Analytics Engine                 |
+─────────────────────────────────────────────────────────────+
         │                     │                     │
         ▼ [stdio]             ▼ [stdio]             ▼ [SSE]
    Upstream MCP 1        Upstream MCP 2        Upstream MCP 3
      (Postgres)             (GitHub)              (Linear)
```

- **Upstream Multiplexing**: Connects to multiple stdio and SSE MCP servers simultaneously.
- **Dynamic Meta-Tooling (Mode 1)**: Search and invoke any tool with zero initial token bloat.
- **List-Changed Event Push (Mode 2)**: Dynamically pushes hydrated tools using `notifications/tools/list_changed`.
- **Pre-Flight Argument Validation**: Compiles JSONSchemas with Ajv and rejects invalid arguments in < 1 ms before calling upstreams.
- **Idempotent Response Cache**: Caches read-only queries with content-addressable SHA-256 keys, invalidating automatically when write tools execute.
- **Runaway Loop Breaker**: Detects repeating failures (trips circuit after 3 consecutive failures with identical args) and caps call velocity.
- **Workspace Context Pre-Priming (Mode 4)**: Auto-detects project files (`.git`, `Dockerfile`, SQL) to pre-seed relevant tools.

---

## Testing

ContextWise is tested end-to-end with unit and integration tests across multiplexing, caching, circuit breaking, and dynamic routing:

```bash
npm test
```

```
 Test Files  16 passed (16)
      Tests  84 passed (84)
```

---

## License

[MIT](LICENSE) © 2026 ContextWise Contributors

