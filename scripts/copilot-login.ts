#!/usr/bin/env bun
/**
 * Manual Copilot OAuth login test.
 *
 * Usage:
 *   bun run scripts/copilot-login.ts
 *   bun run scripts/copilot-login.ts --enterprise company.ghe.com
 *
 * What it does:
 *   1. Starts the GitHub OAuth device flow
 *   2. Prints a URL and code for you to authorize in your browser
 *   3. Polls until you complete authorization
 *   4. Prints the access token and verifies it by calling the Copilot models endpoint
 *
 * This exercises the full auth path end-to-end against real GitHub servers.
 */

import {
  requestDeviceCode,
  pollForToken,
  normalizeDomain,
  saveToken,
} from "../src/provider/copilot-auth"
import { createCopilotFetch } from "../src/provider/copilot-fetch"

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const enterpriseIdx = args.indexOf("--enterprise")
const enterpriseInput = enterpriseIdx !== -1 ? args[enterpriseIdx + 1] : undefined
const domain = enterpriseInput ? (normalizeDomain(enterpriseInput) ?? "github.com") : "github.com"

console.log(`\n--- Copilot OAuth Device Flow ---`)
console.log(`Domain: ${domain}\n`)

// ---------------------------------------------------------------------------
// Step 1: Request device code
// ---------------------------------------------------------------------------
console.log("Requesting device code...")
const device = await requestDeviceCode({ domain })

console.log(`\n  Open this URL in your browser:`)
console.log(`  ${device.verification_uri}\n`)
console.log(`  Enter this code: ${device.user_code}\n`)
console.log(`Waiting for authorization (polling every ${device.interval}s)...`)

// ---------------------------------------------------------------------------
// Step 2: Poll for access token
// ---------------------------------------------------------------------------
const token = await pollForToken({
  domain,
  deviceCode: device.device_code,
  interval: device.interval,
})

console.log(`\nAuthorization successful!`)
console.log(`Token (first 20 chars): ${token.slice(0, 20)}...`)
console.log(`Token length: ${token.length}`)

// Persist token for agent use
saveToken(token, domain)
console.log(`Token saved to ~/.config/atom/copilot-token.json`)

// ---------------------------------------------------------------------------
// Step 3: Verify token by listing Copilot models
// ---------------------------------------------------------------------------
console.log(`\nVerifying token against Copilot API...`)

const baseURL = enterpriseInput
  ? `https://copilot-api.${domain}`
  : "https://api.githubcopilot.com"

const copilotFetch = createCopilotFetch({
  getToken: async () => token,
})

try {
  const response = await copilotFetch(`${baseURL}/models`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  })

  if (response.ok) {
    const data = await response.json() as { data?: Array<{ id: string }> }
    const models = data.data ?? []
    console.log(`\nAvailable models (${models.length}):`)
    for (const m of models.slice(0, 15)) {
      console.log(`  - ${m.id}`)
    }
    if (models.length > 15) {
      console.log(`  ... and ${models.length - 15} more`)
    }
  } else {
    const text = await response.text()
    console.log(`\nModels endpoint returned ${response.status}: ${text}`)
  }
} catch (err) {
  console.log(`\nFailed to verify token: ${err}`)
}

// ---------------------------------------------------------------------------
// Step 4: Quick LLM test (optional — sends a tiny prompt)
// ---------------------------------------------------------------------------
console.log(`\nSending test prompt to Copilot (gpt-4o)...`)

try {
  const response = await copilotFetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Say 'hello' in one word." }],
      max_tokens: 10,
    }),
  })

  if (response.ok) {
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const reply = data.choices?.[0]?.message?.content ?? "(no content)"
    console.log(`Response: ${reply}`)
    console.log(`\nAll checks passed. OAuth flow works correctly.`)
  } else {
    const text = await response.text()
    console.log(`LLM request failed ${response.status}: ${text}`)
  }
} catch (err) {
  console.log(`LLM test failed: ${err}`)
}

console.log(`\n--- Done ---\n`)
