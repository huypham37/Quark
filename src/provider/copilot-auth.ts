// Copilot OAuth device flow authentication
// Implements GitHub's device code flow for Copilot token acquisition.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
const POLL_SAFETY_MARGIN_MS = 3000
const TOKEN_DIR = path.join(os.homedir(), ".config", "atom")
const TOKEN_FILE = path.join(TOKEN_DIR, "copilot-token.json")

// Simple fetch function type — avoids Bun's typeof fetch which includes .preconnect
export type FetchFn = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
}

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`)
    return url.hostname
  } catch {
    return null
  }
}

export async function requestDeviceCode(options: {
  domain: string
  fetch?: FetchFn
}): Promise<DeviceCodeResponse> {
  const f = options.fetch ?? globalThis.fetch
  const url = `https://${options.domain}/login/device/code`

  const response = await f(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "read:user",
    }),
  })

  if (!response.ok) {
    throw new Error(`Device code request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as DeviceCodeResponse
  return data
}

export async function pollForToken(options: {
  domain: string
  deviceCode: string
  interval: number
  signal?: AbortSignal
  fetch?: FetchFn
}): Promise<string> {
  const f = options.fetch ?? globalThis.fetch
  const url = `https://${options.domain}/login/oauth/access_token`
  let interval = options.interval

  while (true) {
    if (options.signal?.aborted) {
      throw new Error("Login cancelled")
    }

    const response = await f(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: options.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      access_token?: string
      error?: string
      interval?: number
    }

    if (data.access_token) {
      return data.access_token
    }

    if (data.error === "authorization_pending") {
      if (interval > 0) await sleep(interval * 1000 + POLL_SAFETY_MARGIN_MS, options.signal)
      continue
    }

    if (data.error === "slow_down") {
      interval += 5
      if (data.interval && typeof data.interval === "number" && data.interval > 0) {
        interval = data.interval
      }
      if (interval > 0) await sleep(interval * 1000 + POLL_SAFETY_MARGIN_MS, options.signal)
      continue
    }

    if (data.error) {
      throw new Error(`Device flow failed: ${data.error}`)
    }

    if (interval > 0) await sleep(interval * 1000 + POLL_SAFETY_MARGIN_MS, options.signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Login cancelled"))
      return
    }
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(new Error("Login cancelled"))
      },
      { once: true },
    )
  })
}

// ---------------------------------------------------------------------------
// Token persistence — save/load OAuth token to ~/.config/atom/
// ---------------------------------------------------------------------------

export function saveToken(token: string, domain: string = "github.com"): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true })
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ token, domain, savedAt: Date.now() }),
    "utf-8",
  )
}

export function loadToken(): string | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8")
    const data = JSON.parse(raw) as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}
