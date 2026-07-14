// prompt() entry point + loop() — the core agent loop
//
// Flow:
// 1. prompt() saves the user message, creates/resumes a session, enters loop()
// 2. loop() iterates:
//    a. Load all messages from DB → convert to ModelMessage[]
//    b. Build system prompt
//    c. Resolve tools (ToolDef → AI SDK tool objects)
//    d. Create an assistant message row
//    e. Call processStream() which streams, persists parts, returns outcome
//    f. "continue" → next iteration (tool calls need follow-up)
//    g. "stop" → break

import { createSession, getSession, touchSession } from "./session";
import {
  saveUserMessage,
  createAssistantMessage,
  loadMessages,
  toModelMessages,
} from "./message";
import { buildSystem } from "./system";
import { processStream } from "./processor";
import { createAutoBranch, shouldAutoBranch } from "./branch-controller";
import { emitSessionSwitch } from "./session-switch";
import {
  initializeSessionFromMessage,
  upgradeSessionTitle,
} from "./initializer";
import { resolveToolSet } from "../tool/ai-adapter";
import { buildProviderOptions } from "../provider/thinking";
import { setForceAgent } from "../provider/custom-fetch";
import { resolveModel, resolveModelRuntime } from "../provider/resolver";
import { defaultAgent, type AgentConfig } from "../agent";
import { loadConfig } from "../config/config";

import { bus } from "./events";
import { fireHook } from "../plugin/registry";
import { debug } from "../debug";
import { setCurrentTurn, preTurnSnapshot } from "../commands/undo";

const dlog = debug("loop");

export { resolveModel } from "../provider/resolver";

// ---------------------------------------------------------------------------
// Active sessions — track abort controllers so we can cancel
// ---------------------------------------------------------------------------
const active = new Map<string, AbortController>();

// When the user rejects a permission request, abort the entire agent step
// so the model cannot call another tool.
bus.on("permission-rejected", (data) => {
  cancel(data.sessionId);
});

// ---------------------------------------------------------------------------
// prompt() — public entry point
// ---------------------------------------------------------------------------
/**
 * Run the agent loop for a given user input.
 *
 * Creates a new session if `sessionId` is not provided, saves the user message,
 * then iterates the agent loop until the model returns `stop` or `max_steps` is reached.
 *
 * @param input.sessionId - Resume an existing session (optional)
 * @param input.parentSessionId - Link this session as a sub-agent child (optional)
 * @param input.parts - User message parts (text content)
 * @param input.images - Optional image attachments (`mime` + base64 `data`)
 * @param input.model - Override the provider and model for this call
 * @param input.agent - Override the agent config (defaults to {@link defaultAgent})
 * @returns The session ID that was used (new or resumed)
 *
 * @example
 * ```ts
 * const { sessionId } = await prompt({
 *   parts: [{ type: 'text', text: 'Refactor src/index.ts to use async/await' }],
 * })
 * ```
 */
export async function prompt(input: {
  sessionId?: string;
  parentSessionId?: string;
  ephemeral?: boolean;
  parts: { type: "text"; text: string }[];
  images?: { mime: string; data: string }[];
  model?: string;
  agent?: AgentConfig;
}) {
  const agent = input.agent ?? defaultAgent;

  // Resolve or create session (lazy — only created on first message)
  let sessionId: string;
  if (input.sessionId) {
    getSession(input.sessionId); // throws if missing
    sessionId = input.sessionId;
  } else {
    const sess = createSession(
      input.ephemeral
        ? { ephemeral: true }
        : input.parentSessionId
          ? { parentSessionId: input.parentSessionId, kind: "subagent" }
          : undefined,
    );
    sessionId = sess.id;
    bus.emit("session-created", { sessionId });
    fireHook("session.created", { sessionId }).catch(() => {});
  }

  // Save user message (concatenate all text parts)
  const text = input.parts.map((p) => p.text).join("\n");
  const userMsg = saveUserMessage({ sessionId, text, images: input.images });
  bus.emit("user-message", { sessionId, messageId: userMsg.id, text });

  return runTurn({
    sessionId,
    userMessageId: userMsg.id,
    userText: text,
    model: input.model,
    agent,
    forceAgent: !!input.parentSessionId,
  });
}

/**
 * Run a turn whose user message has already been persisted. Used by /steer so
 * the child branch responds to its saved steer prompt without duplicating it.
 */
export async function runSeededSession(input: {
  sessionId: string
  userMessageId: string
  userText: string
  model?: string
  agent?: AgentConfig
}) {
  getSession(input.sessionId)
  return runTurn({
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    userText: input.userText,
    model: input.model,
    agent: input.agent ?? defaultAgent,
  })
}

