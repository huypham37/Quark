import { describe, test, expect } from "bun:test"
import { getCustomFetch } from "../../packages/runner/src/provider/custom-fetch"

describe("getCustomFetch", () => {
  test("returns an independent fetch function for each Copilot resolution", () => {
    const agent = getCustomFetch("copilot", { getToken: async () => "token", initiator: "agent" })
    const user = getCustomFetch("copilot", { getToken: async () => "token" })
    expect(typeof agent).toBe("function")
    expect(typeof user).toBe("function")
    expect(agent).not.toBe(user)
  })

  test("returns undefined for providers without a custom wrapper", () => {
    expect(getCustomFetch("openai")).toBeUndefined()
    expect(getCustomFetch("anthropic")).toBeUndefined()
    expect(getCustomFetch("copilot")).toBeUndefined()
  })
})
