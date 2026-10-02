import * as acp from "@agentclientprotocol/sdk"

/**
 * ACP implementation identity reported in `initialize.agentInfo`.
 *
 * The `quark acp` host only spawns this agent with a configured local runtime,
 * so the name is fixed and the version tracks the package.
 */
export const AGENT_NAME = "quark"
export const AGENT_VERSION = "0.1.0"

/**
 * Registers the stable ACP v1 `initialize` handler on an agent app.
 *
 * Negotiates protocol version 1: a matching client version is echoed, anything
 * else is rejected with `invalidParams` (data carries both versions) so the
 * client cannot mistake the connection for a negotiated v1 session.
 *
 * Reports the Quark identity and advertises exactly the capabilities the
 * composition root passes in (`agentCapabilities`), which are the ones the
 * registered handlers genuinely back (see ./lifecycle, ./sessions). The
 * baseline (`session/new`, `session/prompt`, `session/cancel`, `session/update`,
 * text and resource-link prompt blocks) needs no flags; stdio MCP is baseline
 * ACP v1 and is implemented (QUA-245), so it needs no `mcpCapabilities` flag
 * either (that only covers http/sse/acp transports, which remain unimplemented).
 * The root opt-in `promptCapabilities.image` because images are mapped to the
 * runner (QUA-245); audio, embedded context and client-side fs/terminal remain
 * unimplemented and are never advertised.
 *
 * `authMethods` is empty: callers resolve the configured local agent/runtime
 * before connecting, so there is no in-band authentication flow to advertise.
 *
 * @returns the app, so registration composes into a fluent builder chain.
 */
export function registerInitialization(
  app: acp.AgentApp,
  agentCapabilities: acp.AgentCapabilities = {},
): acp.AgentApp {
  app.onRequest(acp.methods.agent.initialize, ({ params }) => {
    if (params.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw acp.RequestError.invalidParams(
        { requested: params.protocolVersion, supported: acp.PROTOCOL_VERSION },
        `unsupported ACP protocol version ${params.protocolVersion}; this agent implements v${acp.PROTOCOL_VERSION}`,
      )
    }

    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: AGENT_NAME, version: AGENT_VERSION },
      agentCapabilities,
      authMethods: [],
    }
  })

  return app
}