async function runTurn(input: {
  sessionId: string
  userMessageId: string
  userText: string
  model?: string
  agent: AgentConfig
  forceAgent?: boolean
}) {
  const { sessionId, userMessageId, userText, model, agent } = input
  process.env.QUARK_SESSION_ID = sessionId
  touchSession(sessionId)

  // Undo: use the existing message as the turn boundary and snapshot files.
  setCurrentTurn(sessionId, userMessageId)
  preTurnSnapshot(sessionId, userMessageId).catch(() => {})

  if (input.forceAgent) setForceAgent(true)
  const controller = new AbortController()
  active.set(sessionId, controller)
  bus.emit("loop-start", { sessionId })
  let finalSessionId = sessionId
  try {
    // Child branches inherit a task. This remains for normal new sessions.
    const session = getSession(sessionId)
    if (session.kind !== "ephemeral" && !session.taskId) {
      initializeSessionFromMessage({ sessionId, message: userText, profile: agent.id })
      resolveModel(model ?? loadConfig().small_model, "small")
        .then((smallModel) => upgradeSessionTitle({ sessionId, message: userText, model: smallModel }))
        .catch(() => {})
    }

    finalSessionId = await loop(sessionId, userMessageId, controller.signal, agent, model)
  } finally {
    if (controller.signal.aborted) {
      bus.emit("user-message-status", { sessionId: finalSessionId, messageId: userMessageId, status: "aborted" })
    }
    if (input.forceAgent) setForceAgent(false)
    for (const [id, activeController] of active) {
      if (activeController === controller) active.delete(id)
    }
    bus.emit("loop-end", { sessionId: finalSessionId })
    fireHook("session.idle", { sessionId: finalSessionId }).catch(() => {})
  }

  return { sessionId: finalSessionId }
}

/**
 * Cancel a running agent loop for the given session.
 *
 * Triggers the `AbortController` associated with the session, which propagates
 * through the LLM stream and all active tool calls. Safe to call on sessions
 * that are not currently running (no-op).
 *
 * @param sessionId - The session to cancel
 */
export function cancel(sessionId: string) {
  const controller = active.get(sessionId);
  if (controller) {
    controller.abort();
    active.delete(sessionId);
  }
}

/**
 * Check if a session is currently running.
 *
 * @param sessionId - The session to check
 * @returns `true` if the session has an active abort controller (i.e., prompt() is running)
 */
export function isActive(sessionId: string): boolean {
  return active.has(sessionId);
}

function moveActiveSession(from: string, to: string): void {
  if (from === to) return;
  const controller = active.get(from);
  active.delete(from);
  if (controller) active.set(to, controller);
  process.env.QUARK_SESSION_ID = to;
}

