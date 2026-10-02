const DEFAULT_RUNNER_URL = "http://127.0.0.1:4173"

function runnerBaseUrl(runnerUrl = process.env.QUARK_RUNNER_URL): string {
  return (runnerUrl?.trim() || DEFAULT_RUNNER_URL).replace(/\/+$/, "")
}

export function runnerCancelUrl(
  sessionId: string,
  runnerId: string,
  runnerUrl = process.env.QUARK_RUNNER_URL,
): string {
  return `${runnerBaseUrl(runnerUrl)}/api/runners/${encodeURIComponent(runnerId)}/sessions/${encodeURIComponent(sessionId)}/cancel`
}

async function resolveRunnerId(
  runnerId: string | undefined,
  runnerUrl: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  const configured = runnerId?.trim() || process.env.QUARK_RUNNER_ID?.trim()
  if (configured) return configured
  const response = await fetchImpl(`${runnerBaseUrl(runnerUrl)}/api/runners`, { method: "POST" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { runnerId?: unknown }
  if (typeof body.runnerId !== "string" || !body.runnerId) throw new Error("Runner API returned no runnerId")
  return body.runnerId
}

export async function cancelExternalTurn(
  sessionId: string,
  runnerId = process.env.QUARK_RUNNER_ID,
  fetchImpl: typeof fetch = globalThis.fetch,
  onAttempt?: (url: string) => void,
): Promise<void> {
  const runnerUrl = process.env.QUARK_RUNNER_URL
  const configured = runnerId?.trim() || process.env.QUARK_RUNNER_ID?.trim()
  const resolvedRunnerId = configured
    ? configured
    : await resolveRunnerId(runnerId, runnerUrl, fetchImpl)
  const url = runnerCancelUrl(sessionId, resolvedRunnerId, runnerUrl)
  onAttempt?.(url)
  const response = await fetchImpl(url, { method: "POST" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export function runnerCancelAttemptUrl(sessionId: string): string {
  const runnerId = process.env.QUARK_RUNNER_ID?.trim()
  return runnerId
    ? runnerCancelUrl(sessionId, runnerId)
    : `${runnerBaseUrl()}/api/runners`
}
