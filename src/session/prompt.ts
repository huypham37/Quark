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

import { tool, jsonSchema, type ToolSet, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { createSession, getSession, touchSession } from "./session";
import {
  saveUserMessage,
  createAssistantMessage,
  addPart,
  finishMessage,
  loadMessages,
  toModelMessages,
} from "./message";
import { buildSystem } from "./system";
import { processStream } from "./processor";
import { shouldCompact, estimateTokens, shouldCompactWithRealTokens } from "./compaction";
import {
  resolve as resolveCompaction,
  takePending,
  type CompactMethodContext,
} from "./compact-resolver";
import { generateSessionTitle } from "./title";
import { list as listTools, resolve as resolveTools, resolveAvailable } from "../tool/registry";
import { getThinkingNormalizer } from "../provider/thinking";
import { setForceAgent, getCustomFetch } from "../provider/custom-fetch";
import { loadToken } from "../provider/copilot-auth";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getModelLimit } from "../provider/models";
import { defaultAgent, type AgentConfig } from "../agent";
import {
  getProviderConfig,
  resolveApiKey,
  loadConfig,
  parseModelSpec,
} from "../config/config";
import type { ToolDef, ToolResult } from "../tool/tool";
import {
  ask as askPermission,
  evaluate as evaluatePermission,
  type Ruleset,
  DeniedError,
  RejectedError,
  CorrectedError,
} from "../permission/permission";

import { bus } from "./events";
import { fireHook } from "../plugin/registry";
import { debug } from "../debug";

const dlog = debug("loop");

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

  // Set QUARK_SESSION_ID so child processes (bash tool) can inherit it
  process.env.QUARK_SESSION_ID = sessionId;

  touchSession(sessionId);

  // Save user message (concatenate all text parts)
  const text = input.parts.map((p) => p.text).join("\n");
  const userMsg = saveUserMessage({ sessionId, text, images: input.images });
  bus.emit("user-message", { sessionId, messageId: userMsg.id, text });

  // Enter the loop
  const isSubAgent = !!input.parentSessionId;
  if (isSubAgent) setForceAgent(true);

  const controller = new AbortController();
  active.set(sessionId, controller);
  bus.emit("loop-start", { sessionId });
  try {
    // Generate a title in the background if session is untitled
    // Uses the small_model from config — cheap and fast
    const session = getSession(sessionId);
    if (!session.title) {
      resolveModel(input.model ?? loadConfig().small_model, "small")
        .then((model) => {
          generateSessionTitle({ sessionId, message: text, model });
        })
        .catch(() => {
          // Title generation is best-effort — never fail the session
        });
    }

    await loop(sessionId, controller.signal, agent, input.model);
  } finally {
    if (isSubAgent) setForceAgent(false);
    active.delete(sessionId);
    bus.emit("loop-end", { sessionId });
    fireHook("session.idle", { sessionId }).catch(() => {});
  }

  return { sessionId };
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

