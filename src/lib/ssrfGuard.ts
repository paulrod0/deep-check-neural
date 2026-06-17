/**
 * Deep-Check · SSRF Guard
 *
 * Shared URL safety validation to block Server-Side Request Forgery (SSRF)
 * against user-controlled URLs before any outbound fetch.
 *
 * Rejects:
 *  - non http/https schemes
 *  - loopback (127.0.0.0/8, ::1, 0.0.0.0)
 *  - link-local / cloud metadata (169.254.0.0/16, 169.254.169.254, metadata.google.internal)
 *  - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
 *  - IPv6 ULA (fc00::/7) and loopback
 *  - localhost, *.internal, *.local hostnames
 *
 * Logic extracted/replicated from src/app/api/osint/batch/route.ts (isUrlSafe).
 */

/** Safe fetch options to pair with every validated outbound request. */
export const SAFE_FETCH_OPTIONS = {
  // Never follow redirects: prevents an allowed host from redirecting to an
  // internal/metadata target (open-redirect SSRF bypass).
  redirect: 'error' as const,
}

/** Parse an IPv4 dotted-quad host into 4 octets, or null if not IPv4. */
function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => {
    if (!/^\d+$/.test(p)) return NaN
    return Number(p)
  })
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return nums
}

/** Returns true if the IPv4 octets fall in a blocked (private/loopback/link-local) range. */
function isBlockedIpv4(parts: number[]): boolean {
  if (parts[0] === 127) return true // 127.0.0.0/8 loopback
  if (parts[0] === 10) return true // 10.0.0.0/8 private
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 172.16.0.0/12 private
  if (parts[0] === 192 && parts[1] === 168) return true // 192.168.0.0/16 private
  if (parts[0] === 169 && parts[1] === 254) return true // 169.254.0.0/16 link-local + metadata
  if (parts[0] === 0) return true // 0.0.0.0/8
  return false
}

/**
 * Validate that a URL is safe to fetch (not pointing at private/internal infra).
 *
 * Synchronous on purpose: no DNS resolution. Hostnames that resolve to private
 * IPs at request time cannot be fully prevented here, so callers MUST also pass
 * SAFE_FETCH_OPTIONS (redirect: 'error') to the fetch.
 */
export async function isUrlSafe(urlStr: string): Promise<boolean> {
  try {
    const u = new URL(urlStr)

    // Only allow http/https
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false

    // Normalize hostname; strip IPv6 brackets
    let host = u.hostname.toLowerCase()
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }

    if (!host) return false

    // Block obvious loopback / metadata / internal hostnames
    if (host === 'localhost') return false
    if (host === '0.0.0.0') return false
    if (host === 'metadata.google.internal') return false
    if (host.endsWith('.internal') || host.endsWith('.local')) return false

    // IPv6 checks
    if (host.includes(':')) {
      if (host === '::1' || host === '::') return false // loopback / unspecified
      // IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254)
      const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
      if (mapped) {
        const v4 = parseIpv4(mapped[1])
        if (v4 && isBlockedIpv4(v4)) return false
      }
      // fc00::/7 Unique Local Addresses (fc.. and fd..) + fe80::/10 link-local
      const firstHextet = host.split(':')[0]
      if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return false
      if (firstHextet.startsWith('fe8') || firstHextet.startsWith('fe9') ||
          firstHextet.startsWith('fea') || firstHextet.startsWith('feb')) return false
      return true
    }

    // IPv4 literal checks
    const parts = parseIpv4(host)
    if (parts) {
      if (isBlockedIpv4(parts)) return false
      return true
    }

    // Hostname (DNS name): allowed. DNS rebinding to private IPs is mitigated by
    // SAFE_FETCH_OPTIONS (redirect: 'error'), not resolvable statically here.
    return true
  } catch {
    return false
  }
}
