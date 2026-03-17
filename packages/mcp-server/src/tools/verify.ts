/**
 * verify_document — Single document identity verification
 *
 * Verifies a document's authenticity through:
 *  - MRZ (Machine Readable Zone) parsing & checksum validation
 *  - Forensic analysis (ELA, noise, compression artifacts)
 *  - Face detection & quality assessment
 *  - Country-specific document number validation (195 countries)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DeepCheckClient, DeepCheckApiError } from '../client.js'
import { VerifyDocumentInput } from '../types.js'

export function registerVerifyTools(
  server: McpServer,
  client: DeepCheckClient,
): void {
  server.registerTool('verify_document', {
    title: 'Verify Document',
    description:
      "Verify an identity document's authenticity. Analyzes MRZ data, runs forensic checks (ELA, noise analysis), detects faces, and validates document numbers for 195 countries. Returns a verdict (authentic/suspicious/tampered), risk score, and a shareable certificate URL.",
    inputSchema: VerifyDocumentInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.verifyDocument({
        documentFront: args.documentFront,
        documentType: args.documentType,
        documentBack: args.documentBack,
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
