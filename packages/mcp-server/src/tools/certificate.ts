/**
 * check_certificate — Verify a Deep-Check verification certificate
 *
 * Certificates are issued after document verification and contain a
 * cryptographic HMAC signature. This tool validates the signature and
 * returns the full certificate data including verdict, forensics summary,
 * and issuer information.
 *
 * Certificates are public and do not require authentication.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DeepCheckClient, DeepCheckApiError } from '../client.js'
import { CheckCertificateInput } from '../types.js'

export function registerCertificateTools(
  server: McpServer,
  client: DeepCheckClient,
): void {
  server.registerTool('check_certificate', {
    title: 'Check Certificate',
    description:
      "Verify a Deep-Check verification certificate's cryptographic authenticity. Returns the certificate's signature validity, expiration status, document verdict (authentic/suspicious/tampered), MRZ summary, forensic risk scores, and issuer information. Certificates are valid for 1 year after issuance.",
    inputSchema: CheckCertificateInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false, // no external API call — uses Deep-Check only
    },
  }, async (args) => {
    try {
      const result = await client.checkCertificate(args.certificateId)

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
