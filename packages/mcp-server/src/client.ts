/**
 * Deep-Check API v1 HTTP Client
 *
 * Wraps all Deep-Check API v1 endpoints with typed methods.
 * Uses native fetch — no external HTTP dependencies.
 */

export interface VerifyParams {
  documentFront: string
  documentType: string
  documentBack?: string
  externalRef?: string
}

export interface BatchDocument {
  documentFront: string
  documentType: string
  documentBack?: string
  externalRef?: string
}

export interface BatchVerifyParams {
  documents: BatchDocument[]
  webhookUrl?: string
}

export interface ListSessionsParams {
  page?: number
  limit?: number
  status?: string
  externalRef?: string
}

export interface CreateSessionParams {
  candidateName?: string
  role?: string
  date?: string
  score?: number
  status?: string
  externalRef?: string
}

export interface UpdateSessionParams {
  status?: string
  reviewNote?: string
  externalRef?: string
}

export class DeepCheckApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'DeepCheckApiError'
  }
}

export class DeepCheckClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '') // strip trailing slash
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const json = (await res.json()) as Record<string, unknown>

    if (!res.ok) {
      const msg =
        typeof json.error === 'string'
          ? json.error
          : `API returned ${res.status}`
      throw new DeepCheckApiError(msg, res.status, json)
    }

    return json as T
  }

  // ─── Document Verification ──────────────────────────────────────────────────

  async verifyDocument(params: VerifyParams): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/verify', params)
  }

  async batchVerify(
    params: BatchVerifyParams,
  ): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/batch', params)
  }

  async getBatchStatus(jobId: string): Promise<Record<string, unknown>> {
    return this.request(
      'GET',
      `/api/v1/batch?jobId=${encodeURIComponent(jobId)}`,
    )
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  async listSessions(
    params?: ListSessionsParams,
  ): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.status) qs.set('status', params.status)
    if (params?.externalRef) qs.set('external_ref', params.externalRef)
    const query = qs.toString()
    return this.request('GET', `/api/v1/sessions${query ? `?${query}` : ''}`)
  }

  async getSession(
    id: string,
    includeEvidence?: boolean,
  ): Promise<Record<string, unknown>> {
    const qs = includeEvidence ? '?include_evidence=true' : ''
    return this.request(
      'GET',
      `/api/v1/sessions/${encodeURIComponent(id)}${qs}`,
    )
  }

  async createSession(
    params: CreateSessionParams,
  ): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/sessions', params)
  }

  async updateSession(
    id: string,
    params: UpdateSessionParams,
  ): Promise<Record<string, unknown>> {
    return this.request(
      'PATCH',
      `/api/v1/sessions/${encodeURIComponent(id)}`,
      params,
    )
  }

  // ─── Enrollment ─────────────────────────────────────────────────────────────

  async getEnrollment(email: string): Promise<Record<string, unknown>> {
    return this.request(
      'GET',
      `/api/v1/enroll?email=${encodeURIComponent(email)}`,
    )
  }

  // ─── Certificates ──────────────────────────────────────────────────────────

  async checkCertificate(id: string): Promise<Record<string, unknown>> {
    return this.request(
      'GET',
      `/api/certificates?id=${encodeURIComponent(id)}`,
    )
  }
}
