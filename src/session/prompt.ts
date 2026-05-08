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
  loadMessages,
  toModelMessages,
} from "./message";
import { buildSystem } from "./system";
import { processStream } from "./processor";
import { estimateTokens } from "./context";
import { autoBranch, shouldBranchWithRealTokens } from "./branch";
import { initializeSession, initializeSessionFromMessage } from "./initializer";
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
import {
  setCurrentTurn,
  preTurnSnapshot,
  toolPreExecute,
  extractFilePath,
} from "../commands/undo";

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

  // Undo: set current turn and proactively snapshot files from the previous turn
  setCurrentTurn(userMsg.id);
  preTurnSnapshot(sessionId, userMsg.id).catch(() => {
    // Pre-turn snapshot is best-effort — never fail the session
  });

  // Enter the loop
  const isSubAgent = !!input.parentSessionId;
  if (isSubAgent) setForceAgent(true);

  const controller = new AbortController();
  active.set(sessionId, controller);
  bus.emit("loop-start", { sessionId });
  let finalSessionId = sessionId;
  try {
    // Initialize title + task in the background.
    const session = getSession(sessionId);
    if (session.kind !== "ephemeral" && (!session.title || !session.taskId)) {
      resolveModel(input.model ?? loadConfig().small_model, "small")
        .then((model) => {
          initializeSession({
            sessionId,
            message: text,
            model,
            profile: agent.id,
          });
        })
        .catch(() => {
          initializeSessionFromMessage({
            sessionId,
            message: text,
            profile: agent.id,
          });
        });
    }

    finalSessionId = await loop(sessionId, controller.signal, agent, input.model);
  } finally {
    if (isSubAgent) setForceAgent(false);
    for (const [id, activeController] of active) {
      if (activeController === controller) active.delete(id);
    }
    bus.emit("loop-end", { sessionId: finalSessionId });
    fireHook("session.idle", { sessionId: finalSessionId }).catch(() => {});
  }

  return { sessionId: finalSessionId };
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
  if (from === to) return
  const controller = active.get(from)
  active.delete(from)
  if (controller) active.set(to, controller)
  process.env.QUARK_SESSION_ID = to
}

async function emitSessionSwitch(sessionId: string, agent: AgentConfig): Promise<void> {
  const { messages, parts } = loadMessages(sessionId)
  const { dbToTuiMessages } = await import("../tui/state")
  const system = buildSystem(agent)
  const modelMessages = toModelMessages(messages, parts)
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  bus.emit("session-switch", {
    sessionId,
    messages: dbToTuiMessages(messages, parts),
    estimatedTokens: estimateTokens(systemStr, modelMessages),
  })
}

// ---------------------------------------------------------------------------
// loop() — the heart of the agent
// ---------------------------------------------------------------------------
async function loop(
  sessionId: string,
  abort: AbortSignal,
  agent: AgentConfig,
  modelOpt?: string,
): Promise<string> {
  // Build the AI SDK model
  // Priority: explicit modelOpt > agent.model > config main_model
  // Model is always in "provider/model" format.
  const modelSpec = modelOpt ?? agent.model ?? loadConfig().main_model
  const parsedModel = parseModelSpec(modelSpec)
  const effectiveModel = parsedModel.model
  const effectiveProvider = parsedModel.provider
  const model = await resolveModel(modelSpec);
  const modelLimit = getModelLimit(modelSpec);

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

    // 3. Check if branching is needed BEFORE the model call
    const cfg = loadConfig();
    if (
      cfg.branching.auto &&
      shouldBranchWithRealTokens(
        system,
        modelMessages,
        modelLimit,
        cfg.branching.threshold,
        parts,
      )
    ) {
      setForceAgent(true);
      try {
        const branchResult = await autoBranch({
          sessionId: currentSessionId,
          messages,
          parts,
          model,
          profile: agent.id,
          abort,
        })
        const previousSessionId = currentSessionId
        currentSessionId = branchResult.sessionId
        moveActiveSession(previousSessionId, currentSessionId)
        await emitSessionSwitch(currentSessionId, agent)

        // Re-load after branching so the model sees the task lineage context.
        continue;
      } catch (err) {
        console.error("[prompt] auto-branch FAILED:", err instanceof Error ? err.stack : String(err));
        bus.emit("error", { sessionId: currentSessionId, error: err });
        fireHook("session.error", {
          sessionId: currentSessionId,
          error: err,
        }).catch(() => {});
        // Continue with full context if branching fails.
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
    if (result === "branch") {
      // Provider returned context-too-long or mid-stream pressure exceeded.
      setForceAgent(true);
      try {
        const { messages: curMsgs, parts: curParts } = loadMessages(currentSessionId);
        const branchResult = await autoBranch({
          sessionId: currentSessionId,
          messages: curMsgs,
          parts: curParts,
          model,
          profile: agent.id,
          abort,
        })
        const previousSessionId = currentSessionId
        currentSessionId = branchResult.sessionId
        moveActiveSession(previousSessionId, currentSessionId)
        await emitSessionSwitch(currentSessionId, agent)

        continue;
      } catch (err) {
        console.error("[prompt] context-too-long branch FAILED:", err instanceof Error ? err.stack : String(err));
        bus.emit("error", { sessionId: currentSessionId, error: err });
        break;
      } finally {
        setForceAgent(false);
      }
    }
    break; // "stop"
  }
  return currentSessionId
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
  const toolIds = [...agent.tools]
  const defs = resolveAvailable(toolIds);
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

      // 2. Validate args against the tool's Zod schema (defense-in-depth)
      const parseResult = def.parameters.safeParse(args)
      if (!parseResult.success) {
        const msg = parseResult.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n")
        return {
          title: `Invalid arguments for ${def.id}`,
          output: `Invalid arguments for tool "${def.id}":\n${msg}`,
          metadata: { error: "invalid_arguments", issues: parseResult.error.issues },
        }
      }
      const validatedArgs = parseResult.data as Record<string, unknown>

      // 3. Undo: lazy snapshot file before write/edit modifies it
      try {
        const fp = extractFilePath(def.id, validatedArgs);
        if (fp) {
          await toolPreExecute(sessionId, fp);
        }
      } catch {
        // Snapshot failure is best-effort — never block tool execution
      }

      // 3. Permission passed — signal TUI to transition awaiting_approval → running
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
        { tool: def.id, args: validatedArgs },
        { args: validatedArgs },
      );
      const toolResult = await Promise.race([
        def.execute(beforeArgs.args as any, ctx),
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
