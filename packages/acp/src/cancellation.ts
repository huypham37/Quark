// ACP `session/cancel` notification handler (QUA-250).
//
// The client asks an in-flight turn to stop by sending `session/cancel`. This
// module only registers that notification and forwards the session ID to the
// session bridge; the cancellation machinery lives in `sessions.ts`
// (`SessionBridge.cancel` aborts the runner, `prompt` maps the outcome to the
// `cancelled` stop reason). Keeping the transport wiring here means sessions.ts
// stays free of protocol concerns.
//
// Ordering — ACP requires any late `session/update` notifications to be sent
// before the `cancelled` `session/prompt` response. This module never writes to
// the client itself: `sessions.prompt` awaits `runner.prompt`, and the runner
// emits its final aborted bus events synchronously before that promise settles
// (processor / runTurn `finally`). A bridge (QUA-244) that maps those events to
// `client.notify(...)` therefore enqueues them ahead of the response.
//
// Permissions — QUA-249's permission bridge is not implemented yet, so no
// `session/request_permission` can be pending; there is nothing to resolve with
// the `cancelled` outcome today. When that bridge lands, cancel must reject any
// pending permission request for the turn as well as aborting the runner.

import { methods } from "@agentclientprotocol/sdk"
import type { AgentApp } from "@agentclientprotocol/sdk"
import type { SessionBridge } from "./sessions"

/**
 * Install the `session/cancel` notification handler on `app`, forwarding the
 * session ID to `sessions.cancel` (a no-op for idle/unknown sessions).
 */
export function registerCancellation(app: AgentApp, sessions: SessionBridge): AgentApp {
  app.onNotification(methods.agent.session.cancel, ({ params }) => {
    sessions.cancel({ sessionId: params.sessionId })
  })
  return app
}
