import { expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { AGENT_NAME, AGENT_VERSION, registerInitialization } from "../src/initialization"

function initialize(params: acp.InitializeRequest, capabilities?: acp.AgentCapabilities) {
  const app = registerInitialization(acp.agent({ name: "quark-acp-test" }), capabilities)
  return acp
    .client({ name: "test-client" })
    .connectWith(app, (ctx) => ctx.request(acp.methods.agent.initialize, params))
}

test("negotiates ACP v1 with the Quark identity and no auth methods", async () => {
  const response = await initialize({ protocolVersion: 1 })

  expect(response.protocolVersion).toBe(1)
  expect(response.agentInfo).toEqual({ name: AGENT_NAME, version: AGENT_VERSION })
  expect(response.authMethods).toEqual([])
})

test("advertises no unsupported capabilities", async () => {
  const response = await initialize({ protocolVersion: 1 })

  expect(response.agentCapabilities).toEqual({})
})

test("advertises exactly the capabilities the caller threads in", async () => {
  const capabilities = {
    loadSession: true,
    sessionCapabilities: { list: {}, delete: {}, resume: {}, close: {} },
  } satisfies acp.AgentCapabilities
  const response = await initialize({ protocolVersion: 1 }, capabilities)

  expect(response.agentCapabilities).toEqual(capabilities)
})

test("rejects an unsupported protocol version, naming the supported one", async () => {
  const error = await initialize({ protocolVersion: 2 }).catch((failure: unknown) => failure)

  expect(error).toBeInstanceOf(acp.RequestError)
  const requestError = error as acp.RequestError
  expect(requestError.code).toBe(-32602)
  expect(requestError.message).toContain("v1")
  expect(requestError.data).toEqual({ requested: 2, supported: 1 })
})
