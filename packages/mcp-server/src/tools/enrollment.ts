/**
 * get_enrollment — Look up biometric keystroke enrollment profiles
 *
 * Retrieves the enrollment profile metadata for a candidate by email.
 * Profiles contain keystroke biometric fingerprints (flight times, hold times,
 * digraph patterns, entropy) used for continuous identity verification.
 *
 * Note: Creating enrollment profiles requires raw keystroke data and is only
 * possible through the web UI — not exposed via MCP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DeepCheckClient, DeepCheckApiError } from '../client.js'
import { GetEnrollmentInput } from '../types.js'

export function registerEnrollmentTools(
  server: McpServer,
  client: DeepCheckClient,
): void {
  server.registerTool('get_enrollment', {
    title: 'Get Enrollment Profile',
    description:
      "Look up a candidate's biometric keystroke enrollment profile by email. Returns profile metadata including enrollment hash, sample size, context (prose/code), creation date, and expiry (90 days). Returns 404 if no active profile exists.",
    inputSchema: GetEnrollmentInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.getEnrollment(args.email)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      const message =
        err instanceof DeepCheckApiError
          ? `API Error (${err.status}): ${err.message}`
          : `Error: ${err instanceof Error ? err.message : String(err)}`

      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      }
    }
  })
}
