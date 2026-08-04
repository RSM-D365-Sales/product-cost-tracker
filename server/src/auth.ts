import { config } from './config.js'

/**
 * Azure AD client-credentials token acquisition for the F&O resource.
 *
 * Tokens live an hour; they are cached in memory and refreshed 60 seconds
 * early so a request never races the expiry. Concurrent callers share one
 * in-flight refresh rather than each hitting the token endpoint.
 */

interface CachedToken {
  accessToken: string
  /** Epoch ms. */
  expiresAt: number
}

let cache: CachedToken | null = null
let inflight: Promise<CachedToken> | null = null

const REFRESH_MARGIN_MS = 60_000

async function requestToken(): Promise<CachedToken> {
  const url = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    // The F&O resource, not Graph. The /.default suffix requests whatever
    // application permissions the app registration has been granted.
    scope: `${config.d365Url}/.default`,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Azure AD token request failed (HTTP ${res.status}). ${detail.slice(0, 500)}`,
    )
  }

  const json = (await res.json()) as {
    access_token: string
    expires_in: number
  }

  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

export async function getAccessToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt - REFRESH_MARGIN_MS) {
    return cache.accessToken
  }

  // Collapse concurrent refreshes into one request.
  if (!inflight) {
    inflight = requestToken()
      .then((t) => {
        cache = t
        return t
      })
      .finally(() => {
        inflight = null
      })
  }

  return (await inflight).accessToken
}

/** Drops the cached token; used when D365 answers 401 so the next call retries clean. */
export function invalidateToken(): void {
  cache = null
}
