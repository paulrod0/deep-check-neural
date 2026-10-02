/**
 * Shared Zod schemas for MCP tool input/output validation.
 *
 * These schemas serve two purposes:
 *  1. Runtime validation of arguments passed by AI agents
 *  2. Auto-generated JSON Schema descriptions that agents read to understand parameters
 */

import { z } from 'zod'

// ─── Shared enums ─────────────────────────────────────────────────────────────

export const DocumentTypeSchema = z
  .enum(['passport', 'dni', 'driving_license', 'residence_permit'])
  .describe(
    'Type of identity document: passport, dni (national ID), driving_license, or residence_permit',
  )

export const SessionStatusSchema = z
  .enum(['passed', 'review', 'flagged'])
  .describe('Session status filter: passed, review, or flagged')

// ─── verify_document ─────────────────────────────────────────────────────────

export const VerifyDocumentInput = {
  documentFront: z
    .string()
    .describe('Base64-encoded image of the document front side'),
  documentType: DocumentTypeSchema,
  documentBack: z
    .string()
    .optional()
    .describe('Base64-encoded image of the document back side (optional)'),
  externalRef: z
    .string()
    .optional()
    .describe(
      'Your external reference ID to correlate this verification (max 255 chars)',
    ),
}

// ─── batch_verify ────────────────────────────────────────────────────────────

export const BatchDocumentSchema = z.object({
  documentFront: z
    .string()
    .describe('Base64-encoded image of the document front side'),
  documentType: DocumentTypeSchema,
  documentBack: z
    .string()
    .optional()
    .describe('Base64-encoded image of the document back side'),
  externalRef: z
    .string()
    .optional()
    .describe('External reference ID for this document'),
})

export const BatchVerifyInput = {
  documents: z
    .array(BatchDocumentSchema)
    .min(1)
    .max(100)
    .describe('Array of documents to verify (1-100)'),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .describe('Webhook URL to receive notification when batch completes'),
}

// ─── batch_status ────────────────────────────────────────────────────────────

export const BatchStatusInput = {
  jobId: z
    .string()
    .describe(
      'The batch job ID returned by batch_verify (format: batch_<timestamp>_<id>)',
    ),
}

// ─── list_sessions ───────────────────────────────────────────────────────────

export const ListSessionsInput = {
  page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Results per page (default: 20, max: 100)'),
  status: SessionStatusSchema.optional().describe(
    'Filter by session status',
  ),
  externalRef: z
    .string()
    .optional()
    .describe('Filter by external reference ID'),
}

// ─── get_session ─────────────────────────────────────────────────────────────

export const GetSessionInput = {
  id: z.string().describe('The session/assessment ID'),
  includeEvidence: z
    .boolean()
    .optional()
    .describe(
      'Include full evidence array (screenshots, timestamps). Default: false',
    ),
}

// ─── create_session ──────────────────────────────────────────────────────────

export const CreateSessionInput = {
  candidateName: z
    .string()
    .optional()
    .describe("Candidate's full name"),
  role: z
    .string()
    .optional()
    .describe('Role/position the candidate is applying for'),
  date: z
    .string()
    .optional()
    .describe('Session date in YYYY-MM-DD format (default: today)'),
  score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Initial trust score 0-100 (default: 0)'),
  status: SessionStatusSchema.optional().describe(
    'Initial status (default: review)',
  ),
  externalRef: z
    .string()
    .optional()
    .describe('External reference ID (max 255 chars)'),
}

// ─── update_session ──────────────────────────────────────────────────────────

export const UpdateSessionInput = {
  id: z.string().describe('The session/assessment ID to update'),
  status: SessionStatusSchema.optional().describe('New session status'),
  reviewNote: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Review note to append to the session alerts (max 2000 chars). Timestamped automatically.',
    ),
  externalRef: z
    .string()
    .max(255)
    .optional()
    .describe('Update external reference ID (max 255 chars)'),
}

// ─── get_enrollment ──────────────────────────────────────────────────────────

export const GetEnrollmentInput = {
  email: z
    .string()
    .email()
    .describe('Candidate email address to look up the enrollment profile'),
}

// ─── check_certificate ───────────────────────────────────────────────────────

export const CheckCertificateInput = {
  certificateId: z
    .string()
    .describe(
      'The certificate ID to verify (format: cert_<timestamp>_<hash>)',
    ),
}
