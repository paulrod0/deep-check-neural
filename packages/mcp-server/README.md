# @deep-check/mcp-server

MCP (Model Context Protocol) server for **Deep-Check** — continuous identity verification.

Lets any MCP-compatible AI agent (Claude Desktop, OpenClaw, Cursor, etc.) verify identity documents, manage proctoring sessions, and check certificates through Deep-Check's API.

## Quick Start

```bash
# Install globally
npm install -g @deep-check/mcp-server

# Or run directly
npx @deep-check/mcp-server
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEP_CHECK_API_KEY` | Yes | API key with `read`+`write` permissions (`dc_live_...`) |
| `DEEP_CHECK_BASE_URL` | No | API base URL (default: `https://deep-check-two.vercel.app`) |

Get your API key at: https://deep-check-two.vercel.app/dashboard/api-keys

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "deep-check": {
      "command": "npx",
      "args": ["-y", "@deep-check/mcp-server"],
      "env": {
        "DEEP_CHECK_API_KEY": "dc_live_your_key_here"
      }
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "deep-check": {
      "command": "npx",
      "args": ["-y", "@deep-check/mcp-server"],
      "env": {
        "DEEP_CHECK_API_KEY": "dc_live_your_key_here"
      }
    }
  }
}
```

### OpenClaw

Add to your OpenClaw configuration:

```json
{
  "mcp_servers": {
    "deep-check": {
      "command": "npx",
      "args": ["-y", "@deep-check/mcp-server"],
      "env": {
        "DEEP_CHECK_API_KEY": "dc_live_your_key_here"
      }
    }
  }
}
```

### On-Premise Deployment

For on-premise Deep-Check instances, set the base URL:

```json
{
  "env": {
    "DEEP_CHECK_API_KEY": "dc_live_your_key_here",
    "DEEP_CHECK_BASE_URL": "https://deep-check.your-company.com"
  }
}
```

## Available Tools

### Document Verification

| Tool | Description |
|------|-------------|
| `verify_document` | Verify a single document's authenticity — MRZ parsing, forensic analysis, face detection, 195-country validation. Returns verdict + certificate URL |
| `batch_verify` | Submit up to 100 documents for async batch verification. Returns a `jobId` for polling |
| `batch_status` | Check progress/results of an async batch job (jobs expire after 1 hour) |

### Session Management

| Tool | Description |
|------|-------------|
| `list_sessions` | List proctoring sessions with pagination and filters (status, externalRef) |
| `get_session` | Get detailed session info — scores, alerts, biometrics, optional evidence |
| `create_session` | Create a new proctoring/assessment session |
| `update_session` | Update status, add timestamped review notes, set external reference |

### Biometrics & Certificates

| Tool | Description |
|------|-------------|
| `get_enrollment` | Look up a keystroke biometric enrollment profile by email |
| `check_certificate` | Verify a certificate's cryptographic signature and get full verification data |

## Usage Examples

Once configured, you can ask your AI agent:

> "Verify this passport photo and tell me if it's authentic"

> "List all flagged sessions from the last week"

> "Check the status of batch job batch_1710000000_abc123"

> "Look up the enrollment profile for john@company.com"

> "Verify certificate cert_1710000000_xyz789"

## Development

```bash
# Clone the repo
cd packages/mcp-server

# Install dependencies
npm install

# Build
npm run build

# Test locally
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","method":"tools/list","id":2}' | DEEP_CHECK_API_KEY=dc_live_test node dist/index.js
```

## Architecture

```
AI Agent (Claude / OpenClaw / Cursor)
    │
    │  JSON-RPC 2.0 (stdio)
    ▼
┌────────────────────────────┐
│  @deep-check/mcp-server    │
│  9 tools registered        │
│  Zod schema validation     │
└────────────┬───────────────┘
             │  HTTPS + Bearer Token
             ▼
┌────────────────────────────┐
│  Deep-Check API v1         │
│  Vercel / On-premise       │
└────────────────────────────┘
```

## Security

- All API calls use HTTPS with Bearer token authentication
- No credentials are logged or persisted
- Stdout is reserved for JSON-RPC protocol — all debug output goes to stderr
- The server validates all tool inputs via Zod schemas before making API calls
- Document images (base64) are passed through to the API and never stored locally

## License

MIT