// ---------------------------------------------------------------------------
// loop() — the heart of the agent
// ---------------------------------------------------------------------------
async function loop(
  sessionId: string,
  abort: AbortSignal,
  agent: AgentConfig,
  modelOpt?: string,
) {
  // Build the AI SDK model
  // Priority: explicit modelOpt > agent.model > config main_model
  // Model is always in "provider/model" format.
  const modelSpec = modelOpt ?? agent.model ?? loadConfig().main_model
  const parsedModel = parseModelSpec(modelSpec)
  const effectiveModel = parsedModel.model
  const effectiveProvider = parsedModel.provider
  const model = await resolveModel(modelSpec);
  const modelLimit = getModelLimit(modelSpec);

  // mutable — may change when compaction creates a new session
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

    // 0. Run pending compaction (queued from previous iteration or tool call)
    const pendingReq = takePending(currentSessionId);
    if (pendingReq) {
      console.log("[prompt] running pending compaction for session:", currentSessionId);
      bus.emit("compaction-start", { sessionId: currentSessionId });
      setForceAgent(true);
      try {
        const result = await resolveCompaction({
          trigger: pendingReq.trigger,
          ctx: pendingReq.ctx,
          methodId: pendingReq.methodId,
        });
        console.log("[prompt] pending compaction result:", JSON.stringify(result));
        bus.emit("compaction-end", { sessionId: currentSessionId, result });
        if (result.type === "new-session") {
          currentSessionId = result.newSessionId;
          const { messages: newMsgs, parts: newParts } =
            loadMessages(currentSessionId);
          const { dbToTuiMessages } = await import("../tui/state");
          const sys = buildSystem(agent);
          const newModelMsgs = toModelMessages(newMsgs, newParts);
          const sysStr = Array.isArray(sys) ? sys.join("\n") : sys;
          bus.emit("session-switch", {
            sessionId: currentSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens: estimateTokens(sysStr, newModelMsgs),
          });
        }
      } catch (err) {
        console.error("[prompt] pending compaction FAILED:", err instanceof Error ? err.stack : String(err));
        bus.emit("compaction-end", {
          sessionId: currentSessionId,
          result: null,
        });
        bus.emit("error", { sessionId: currentSessionId, error: err });
        fireHook("session.error", {
          sessionId: currentSessionId,
          error: err,
        }).catch(() => {});
      } finally {
        setForceAgent(false);
      }
    }

    // 1. Load conversation history
    const { messages, parts } = loadMessages(currentSessionId);
    const modelMessages = toModelMessages(messages, parts);

    if (dlog.enabled) {
      dlog(`loaded ${messages.length} messages, ${parts.length} parts → ${modelMessages.length} model messages`);
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

    // 3. Check if compaction is needed BEFORE the model call
    const cfg = loadConfig();
    if (
      cfg.compact.auto &&
      shouldCompactWithRealTokens(
        system,
        modelMessages,
        modelLimit,
        cfg.compact.threshold,
        parts,
      )
    ) {
      bus.emit("compaction-start", { sessionId: currentSessionId });
      setForceAgent(true);
      try {
        // Fire session.compacting hook — plugins can inject extra context
        const compactingOutput = await fireHook("session.compacting", {
          sessionId: currentSessionId,
        });
        const compactCtx: CompactMethodContext = {
          sessionId: currentSessionId,
          messages,
          parts,
          modelMessages,
          model,
          agentPrompt: system,
          budget: modelLimit,
          persist: {
            createMessage: createAssistantMessage,
            addPart,
            finishMessage,
            saveUserMessage,
          },
          session: { create: createSession },
          extraContext: compactingOutput.context,
        };
        const compactResult = await resolveCompaction({
          trigger: "auto",
          ctx: compactCtx,
        });
        bus.emit("compaction-end", {
          sessionId: currentSessionId,
          result: compactResult,
        });

        if (compactResult.type === "new-session") {
          currentSessionId = compactResult.newSessionId;
          // Load the new session's messages for the TUI
          const { messages: newMsgs, parts: newParts } =
            loadMessages(currentSessionId);
          const { dbToTuiMessages } = await import("../tui/state");
          const systemStr = Array.isArray(system) ? system.join("\n") : system;
          const newModelMessages = toModelMessages(newMsgs, newParts);
          const estimatedTokens = estimateTokens(systemStr, newModelMessages);
          bus.emit("session-switch", {
            sessionId: currentSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens,
          });
        }

        // Re-load after compaction so the model sees the compacted context
        continue;
      } catch (err) {
        console.error("[prompt] auto-compaction FAILED:", err instanceof Error ? err.stack : String(err));
        bus.emit("compaction-end", {
          sessionId: currentSessionId,
          result: null,
        });
        bus.emit("error", { sessionId: currentSessionId, error: err });
        fireHook("session.error", {
          sessionId: currentSessionId,
          error: err,
        }).catch(() => {});
        // Continue with full context if compaction fails
      } finally {
        setForceAgent(false);
      }
    }

    // 4. Create assistant message row
    const assistantMsg = createAssistantMessage({
      sessionId: currentSessionId,
      modelId: modelSpec,
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
    const thinkingProviderOptions = getThinkingNormalizer(effectiveModel).normalize(providerId ?? "");
    const result = await processStream({
      model,
      system,
      messages: modelMessages,
      tools,
      abort,
      msg: assistantMsg,
      sessionId: currentSessionId,
      modelId: modelSpec,
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
    if (result === "compact") {
      // Provider returned context-too-long — force compaction and retry
      bus.emit("compaction-start", { sessionId: currentSessionId });
      setForceAgent(true);
      try {
        const { messages: curMsgs, parts: curParts } = loadMessages(currentSessionId);
        const curModelMessages = toModelMessages(curMsgs, curParts);
        const compactingOutput = await fireHook("session.compacting", {
          sessionId: currentSessionId,
        });
        const compactCtx: CompactMethodContext = {
          sessionId: currentSessionId,
          messages: curMsgs,
          parts: curParts,
          modelMessages: curModelMessages,
          model,
          agentPrompt: system,
          budget: modelLimit,
          persist: {
            createMessage: createAssistantMessage,
            addPart,
            finishMessage,
            saveUserMessage,
          },
          session: { create: createSession },
          extraContext: compactingOutput.context,
        };
        const compactResult = await resolveCompaction({
          trigger: "auto",
          ctx: compactCtx,
        });
        bus.emit("compaction-end", {
          sessionId: currentSessionId,
          result: compactResult,
        });

        if (compactResult.type === "new-session") {
          currentSessionId = compactResult.newSessionId;
          const { messages: newMsgs, parts: newParts } =
            loadMessages(currentSessionId);
          const { dbToTuiMessages } = await import("../tui/state");
          const systemStr = Array.isArray(system) ? system.join("\n") : system;
          const newModelMessages = toModelMessages(newMsgs, newParts);
          const estTokens = estimateTokens(systemStr, newModelMessages);
          bus.emit("session-switch", {
            sessionId: currentSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens: estTokens,
          });
        }

        continue;
      } catch (err) {
        console.error("[prompt] context-too-long compaction FAILED:", err instanceof Error ? err.stack : String(err));
        bus.emit("compaction-end", {
          sessionId: currentSessionId,
          result: null,
        });
        bus.emit("error", { sessionId: currentSessionId, error: err });
        break;
      } finally {
        setForceAgent(false);
      }
    }
    break; // "stop"
  }
}

// ---------------------------------------------------------------------------
// resolveModel — get the AI SDK LanguageModel
//
// kind: "main" (default) uses main_model from config
//        "small" uses small_model (for lightweight tasks like title generation)
//
// modelSpec is always in "provider/model" format (e.g. "copilot/gpt-5-mini").
// Falls back to config main_model or small_model if not provided.
// ---------------------------------------------------------------------------
export async function resolveModel(
  modelSpec?: string,
  kind: "main" | "small" = "main",
) {
  const cfg = loadConfig()
  const spec = modelSpec ?? (kind === "main" ? cfg.main_model : cfg.small_model)
  const parsed = parseModelSpec(spec)

  let providerId = parsed.provider
  let modelId = parsed.model

  if (!providerId) {
    throw new Error(
      `Model spec "${spec}" must include a provider prefix (e.g. "copilot/gpt-4o").`,
    )
  }

  // Plugin hook: allow plugins to intercept/modify provider+model before creating the AI SDK object
  const beforeOutput = await fireHook(
    "provider.request.before",
    {
      provider: providerId,
      model: modelId,
      messages: [],
    },
    { provider: providerId, model: modelId },
  );
  providerId = beforeOutput.provider;
  modelId = beforeOutput.model;

  // Branch 1: Copilot — OAuth auth, not config.yaml
  if (providerId === "copilot") {
    const getToken = async () => {
      const token = loadToken();
      if (!token) {
        throw new Error(
          "No Copilot token found. Run the login flow first (scripts/copilot-login.ts).",
        );
      }
      return token;
    };
    const fetch = getCustomFetch("copilot", { getToken });
    return createOpenAICompatible({
      name: "copilot",
      baseURL: "https://api.githubcopilot.com",
      apiKey: "copilot",
      fetch,
    })(modelId);
  }

  // Branch 2: User-configured providers from ~/.config/quark/config.yaml
  const pc = getProviderConfig(providerId);
  if (!pc) {
    throw new Error(
      `Unknown provider "${providerId}". Define it in ~/.config/quark/config.yaml under "providers:".`,
    );
  }

  // Native SDK providers
  if (providerId === "openai") {
    return createOpenAI({ apiKey: resolveApiKey(pc.apiKey), baseURL: pc.baseURL })(modelId);
  }
  if (providerId === "anthropic") {
    return createAnthropic({ apiKey: resolveApiKey(pc.apiKey), baseURL: pc.baseURL })(modelId);
  }

  // Branch 3: OpenAI-compatible (DeepSeek, Kimi, OpenRouter, OpenCode Go, …)
  const customFetch = getCustomFetch(providerId);
  return createOpenAICompatible({
    name: providerId,
    baseURL: pc.baseURL,
    apiKey: resolveApiKey(pc.apiKey),
    fetch: customFetch,
  })(modelId);
}

// ---------------------------------------------------------------------------
// resolveToolSet — convert our ToolDef[] to AI SDK ToolSet
// ---------------------------------------------------------------------------
function resolveToolSet(
  agent: AgentConfig,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
): ToolSet {
  const defs = resolveAvailable(agent.tools);
  const ruleset: Ruleset = (agent.permissions ?? []).map(r => ({
    tool: r.tool,
    pattern: "*",
    action: r.action,
  }));
  const result: ToolSet = {};

  for (const def of defs) {
    result[def.id] = toAITool(def, sessionId, messageId, abort, ruleset);
  }

  return result;
}

// ---------------------------------------------------------------------------
// abortSignalToPromise — convert an AbortSignal to a rejecting promise
// ---------------------------------------------------------------------------

function abortSignalToPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    );
  }
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
        );
      },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// toAITool — convert a single ToolDef to an AI SDK tool()
