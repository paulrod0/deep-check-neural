/**
 * batch_verify + batch_status — Async batch document verification
 *
 * batch_verify: Submit up to 100 documents for asynchronous processing.
 *   Returns a jobId to poll with batch_status.
 *
 * batch_status: Check the progress/results of a batch verification job.
 *   Jobs expire after 1 hour.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DeepCheckClient, DeepCheckApiError } from '../client.js'
import { BatchVerifyInput, BatchStatusInput } from '../types.js'

export function registerBatchTools(
  server: McpServer,
  client: DeepCheckClient,
): void {
  // ── batch_verify ────────────────────────────────────────────────────────────

  server.registerTool('batch_verify', {
    title: 'Batch Verify Documents',
    description:
      'Submit up to 100 identity documents for async batch verification. Returns a jobId that you can poll with batch_status. Optionally provide a webhookUrl to receive results when processing completes. Each document needs a base64-encoded front image and document type.',
    inputSchema: BatchVerifyInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.batchVerify({
        documents: args.documents,
        webhookUrl: args.webhookUrl,
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

  // ── batch_status ───────────────────────────────────────────────────────────

  server.registerTool('batch_status', {
    title: 'Batch Job Status',
    description:
      'Check the status of an async batch verification job. Returns progress percentage, processed/total counts, and full results when completed. Jobs expire after 1 hour.',
    inputSchema: BatchStatusInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const result = await client.getBatchStatus(args.jobId)

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
