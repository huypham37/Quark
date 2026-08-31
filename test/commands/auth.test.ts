import { beforeEach, describe, expect, test } from "bun:test"
import type { CredentialStore } from "../../src/provider/credential-store"
import type { Credential } from "../../src/provider/credentials"
import { DefaultCredentialResolver } from "../../src/provider/credentials"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../src/provider/definitions"
import {
  authStatus,
  clearSessionCredentials,
  loginApiKey,
  loginOAuth,
  logoutProvider,
} from "../../src/commands/auth"

class MemoryStore implements CredentialStore {
  values = new Map<string, Credential>()
  async get(providerId: string) { return this.values.get(providerId) ?? null }
  async set(providerId: string, credential: Credential) { this.values.set(providerId, credential) }
  async delete(providerId: string) { this.values.delete(providerId) }
  async status(providerId: string): Promise<"present" | "missing"> {
    return this.values.has(providerId) ? "present" : "missing"
  }
}

beforeEach(() => clearSessionCredentials())

describe("auth commands", () => {
  test("session login never writes the key to the store or process environment", async () => {
    const store = new MemoryStore()
    const before = process.env.OPENROUTER_API_KEY

    const status = await loginApiKey({
      providerId: "openrouter",
      apiKey: "session-secret",
      persistence: "session",
      services: { store, environment: {} },
    })

    expect(status.origin).toBe("session")
    expect(store.values.size).toBe(0)
    expect(process.env.OPENROUTER_API_KEY).toBe(before)
    const runtimeCredential = await new DefaultCredentialResolver(store, undefined, {}).resolve({
      provider: BUNDLED_PROVIDER_DEFINITIONS.openrouter,
      source: { source: "auto" },
      interactive: false,
    })
    expect(runtimeCredential?.origin).toBe("session")
    expect(JSON.stringify(await authStatus({ store, environment: {} }))).not.toContain("session-secret")
  })

  test("machine login writes only to the injected credential store", async () => {
    const store = new MemoryStore()
    await loginApiKey({
      providerId: "openrouter",
      apiKey: "stored-secret",
      persistence: "store",
      services: { store, environment: {} },
    })

    expect(await store.get("openrouter")).toEqual({ type: "api-key", value: "stored-secret" })
    const status = (await authStatus({ store, environment: {} }))
      .find((item) => item.providerId === "openrouter")
    expect(status?.origin).toBe("machine-store")
  })

  test("DeepSeek stored keys replace existing keys and environment credentials retain precedence", async () => {
    const store = new MemoryStore()
    store.values.set("deepseek", { type: "api-key", value: "old-secret" })
    await loginApiKey({
      providerId: "deepseek",
      apiKey: "new-secret",
      persistence: "store",
      services: { store, environment: {} },
    })

    expect(await store.get("deepseek")).toEqual({ type: "api-key", value: "new-secret" })
    const statuses = await authStatus({ store, environment: { DEEPSEEK_API_KEY: "environment-secret" } })
    const deepseek = statuses.filter((item) => item.providerId === "deepseek")
    expect(deepseek).toEqual([expect.objectContaining({ state: "authenticated", origin: "environment" })])
    expect(JSON.stringify(statuses)).not.toContain("environment-secret")
    expect(JSON.stringify(statuses)).not.toContain("new-secret")
  })

  test("Copilot OAuth login dispatches device flow and stores the shared credential", async () => {
    const store = new MemoryStore()
    let shownCode = ""
    await loginOAuth({
      providerId: "copilot",
      persistence: "store",
      enterpriseDomain: "https://github.example.com/",
      onDeviceCode: (info) => { shownCode = info.userCode },
      services: { store },
      implementations: {
        requestCopilotDeviceCode: async ({ domain }) => {
          expect(domain).toBe("github.example.com")
          return { device_code: "device-secret", user_code: "ABCD-1234", verification_uri: "https://github.example.com/login/device", interval: 5 }
        },
        pollCopilotToken: async ({ domain, deviceCode }) => {
          expect(domain).toBe("github.example.com")
          expect(deviceCode).toBe("device-secret")
          return "access-secret"
        },
      },
    })

    expect(shownCode).toBe("ABCD-1234")
    expect(await store.get("copilot")).toEqual({
      type: "oauth",
      access: "access-secret",
      metadata: { domain: "github.example.com" },
    })
  })

  test("Codex OAuth device login stores refresh and account metadata", async () => {
    const store = new MemoryStore()
    await loginOAuth({
      providerId: "codex",
      persistence: "store",
      method: "device",
      onDeviceCode: () => {},
      services: { store },
      implementations: {
        loginCodexWithDeviceCode: async ({ onDeviceCode }) => {
          onDeviceCode({ userCode: "CODE", verificationUri: "https://example.test", intervalSeconds: 5 })
          return { access: "access", refresh: "refresh", expires: 1234, accountId: "account" }
        },
      },
    })

    expect(await store.get("codex")).toEqual({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expiresAt: 1234,
      metadata: { accountId: "account" },
    })
  })

  test("cancelled OAuth login does not persist a partial credential", async () => {
    const store = new MemoryStore()
    await expect(loginOAuth({
      providerId: "copilot",
      persistence: "store",
      onDeviceCode: () => {},
      services: { store },
      implementations: {
        requestCopilotDeviceCode: async () => ({ device_code: "device", user_code: "CODE", verification_uri: "https://example.test", interval: 0 }),
        pollCopilotToken: async () => { throw new Error("Login cancelled") },
      },
    })).rejects.toThrow("Login cancelled")
    expect(store.values.size).toBe(0)
  })

  test("OAuth session login does not write to the machine store", async () => {
    const store = new MemoryStore()
    const status = await loginOAuth({
      providerId: "copilot",
      persistence: "session",
      onDeviceCode: () => {},
      services: { store },
      implementations: {
        requestCopilotDeviceCode: async () => ({ device_code: "device", user_code: "CODE", verification_uri: "https://example.test", interval: 0 }),
        pollCopilotToken: async () => "session-oauth-secret",
      },
    })

    expect(status.origin).toBe("session")
    expect(store.values.size).toBe(0)
    const resolved = await new DefaultCredentialResolver(store, undefined, {}).resolve({
      provider: BUNDLED_PROVIDER_DEFINITIONS.copilot,
      source: { source: "auto" },
      interactive: false,
    })
    expect(resolved?.origin).toBe("session")
  })

  test("status detects a bundled environment variable without exposing it", async () => {
    const statuses = await authStatus({
      store: new MemoryStore(),
      environment: { OPENROUTER_API_KEY: "environment-secret" },
    })
    const openrouter = statuses.find((item) => item.providerId === "openrouter")

    expect(openrouter).toMatchObject({ state: "authenticated", origin: "environment" })
    expect(JSON.stringify(statuses)).not.toContain("environment-secret")
  })

  test("logout deletes machine and session credentials", async () => {
    const store = new MemoryStore()
    await loginApiKey({ providerId: "openrouter", apiKey: "stored", persistence: "store", services: { store } })
    await loginApiKey({ providerId: "openrouter", apiKey: "session", persistence: "session", services: { store } })

    await logoutProvider("openrouter", { store })

    expect(await store.get("openrouter")).toBeNull()
    const status = (await authStatus({ store, environment: {} }))
      .find((item) => item.providerId === "openrouter")
    expect(status?.state).toBe("missing")
  })
})
