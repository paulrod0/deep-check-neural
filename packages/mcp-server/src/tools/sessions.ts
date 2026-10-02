/**
 * Session management tools — list, get, create, update
 *
 * Sessions represent proctoring/assessment sessions in Deep-Check.
 * Each session tracks a candidate's identity verification score,
 * behavioral biometrics, liveness checks, and evidence.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DeepCheckClient, DeepCheckApiError } from '../client.js'
import {
  ListSessionsInput,
  GetSessionInput,
  CreateSessionInput,
  UpdateSessionInput,
} from '../types.js'

function formatError(err: unknown): string {
  if (err instanceof DeepCheckApiError) {
    return `API Error (${err.status}): ${err.message}`
  }
  return `Error: ${err instanceof Error ? err.message : String(err)}`
}

export function registerSessionTools(
  server: McpServer,
  client: DeepCheckClient,
): void {
  // ── list_sessions ──────────────────────────────────────────────────────────

  server.registerTool('list_sessions', {
    title: 'List Sessions',
    description:
      'List proctoring/assessment sessions with pagination and optional filters. Returns session summaries (without evidence data). Use get_session with includeEvidence=true for full details.',
    inputSchema: ListSessionsInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.listSessions({
        page: args.page,
        limit: args.limit,
        status: args.status,
        externalRef: args.externalRef,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: formatError(err) }],
        isError: true,
      }
    }
  })

  // ── get_session ────────────────────────────────────────────────────────────

  server.registerTool('get_session', {
    title: 'Get Session',
    description:
      'Get detailed information about a specific proctoring session. Includes candidate name, role, trust score, status, alerts, liveness/AI risk scores, keystroke count, and optionally the full evidence array.',
    inputSchema: GetSessionInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.getSession(
        args.id,
        args.includeEvidence,
      )

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: formatError(err) }],
        isError: true,
      }
    }
  })

  // ── create_session ─────────────────────────────────────────────────────────

  server.registerTool('create_session', {
    title: 'Create Session',
    description:
      'Create a new proctoring/assessment session. Returns the new session ID. All fields are optional — defaults are provided (status=review, score=0, date=today).',
    inputSchema: CreateSessionInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.createSession({
        candidateName: args.candidateName,
        role: args.role,
        date: args.date,
        score: args.score,
        status: args.status,
        externalRef: args.externalRef,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: formatError(err) }],
        isError: true,
      }
    }
  })

  // ── update_session ─────────────────────────────────────────────────────────

  server.registerTool('update_session', {
    title: 'Update Session',
    description:
      "Update a session's status, add a review note, or update the external reference. Review notes are automatically timestamped and appended to the session's alert history.",
    inputSchema: UpdateSessionInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const { id, ...updateFields } = args
      const result = await client.updateSession(id, updateFields)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: formatError(err) }],
        isError: true,
      }
    }
  })
}
