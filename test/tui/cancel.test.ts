import { afterEach, describe, expect, test } from "bun:test"
import { cancelExternalTurn, runnerCancelUrl } from "../../packages/quark/src/tui/cancel"

afterEach(() => {
  delete process.env.QUARK_RUNNER_ID
  delete process.env.QUARK_RUNNER_URL
})

describe("external turn cancellation", () => {
  test("builds the runner cancel route with runner and session ids", () => {
    expect(runnerCancelUrl("session/one", "runner/one", "http://runner.test///"))
      .toBe("http://runner.test/api/runners/runner%2Fone/sessions/session%2Fone/cancel")
  })

  test("posts to the configured runner cancel endpoint", async () => {
    process.env.QUARK_RUNNER_ID = "runner-123"
    process.env.QUARK_RUNNER_URL = "http://runner.test"
    const requests: Array<{ url: string; method?: string }> = []
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), method: init?.method })
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 })
    }

    await cancelExternalTurn("live-session", undefined, fetchMock)
    expect(requests).toEqual([{
      url: "http://runner.test/api/runners/runner-123/sessions/live-session/cancel",
      method: "POST",
    }])
  })

  test("mints a runner when no runner id is configured, then cancels through it", async () => {
    process.env.QUARK_RUNNER_URL = "http://runner.test"
    const requests: Array<{ url: string; method?: string }> = []
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, method: init?.method })
      return url.endsWith("/api/runners")
        ? new Response(JSON.stringify({ runnerId: "minted-runner" }), { status: 201 })
        : new Response(JSON.stringify({ cancelled: true }), { status: 200 })
    }

    await cancelExternalTurn("live-session", undefined, fetchMock)
    expect(requests).toEqual([
      { url: "http://runner.test/api/runners", method: "POST" },
      { url: "http://runner.test/api/runners/minted-runner/sessions/live-session/cancel", method: "POST" },
    ])
  })

  test("rejects non-success responses for the failure toast", async () => {
    process.env.QUARK_RUNNER_ID = "runner-123"
    await expect(cancelExternalTurn("live-session", undefined, async () => new Response(null, { status: 503 })))
      .rejects.toThrow("HTTP 503")
  })
})
