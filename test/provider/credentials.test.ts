import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspect } from "node:util"
import { ProtectedFileCredentialStore, type CredentialStore } from "../../src/provider/credential-store"
import {
  DefaultCredentialResolver,
  type Credential,
  type CredentialProviderDefinition,
} from "../../src/provider/credentials"

class MemoryStore implements CredentialStore {
  readonly values = new Map<string, Credential>()

  async get(providerId: string): Promise<Credential | null> {
    return this.values.get(providerId) ?? null
  }
  async set(providerId: string, credential: Credential): Promise<void> {
    this.values.set(providerId, credential)
  }
  async delete(providerId: string): Promise<void> {
    this.values.delete(providerId)
  }
  async status(providerId: string): Promise<"present" | "missing"> {
    return this.values.has(providerId) ? "present" : "missing"
  }
}

const openai: CredentialProviderDefinition = {
  id: "openai",
  auth: { type: "api-key", environmentVariables: ["OPENAI_API_KEY"] },
}
const codex: CredentialProviderDefinition = {
  id: "codex",
  auth: { type: "oauth-device", implementation: "codex" },
}

afterEach(() => {
  delete process.env.QUARK_TEST_CREDENTIAL
})

describe("DefaultCredentialResolver", () => {
  test("session credentials override every configured source without mutating process.env", async () => {
    const store = new MemoryStore()
    await store.set("openai", { type: "api-key", value: "stored-secret" })
    const resolver = new DefaultCredentialResolver(store, undefined, {
      OPENAI_API_KEY: "environment-secret",
    })
    resolver.setSessionCredential("openai", { type: "api-key", value: "session-secret" })

    const resolved = await resolver.resolve({ provider: openai, source: { source: "auto" }, interactive: false })

    expect(resolved?.origin).toBe("session")
    expect(resolved?.credential).toEqual({ type: "api-key", value: "session-secret" })
    expect(process.env.QUARK_TEST_CREDENTIAL).toBeUndefined()
  })

  test("auto uses a non-empty environment variable before the machine store", async () => {
    const store = new MemoryStore()
    await store.set("openai", { type: "api-key", value: "stored-secret" })
    const resolver = new DefaultCredentialResolver(store, undefined, { OPENAI_API_KEY: "environment-secret" })

    const resolved = await resolver.resolve({ provider: openai, source: { source: "auto" }, interactive: false })

    expect(resolved?.origin).toBe("environment")
    expect(resolved?.credential).toEqual({ type: "api-key", value: "environment-secret" })
  })

  test("auto falls through from an empty environment variable to the store", async () => {
    const store = new MemoryStore()
    await store.set("openai", { type: "api-key", value: "stored-secret" })
    const resolver = new DefaultCredentialResolver(store, undefined, { OPENAI_API_KEY: "" })

    const resolved = await resolver.resolve({ provider: openai, source: { source: "auto" }, interactive: false })

    expect(resolved?.origin).toBe("machine-store")
  })

  test("an explicit missing environment source does not fall through", async () => {
    const store = new MemoryStore()
    await store.set("openai", { type: "api-key", value: "stored-secret" })
    const resolver = new DefaultCredentialResolver(store, undefined, {})

    const resolved = await resolver.resolve({
      provider: openai,
      source: { source: "environment", variable: "OPENAI_API_KEY" },
      interactive: false,
    })

    expect(resolved).toBeNull()
  })

  test("prompt fails non-interactively with remediation", async () => {
    const resolver = new DefaultCredentialResolver(new MemoryStore())
    await expect(resolver.resolve({
      provider: openai,
      source: { source: "prompt" },
      interactive: false,
    })).rejects.toThrow(/interactive session.*environment variable or machine store/i)
  })

  test("auto retains legacy OAuth reads behind the credential boundary", async () => {
    const resolver = new DefaultCredentialResolver(
      new MemoryStore(),
      undefined,
      {},
      async (providerId) => providerId === "codex"
        ? { type: "oauth", access: "legacy-access", expiresAt: Date.now() + 1000 }
        : null,
    )

    const resolved = await resolver.resolve({ provider: codex, source: { source: "auto" }, interactive: false })

    expect(resolved?.origin).toBe("legacy-token-file")
  })

  test("string, JSON, and inspect output redact credential values", async () => {
    const resolver = new DefaultCredentialResolver(new MemoryStore(), undefined, { OPENAI_API_KEY: "super-secret" })
    const resolved = await resolver.resolve({ provider: openai, source: { source: "auto" }, interactive: false })

    expect(String(resolved)).not.toContain("super-secret")
    expect(JSON.stringify(resolved)).not.toContain("super-secret")
    expect(inspect(resolved)).not.toContain("super-secret")
  })

  test("status reports OAuth expiry without revealing values", async () => {
    const store = new MemoryStore()
    await store.set("codex", { type: "oauth", access: "secret", expiresAt: Date.now() - 1 })
    const resolver = new DefaultCredentialResolver(store)

    const status = await resolver.status({ provider: codex, source: { source: "store" } })

    expect(status.state).toBe("expired")
    expect(JSON.stringify(status)).not.toContain("secret")
  })
})

describe("ProtectedFileCredentialStore", () => {
  test("writes atomically with restrictive permissions and supports deletion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "quark-credential-store-"))
    const store = new ProtectedFileCredentialStore(directory)
    try {
      await store.set("openai", { type: "api-key", value: "stored-secret" })

      expect(await store.get("openai")).toEqual({ type: "api-key", value: "stored-secret" })
      expect(await store.status("openai")).toBe("present")
      expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([])
      if (process.platform !== "win32") {
        expect(statSync(directory).mode & 0o777).toBe(0o700)
        expect(statSync(join(directory, "openai.json")).mode & 0o777).toBe(0o600)
      }

      await store.delete("openai")
      expect(await store.get("openai")).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
