// Tests for Codex provider resolution in the model resolver.
//
// Verifies that `resolveModel("openai/gpt-4o")` correctly routes to the
// OpenAI Codex provider with proper token loading and error handling.
//
// Pattern: Integration-style tests using isolated token persistence.

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  CodexTokenStore,
  type CodexToken,
} from "../../src/provider/codex-auth"
import { resolveModel } from "../../src/provider/resolver"
import type { CredentialStore } from "../../src/provider/credential-store"
import type { Credential } from "../../src/provider/credentials"
import { CatalogRegistry } from "../../src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../src/provider/catalog-snapshot"

class MemoryCredentialStore implements CredentialStore {
  value: Credential | null = null
  async get(): Promise<Credential | null> { return this.value }
  async set(_providerId: string, credential: Credential): Promise<void> { this.value = credential }
  async delete(): Promise<void> { this.value = null }
  async status(): Promise<"present" | "missing"> { return this.value ? "present" : "missing" }
}

/** A JWT-like access token that encodes a known accountId. */
function makeAccessToken(accountId: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  const body = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `${header}.${body}.sig`
}

/** Create a valid (non-expired) CodexToken for testing. */
function validToken(): CodexToken {
  return {
    access: makeAccessToken("test-acct-001"),
    refresh: "rt-valid",
    expires: Date.now() + 3600_000, // 1 hour from now
    accountId: "test-acct-001",
  }
}

/** Create an expired CodexToken for testing auto-refresh. */
function expiredToken(): CodexToken {
  return {
    access: makeAccessToken("test-acct-expired"),
    refresh: "rt-expired",
    expires: Date.now() - 3600_000, // 1 hour ago
    accountId: "test-acct-expired",
  }
}

function catalog(): CatalogRegistry {
  const models = Object.fromEntries(["gpt-4o", "gpt-4.1", "o3"].map((id) => [id, {
    id,
    name: id,
    description: "test model",
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: "2025-01-01",
    last_updated: "2025-01-01",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 1000, output: 100 },
  }]))
  return new CatalogRegistry(createCatalogSnapshot({
    openai: {
      id: "openai",
      name: "OpenAI",
      npm: "@openai/codex",
      env: ["OPENAI_API_KEY"],
      doc: "https://example.test",
      models,
    },
  }))
}

// ---------------------------------------------------------------------------
// resolveModel — codex provider routing
// ---------------------------------------------------------------------------
describe("resolveModel(openai/...) through the OpenAI Codex connection", () => {
  let tokenDir: string
  let tokenStore: CodexTokenStore

  beforeEach(() => {
    tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-resolver-codex-"))
    tokenStore = new CodexTokenStore(path.join(tokenDir, "codex-token.json"))
  })

  afterEach(() => {
    fs.rmSync(tokenDir, { recursive: true, force: true })
  })

  test("resolves a machine-stored OAuth credential without a legacy token file", async () => {
    const credentialStore = new MemoryCredentialStore()
    const token = validToken()
    credentialStore.value = {
      type: "oauth",
      access: token.access,
      refresh: token.refresh,
      expiresAt: token.expires,
      metadata: { accountId: token.accountId },
    }

    const model = await resolveModel("openai/gpt-4o", "main", { catalog: catalog(), credentialStore })

    expect(model.modelId).toBe("gpt-4o")
    expect(model.provider).toBe("codex-consumer")
  })

  test("returns a configured model when codex token is present", async () => {
    tokenStore.save(validToken())

    const model = await resolveModel("openai/gpt-4o", "main", { catalog: catalog(),
      codexTokenStore: tokenStore,
    })

    expect(model).toBeDefined()
    expect(model.modelId).toBe("gpt-4o")
    expect(model.provider).toBe("codex-consumer")
  })

  test("returns model with correct model ID for openai/gpt-4.1", async () => {
    tokenStore.save(validToken())

    const model = await resolveModel("openai/gpt-4.1", "main", { catalog: catalog(),
      codexTokenStore: tokenStore,
    })

    expect(model.modelId).toBe("gpt-4.1")
  })

  test("returns model with correct model ID for openai/o3", async () => {
    tokenStore.save(validToken())

    const model = await resolveModel("openai/o3", "main", { catalog: catalog(),
      codexTokenStore: tokenStore,
    })

    expect(model.modelId).toBe("o3")
  })

  test("throws a credential error when neither OpenAI connection is authenticated", async () => {
    await expect(
      resolveModel("openai/gpt-4o", "main", { catalog: catalog(),
        codexTokenStore: tokenStore,
      }),
    ).rejects.toThrow(/No credential found.*OPENAI_API_KEY/i)
  })

  test("auto-refreshes expired token before resolving", async () => {
    tokenStore.save(expiredToken())
    const refreshed = validToken()
    let refreshToken = ""
    let authorization = ""
    const model = await resolveModel("openai/gpt-4o", "main", { catalog: catalog(),
      codexFetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? ""
        return new Response("", { status: 200 })
      },
      codexTokenStore: tokenStore,
      refreshCodexToken: async (options) => {
        refreshToken = options.refreshToken
        return refreshed
      },
    })

    const result = await model.doStream({
      prompt: [],
      maxOutputTokens: 1,
    })
    await result.stream.pipeTo(new WritableStream())

    expect(refreshToken).toBe("rt-expired")
    expect(authorization).toBe(`Bearer ${refreshed.access}`)
    expect(tokenStore.load()).toEqual(refreshed)
  })

  test("instructs the user to sign in when refresh is rejected", async () => {
    tokenStore.save(expiredToken())
    const model = await resolveModel("openai/gpt-4o", "main", { catalog: catalog(),
      codexTokenStore: tokenStore,
      refreshCodexToken: async () => {
        throw new Error("refresh failed (401)")
      },
    })

    await expect(
      model.doStream({
        prompt: [],
        maxOutputTokens: 1,
      }),
    ).rejects.toThrow(/Codex login expired.*auth login openai-codex.*401/i)
  })
})