// ---------------------------------------------------------------------------
// loop() — the heart of the agent
// ---------------------------------------------------------------------------
async function loop(
  sessionId: string,
  userMessageId: string,
  abort: AbortSignal,
  agent: AgentConfig,
  modelOpt?: string,
): Promise<string> {
  // Build the AI SDK model
  // Priority: explicit modelOpt > agent model
  // Model is always in "provider/model" format.
  const agentModelSpec = agent.model;
  const modelSpec = modelOpt ?? agentModelSpec;
  const usingAgentModel = modelOpt === undefined || modelOpt === agentModelSpec;
  const resolvedModel = await resolveModelRuntime(modelSpec);
  const effectiveModel = resolvedModel.ref.modelId;
  const effectiveProvider = resolvedModel.ref.providerId;
  const model = resolvedModel.languageModel;
  const modelLimit = resolvedModel.descriptor.limits;

  // mutable — may change when branching steers to a different session
  let currentSessionId = sessionId;

  let step = 0;
  while (true) {
    if (abort.aborted) break;
    step++;

    dlog(`--- iteration ${step} starting (sessionId=${currentSessionId}) ---`);

    // Safety: prevent runaway loops
    if (step > loadConfig().max_steps) {
      dlog(`max_steps reached (${loadConfig().max_steps}), breaking`);
      break;
    }

    // Plugin hook: loop step beginning
    await fireHook("loop.step.before", { sessionId: currentSessionId, step });

    // 1. Load conversation history
    const { messages, parts } = loadMessages(currentSessionId);
    const modelMessages = toModelMessages(messages, parts);

    if (dlog.enabled) {
      dlog(
        `loaded ${messages.length} messages, ${parts.length} parts → ${modelMessages.length} model messages`,
      );
      const roles = modelMessages.map((m) => {
        const c = m.content;
        if (typeof c === "string") return `${m.role}(text:${c.length})`;
        if (Array.isArray(c)) {
          const types = c.map((p: any) => p.type).join(",");
          return `${m.role}(${types})`;
        }
        return m.role;
      });
      dlog("messages roles:", roles.join(" | "));
    }

    // 2. Build system prompt
    const system = buildSystem(agent);

    // 3. Check if branching is needed BEFORE the model call
    if (
      shouldAutoBranch({
        system,
        modelMessages,
        modelLimit,
        parts,
      })
    ) {
      try {
        const branchResult = await createAutoBranch({
          sessionId: currentSessionId,
          messages,
          parts,
          model,
          profile: agent.id,
          abort,
        });
        const previousSessionId = currentSessionId;
        currentSessionId = branchResult.sessionId;
        moveActiveSession(previousSessionId, currentSessionId);
        await emitSessionSwitch(currentSessionId, agent, { kind: "branch", goal: "continue" });

        // Re-load after branching so the model sees the task lineage context.
        continue;
      } catch (err) {
        console.error(
          "[prompt] auto-branch FAILED:",
          err instanceof Error ? err.stack : String(err),
        );
        bus.emit("error", { sessionId: currentSessionId, error: err, userMessageId });
        fireHook("session.error", {
          sessionId: currentSessionId,
          error: err,
        }).catch(() => {});
        // Continue with full context if branching fails.
      }
    }

    // 4. Create assistant message row
    const assistantMsg = createAssistantMessage({
      sessionId: currentSessionId,
      modelId: resolvedModel.ref.spec,
      providerId: resolvedModel.ref.providerId,
    });
    bus.emit("assistant-message-start", {
      sessionId: currentSessionId,
      messageId: assistantMsg.id,
    });

    // 5. Resolve tools with correct context for this iteration
    const tools = resolveToolSet(
      agent,
      currentSessionId,
      assistantMsg.id,
      abort,
    );

    // 6. Stream + process
    const providerId = effectiveProvider;
    const thinkingProviderOptions = buildProviderOptions({
      providerOptionsKey: resolvedModel.providerOptionsKey,
      modelId: effectiveModel,
      modelCapability: resolvedModel.descriptor.capabilities.reasoning,
      thinkingConfig: {
        effort: usingAgentModel ? agent.thinkingEffort ?? "none" : "none",
        mode: usingAgentModel ? agent.thinkingMode ?? "standard" : "standard",
        modeExplicit: usingAgentModel && agent.thinkingMode !== undefined,
      },
    });
    const result = await processStream({
      model,
      resolvedModel,
      system,
      messages: modelMessages,
      tools,
      abort,
      msg: assistantMsg,
      sessionId: currentSessionId,
      userMessageId,
      providerId: resolvedModel.ref.providerId,
      modelId: resolvedModel.ref.modelId,
      rebuildModel: async (provider, modelId) => {
        const rebuilt = await resolveModelRuntime(`${provider}/${modelId}`)
        return {
          resolvedModel: rebuilt,
          providerOptions: buildProviderOptions({
            providerOptionsKey: rebuilt.providerOptionsKey,
            modelId: rebuilt.ref.modelId,
            modelCapability: rebuilt.descriptor.capabilities.reasoning,
            thinkingConfig: { effort: "none", mode: "standard", modeExplicit: false },
          }),
        }
      },
      ...(thinkingProviderOptions
        ? { providerOptions: thinkingProviderOptions }
        : {}),
    });

    dlog(`processStream returned: ${result}`);

    // Plugin hook: loop step ending
    await fireHook("loop.step.after", {
      sessionId: currentSessionId,
      step,
      result,
    });

    // 7. Decide next action
    if (result === "continue") continue;
    if (result === "branch") {
      // Provider returned context-too-long or mid-stream pressure exceeded.
      try {
        const { messages: curMsgs, parts: curParts } =
          loadMessages(currentSessionId);
        const branchResult = await createAutoBranch({
          sessionId: currentSessionId,
          messages: curMsgs,
          parts: curParts,
          model,
          profile: agent.id,
          abort,
        });
        const previousSessionId = currentSessionId;
        currentSessionId = branchResult.sessionId;
        moveActiveSession(previousSessionId, currentSessionId);
        await emitSessionSwitch(currentSessionId, agent, { kind: "branch", goal: "Auto-branched (context full)" });

        continue;
      } catch (err) {
        console.error(
          "[prompt] context-too-long branch FAILED:",
          err instanceof Error ? err.stack : String(err),
        );
        bus.emit("error", { sessionId: currentSessionId, error: err, userMessageId });
        break;
      }
    }
    break; // "stop"
  }
  return currentSessionId;
}
