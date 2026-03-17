#!/usr/bin/env node

/**
 * Deep-Check MCP Server
 *
 * Exposes the Deep-Check identity verification API as MCP tools
 * for AI agents (OpenClaw, Claude Desktop, Cursor, etc.).
 *
 * Required environment variables:
 *   DEEP_CHECK_API_KEY   — API key with read+write permissions (dc_live_...)
 *
 * Optional:
 *   DEEP_CHECK_BASE_URL  — API base URL (default: https://deep-check-two.vercel.app)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DeepCheckClient } from './client.js'
import { registerVerifyTools } from './tools/verify.js'
import { registerBatchTools } from './tools/batch.js'
import { registerSessionTools } from './tools/sessions.js'
import { registerEnrollmentTools } from './tools/enrollment.js'
import { registerCertificateTools } from './tools/certificate.js'

// ─── Validate configuration ──────────────────────────────────────────────────

const apiKey = process.env.DEEP_CHECK_API_KEY
if (!apiKey) {
  // stderr only — stdout is reserved for JSON-RPC
  console.error(
    '[deep-check-mcp] DEEP_CHECK_API_KEY environment variable is required.\n' +
      'Get your API key at https://deep-check-two.vercel.app/dashboard/api-keys',
  )
  process.exit(1)
}

const baseUrl =
  process.env.DEEP_CHECK_BASE_URL || 'https://deep-check-two.vercel.app'

// ─── Initialize ──────────────────────────────────────────────────────────────

const client = new DeepCheckClient(apiKey, baseUrl)

const server = new McpServer({
  name: 'deep-check',
  version: '1.0.0',
})

// ─── Register all tools ──────────────────────────────────────────────────────

registerVerifyTools(server, client)
registerBatchTools(server, client)
registerSessionTools(server, client)
registerEnrollmentTools(server, client)
registerCertificateTools(server, client)

// ─── Start server ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)

console.error('[deep-check-mcp] Server started — 9 tools registered')
console.error(`[deep-check-mcp] API: ${baseUrl}`)