// ---------------------------------------------------------------------------
function toAITool(
  def: ToolDef,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
  ruleset: Ruleset,
) {
  const schema = z.toJSONSchema(def.parameters);

  return tool({
    description: def.description,
    inputSchema: jsonSchema(schema as any),
    async execute(args: any, options: ToolExecutionOptions) {
      const callId = options.toolCallId;
      const abortSig = options.abortSignal ?? abort;

      // 1. Permission gate BEFORE any tool execution
      //    - "allow" → returns immediately
      //    - "deny"  → throws DeniedError
      //    - "ask"   → blocks on TUI permission prompt, uses respond() + once/always/reject
      try {
        await askPermission({
          sessionId,
          tool: def.id,
          pattern: "*",
          ruleset,
        });
      } catch (e) {
        if (e instanceof RejectedError || e instanceof CorrectedError) {
          // User rejected — abort the entire agent step so the model
          // cannot call another tool
          bus.emit("permission-rejected", { sessionId });
        }
        throw e;
      }

      // 2. Permission passed — signal TUI to transition awaiting_approval → running
      bus.emit("tool-running", { sessionId, messageId, callId });

      // 3. Build execution context for the tool
      const ctx = {
        sessionId,
        messageId,
        callId,
        abort: abortSig,
        // TODO: later support argument-level permission via ctx.ask()
        async ask(tool: string, pattern: string) {
          await askPermission({
            sessionId,
            tool,
            pattern,
            ruleset,
          });
        },
      };

      // 4. Plugin hooks: before/after tool execution
      const beforeArgs = await fireHook(
        "tool.execute.before",
        { tool: def.id, args },
        { args },
      );
      const toolResult = await Promise.race([
        def.execute(beforeArgs.args as typeof args, ctx),
        abortSignalToPromise(abortSig),
      ]);
      await fireHook("tool.execute.after", {
        tool: def.id,
        args: beforeArgs.args,
        result: (toolResult as any).output ?? "",
      });
      return toolResult;
    },
    toModelOutput(result: any) {
      if (Array.isArray(result.output)) {
        // Multi-modal content parts (text + images)
        return {
          type: "content" as const,
          value: result.output,
        };
      }
      return {
        type: "text" as const,
        value: result.output as string,
      };
    },
  });
}
