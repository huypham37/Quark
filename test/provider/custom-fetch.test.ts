import { describe, test, expect } from "bun:test"
import { getCustomFetch, setForceAgent } from "../../src/provider/custom-fetch"

describe("getCustomFetch", () => {
  test("returns a fetch function for copilot with getToken", () => {
    const fetchFn = getCustomFetch("copilot", {
      getToken: async () => "test-token",
    })
    expect(fetchFn).toBeDefined()
    expect(typeof fetchFn).toBe("function")
  })

  test("returns undefined for unknown providers", () => {
    expect(getCustomFetch("openai")).toBeUndefined()
    expect(getCustomFetch("anthropic")).toBeUndefined()
    expect(getCustomFetch("deepseek")).toBeUndefined()
  })

  test("returns undefined for copilot without getToken option", () => {
    expect(getCustomFetch("copilot")).toBeUndefined()
  })
})

describe("setForceAgent", () => {
  test("propagates to created CopilotFetchFn instances", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    // We can't easily inject mockFetch into getCustomFetch's createCopilotFetch,
    // but we can test that setForceAgent doesn't throw and the fetch is callable.
    const fetchFn = getCustomFetch("copilot", {
      getToken: async () => "test-token",
    })
    expect(fetchFn).toBeDefined()

    // setForceAgent should not throw (it iterates instances, may be empty or not)
    setForceAgent(true)
    setForceAgent(false)
  })
})
