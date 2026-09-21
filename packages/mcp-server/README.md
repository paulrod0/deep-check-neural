# @deep-check/mcp-server

<p align="center">
  <strong>MCP Server for Deep-Check — Continuous Identity Verification</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#tools-reference">API Reference</a> •
  <a href="#integration-guides">Integration</a> •
  <a href="#workflows">Workflows</a> •
  <a href="#error-handling">Errors</a> •
  <a href="#license">License</a>
</p>

---

## What is this?

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes Deep-Check's identity verification API as **9 tools** for AI agents. Any MCP-compatible client — Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw — can verify documents, manage proctoring sessions, and validate certificates through natural language.

```
"Verify this passport and tell me if it's authentic"
"List all flagged sessions from the last week"
"Check certificate cert_1710000000_xyz789"
```

---

## Quick Start

### 1. Get an API Key

Sign up at [deep-check-two.vercel.app](https://deep-check-two.vercel.app) → Dashboard → API Keys.

Your key will look like: `dc_live_xxxxxxxxxxxxxxxx`

### 2. Install

```bash
# Run directly (no install needed)
npx @deep-check/mcp-server

# Or install globally
npm install -g @deep-check/mcp-server
```

### 3. Configure your AI client

See [Integration Guides](#integration-guides) below.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEP_CHECK_API_KEY` | **Yes** | — | API key with `read`+`write` permissions |
| `DEEP_CHECK_BASE_URL` | No | `https://deep-check-two.vercel.app` | API base URL (for on-premise deployments) |

---

## Tools Reference

### Overview

| # | Tool | Method | Endpoint | Description |
|---|------|--------|----------|-------------|
| 1 | [`verify_document`](#verify_document) | POST | `/api/v1/verify` | Single document verification |
| 2 | [`batch_verify`](#batch_verify) | POST | `/api/v1/batch` | Batch verification (up to 100 docs) |
| 3 | [`batch_status`](#batch_status) | GET | `/api/v1/batch` | Check batch job progress |
| 4 | [`list_sessions`](#list_sessions) | GET | `/api/v1/sessions` | List proctoring sessions |
| 5 | [`get_session`](#get_session) | GET | `/api/v1/sessions/:id` | Get session details |
| 6 | [`create_session`](#create_session) | POST | `/api/v1/sessions` | Create new session |
| 7 | [`update_session`](#update_session) | PATCH | `/api/v1/sessions/:id` | Update session status/notes |
| 8 | [`get_enrollment`](#get_enrollment) | GET | `/api/v1/enroll` | Look up biometric profile |
| 9 | [`check_certificate`](#check_certificate) | GET | `/api/certificates` | Verify certificate signature |

---

### `verify_document`

Verify an identity document's authenticity through MRZ parsing, forensic analysis (ELA, noise, compression artifacts), face detection, and country-specific document number validation (195 countries).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `documentFront` | `string` | Yes | Base64-encoded image of document front |
| `documentType` | `enum` | Yes | `passport` \| `dni` \| `driving_license` \| `residence_permit` |
| `documentBack` | `string` | No | Base64-encoded image of document back |
| `externalRef` | `string` | No | Your reference ID (max 255 chars) |

**Annotations:** `idempotent` · `not read-only` · `not destructive`

**Example prompt:**
```
Verify this passport photo and tell me if it's authentic
```

**Example response:**
```json
{
  "verdict": "authentic",
  "riskScore": 12,
  "mrz": {
    "valid": true,
    "documentNumber": "AB1234567",
    "nationality": "ESP",
    "dateOfBirth": "1990-05-15",
    "expiryDate": "2030-05-14",
    "checksumValid": true
  },
  "forensics": {
    "elaScore": 0.08,
    "noiseConsistency": 0.95,
    "compressionArtifacts": false
  },
  "face": {
    "detected": true,
    "quality": 0.92
  },
  "certificateUrl": "https://deep-check-two.vercel.app/verify/cert_1710000000_abc123"
}
```

---

### `batch_verify`

Submit up to 100 documents for asynchronous batch verification. Returns a `jobId` to poll with `batch_status`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `documents` | `array` | Yes | Array of 1-100 documents (each with `documentFront`, `documentType`, optional `documentBack` and `externalRef`) |
| `webhookUrl` | `string` (URL) | No | Webhook URL for completion notification |

**Annotations:** `not idempotent` · `not read-only` · `not destructive`

**Example prompt:**
```
Verify these 50 passports in batch and notify me at https://hooks.example.com/done
```

**Example response:**
```json
{
  "jobId": "batch_1710000000_abc123",
  "status": "processing",
  "total": 50,
  "processed": 0,
  "expiresAt": "2026-03-18T15:00:00Z"
}
```

---

### `batch_status`

Check the progress or final results of a batch verification job. Jobs expire after 1 hour.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string` | Yes | Job ID from `batch_verify` (format: `batch_<timestamp>_<id>`) |

**Annotations:** `idempotent` · `read-only`

**Example prompt:**
```
Check status of batch job batch_1710000000_abc123
```

**Example response (in progress):**
```json
{
  "jobId": "batch_1710000000_abc123",
  "status": "processing",
  "total": 50,
  "processed": 32,
  "progress": 64
}
```

**Example response (completed):**
```json
{
  "jobId": "batch_1710000000_abc123",
  "status": "completed",
  "total": 50,
  "processed": 50,
  "progress": 100,
  "results": [
    { "index": 0, "verdict": "authentic", "riskScore": 8 },
    { "index": 1, "verdict": "suspicious", "riskScore": 67 }
  ]
}
```

---

### `list_sessions`

List proctoring/assessment sessions with pagination and optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | `integer` | No | Page number (default: 1) |
| `limit` | `integer` | No | Results per page (default: 20, max: 100) |
| `status` | `enum` | No | `passed` \| `review` \| `flagged` |
| `externalRef` | `string` | No | Filter by external reference ID |

**Annotations:** `idempotent` · `read-only`

**Example prompt:**
```
List all flagged sessions
```

**Example response:**
```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "candidateName": "John Doe",
      "role": "Senior Developer",
      "score": 34,
      "status": "flagged",
      "date": "2026-03-17",
      "alerts": ["Liveness check failed", "AI code detected"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

### `get_session`

Get detailed information about a specific session, including biometric scores, alerts, and optionally evidence data.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | Session/assessment ID |
| `includeEvidence` | `boolean` | No | Include full evidence array (screenshots, timestamps). Default: `false` |

**Annotations:** `idempotent` · `read-only`

**Example prompt:**
```
Get full details for session sess_abc123 including evidence
```

**Example response:**
```json
{
  "id": "sess_abc123",
  "candidateName": "John Doe",
  "role": "Senior Developer",
  "score": 34,
  "status": "flagged",
  "date": "2026-03-17",
  "alerts": ["Liveness check failed", "AI code detected"],
  "liveness": { "score": 0.23, "rppgDetected": false },
  "aiRisk": { "score": 0.87, "codePatterns": true },
  "keystrokeCount": 1247,
  "evidence": [
    {
      "type": "screenshot",
      "timestamp": "2026-03-17T14:32:10Z",
      "url": "https://..."
    }
  ]
}
```

---

### `create_session`

Create a new proctoring/assessment session. All fields are optional with sensible defaults.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `candidateName` | `string` | No | — | Candidate's full name |
| `role` | `string` | No | — | Position being applied for |
| `date` | `string` | No | today | Date in `YYYY-MM-DD` format |
| `score` | `number` | No | `0` | Initial trust score (0-100) |
| `status` | `enum` | No | `review` | `passed` \| `review` \| `flagged` |
| `externalRef` | `string` | No | — | Your reference ID (max 255 chars) |

**Annotations:** `not idempotent` · `not read-only` · `not destructive`

**Example prompt:**
```
Create a proctoring session for Jane Smith applying for Data Engineer
```

**Example response:**
```json
{
  "id": "sess_def456",
  "candidateName": "Jane Smith",
  "role": "Data Engineer",
  "score": 0,
  "status": "review",
  "date": "2026-03-18",
  "createdAt": "2026-03-18T10:00:00Z"
}
```

---

### `update_session`

Update a session's status, add review notes, or set an external reference. Review notes are automatically timestamped.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | Session ID to update |
| `status` | `enum` | No | New status: `passed` \| `review` \| `flagged` |
| `reviewNote` | `string` | No | Note to append to alert history (max 2000 chars, auto-timestamped) |
| `externalRef` | `string` | No | Update external reference (max 255 chars) |

**Annotations:** `idempotent` · `not read-only` · `not destructive`

**Example prompt:**
```
Flag session sess_abc123 and add note "Deepfake detected in liveness check"
```

---

### `get_enrollment`

Look up a candidate's biometric keystroke enrollment profile by email.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `email` | `string` (email) | Yes | Candidate email address |

**Annotations:** `idempotent` · `read-only`

**Example prompt:**
```
Look up the enrollment profile for john@company.com
```

**Example response:**
```json
{
  "email": "john@company.com",
  "enrollmentHash": "sha256:a1b2c3...",
  "sampleSize": 1500,
  "context": "prose",
  "createdAt": "2026-02-15T09:00:00Z",
  "expiresAt": "2026-05-16T09:00:00Z"
}
```

> **Note:** Creating enrollment profiles requires raw keystroke data and is only possible through the web UI.

---

### `check_certificate`

Verify a Deep-Check certificate's cryptographic HMAC signature and retrieve full verification data.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `certificateId` | `string` | Yes | Certificate ID (format: `cert_<timestamp>_<hash>`) |

**Annotations:** `idempotent` · `read-only`

**Example prompt:**
```
Verify certificate cert_1710000000_xyz789
```

**Example response:**
```json
{
  "valid": true,
  "expired": false,
  "certificate": {
    "id": "cert_1710000000_xyz789",
    "verdict": "authentic",
    "documentType": "passport",
    "nationality": "ESP",
    "issuedAt": "2026-03-15T12:00:00Z",
    "expiresAt": "2027-03-15T12:00:00Z",
    "forensics": {
      "elaScore": 0.08,
      "riskScore": 12
    },
    "issuer": "Deep-Check v1",
    "signatureAlgorithm": "HMAC-SHA256"
  }
}
```

---

## Integration Guides

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

### Cursor / Windsurf

Add to your MCP configuration file (`.cursor/mcp.json` or equivalent):

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

### Docker (On-Premise)

```bash
docker run -e DEEP_CHECK_API_KEY=dc_live_xxx \
           -e DEEP_CHECK_BASE_URL=https://deep-check.your-company.com \
           deepcheck/mcp-server
```

Or in your MCP config:

```json
{
  "mcpServers": {
    "deep-check": {
      "command": "npx",
      "args": ["-y", "@deep-check/mcp-server"],
      "env": {
        "DEEP_CHECK_API_KEY": "dc_live_your_key_here",
        "DEEP_CHECK_BASE_URL": "https://deep-check.your-company.com"
      }
    }
  }
}
```

---

## Workflows

### KYC Onboarding Flow

Use the MCP server to run a complete KYC verification through natural language:

```
1. "Verify this passport photo"
   -> verify_document -> returns verdict + certificate

2. "Create a session for this candidate"
   -> create_session -> returns session ID

3. "Look up their keystroke enrollment"
   -> get_enrollment -> returns biometric profile

4. "Mark the session as passed with note 'All checks clear'"
   -> update_session -> session updated
```

### Bulk Admissions Verification

```
1. "Verify these 80 student documents"
   -> batch_verify -> returns jobId

2. "Check the batch status"
   -> batch_status -> returns progress (45/80)

3. (repeat until 100%)

4. "List all flagged sessions"
   -> list_sessions(status=flagged) -> returns flagged candidates

5. "Get evidence for session sess_xyz"
   -> get_session(includeEvidence=true) -> full audit trail
```

### Certificate Verification

```
1. "A candidate shared this certificate: cert_1710000000_abc123"
   -> check_certificate -> returns validity, verdict, forensics

2. "Is it still valid?"
   -> Response includes expiry date and signature status
```

---

## Error Handling

All tools return structured errors with HTTP status codes:

| Status | Error | Description |
|--------|-------|-------------|
| `400` | Bad Request | Invalid parameters (malformed base64, invalid document type) |
| `401` | Unauthorized | Invalid or missing API key |
| `403` | Forbidden | API key lacks required permissions |
| `404` | Not Found | Resource not found (session, enrollment, certificate) |
| `409` | Conflict | Duplicate external reference |
| `413` | Payload Too Large | Document image exceeds 10MB limit |
| `429` | Rate Limited | Too many requests — back off and retry |
| `500` | Server Error | Internal error — retry with exponential backoff |

**Error response format:**
```json
{
  "content": [{ "type": "text", "text": "API Error (401): Invalid API key" }],
  "isError": true
}
```

---

## Architecture

```
AI Agent (Claude / Cursor / OpenClaw / Windsurf)
    |
    |  JSON-RPC 2.0 over stdio
    v
+----------------------------------+
|  @deep-check/mcp-server          |
|                                  |
|  +------------+  +------------+  |
|  | Zod        |  | 9 MCP      |  |
|  | Schemas    |->| Tools      |  |
|  +------------+  +-----+------+  |
|                        |         |
|  +---------------------+------+  |
|  | DeepCheckClient            |  |
|  | (native fetch, typed API)  |  |
|  +------------+---------------+  |
+---------------|------------------+
                |  HTTPS + Bearer Token
                v
+----------------------------------+
|  Deep-Check API v1               |
|                                  |
|  /api/v1/verify                  |
|  /api/v1/batch                   |
|  /api/v1/sessions                |
|  /api/v1/enroll                  |
|  /api/certificates               |
|                                  |
|  Vercel (cloud) or Docker (K8s)  |
+----------------------------------+
```

### Key Design Decisions

- **Zero dependencies** beyond `@modelcontextprotocol/sdk` and `zod` — uses native `fetch`
- **Zod schemas** serve dual purpose: runtime validation + auto-generated JSON Schema for agent discovery
- **All debug output to stderr** — stdout is reserved for JSON-RPC protocol
- **Typed API client** (`DeepCheckClient`) — easy to test and extend
- **Tool annotations** — agents know which tools are read-only, idempotent, or destructive

---

## Security

| Measure | Implementation |
|---------|----------------|
| **Authentication** | Bearer token via `DEEP_CHECK_API_KEY` env var |
| **Transport** | All API calls over HTTPS |
| **No credential logging** | API key never appears in stdout or tool responses |
| **Input validation** | All parameters validated via Zod before API calls |
| **Base64 passthrough** | Document images are passed directly to API — never stored locally |
| **Stdio isolation** | stdout = JSON-RPC only, debug = stderr only |

---

## Development

```bash
# Clone and navigate
cd packages/mcp-server

# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode
npm run dev

# Test locally (pipe JSON-RPC messages)
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","method":"tools/list","id":2}' | DEEP_CHECK_API_KEY=dc_live_test node dist/index.js
```

### Project Structure

```
packages/mcp-server/
├── src/
│   ├── index.ts          # Entry point — server init + tool registration
│   ├── client.ts         # DeepCheckClient — typed HTTP client (native fetch)
│   ├── types.ts          # Zod schemas for all tool inputs
│   └── tools/
│       ├── verify.ts     # verify_document
│       ├── batch.ts      # batch_verify + batch_status
│       ├── sessions.ts   # list/get/create/update_session
│       ├── enrollment.ts # get_enrollment
│       └── certificate.ts # check_certificate
├── package.json
├── tsconfig.json
├── LICENSE               # Business Source License 1.1
└── README.md
```

---

## License

**Business Source License 1.1 (BUSL-1.1)**

- **Non-commercial use:** Free — evaluation, testing, personal projects, academic research
- **Commercial use:** Requires a separate license from Deep-Check
- **Change date:** 2030-03-18 — converts to Apache 2.0

For commercial licensing inquiries, visit [deep-check-two.vercel.app](https://deep-check-two.vercel.app).

See [LICENSE](./LICENSE) for the full text.
