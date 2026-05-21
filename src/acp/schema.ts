// ACP Zod schemas — type definitions for the Agent Client Protocol
//
// Reference: agentclientprotocol.com, canonical schema at
// https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json

import { z } from "zod"

// ─── Protocol Version ─────────────────────────────────────────────────────────

export const ProtocolVersion = z.number().int().min(0).max(65535)

// ─── JSON-RPC 2.0 Envelope ────────────────────────────────────────────────────

export const RequestId = z.union([z.string(), z.number().int()])

export const ErrorCode = z.number().int()

export const JsonRpcError = z.object({
  code: ErrorCode,
  message: z.string(),
  data: z.unknown().optional(),
})

// Standard JSON-RPC error codes
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  AuthRequired: -32000,
  ResourceNotFound: -32002,
} as const

// ─── Implementation Info ──────────────────────────────────────────────────────

export const Implementation = z.object({
  name: z.string(),
  title: z.string().nullable().optional(),
  version: z.string(),
})

// ─── Capabilities ─────────────────────────────────────────────────────────────

export const PromptCapabilities = z.object({
  image: z.boolean().default(false),
  audio: z.boolean().default(false),
  embeddedContext: z.boolean().default(false),
})

export const McpCapabilities = z.object({
  http: z.boolean().default(false),
  sse: z.boolean().default(false),
})

export const FileSystemCapabilities = z.object({
  readTextFile: z.boolean().default(false),
  writeTextFile: z.boolean().default(false),
})

export const ClientCapabilities = z.object({
  fs: FileSystemCapabilities.optional(),
  terminal: z.boolean().default(false),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const SessionCapabilities = z.object({
  resume: z.record(z.string(), z.unknown()).optional(),
  close: z.record(z.string(), z.unknown()).optional(),
  list: z.record(z.string(), z.unknown()).optional(),
})

export const AgentCapabilities = z.object({
  loadSession: z.boolean().default(false),
  promptCapabilities: PromptCapabilities.optional(),
  mcpCapabilities: McpCapabilities.optional(),
  sessionCapabilities: SessionCapabilities.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const AuthMethod = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: z.string().optional(),
})

// ─── Content Blocks ───────────────────────────────────────────────────────────

export const Annotations = z.object({
  audience: z.array(z.string()).nullable().optional(),
  priority: z.number().nullable().optional(),
  lastModified: z.string().nullable().optional(),
})

export const TextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
  annotations: Annotations.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const ImageContent = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
  uri: z.string().nullable().optional(),
  annotations: Annotations.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const AudioContent = z.object({
  type: z.literal("audio"),
  data: z.string(),
  mimeType: z.string(),
  annotations: Annotations.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const TextResourceContents = z.object({
  uri: z.string(),
  mimeType: z.string().nullable().optional(),
  text: z.string(),
})

export const BlobResourceContents = z.object({
  uri: z.string(),
  mimeType: z.string().nullable().optional(),
  blob: z.string(),
})

export const EmbeddedResourceResource = z.union([TextResourceContents, BlobResourceContents])

export const EmbeddedResource = z.object({
  type: z.literal("resource"),
  resource: EmbeddedResourceResource,
  annotations: Annotations.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const ResourceLink = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  size: z.number().int().optional(),
  annotations: Annotations.optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const ContentBlock = z.union([
  TextContent,
  ImageContent,
  AudioContent,
  EmbeddedResource,
  ResourceLink,
])

// ─── MCP Server Config ────────────────────────────────────────────────────────

export const EnvVariable = z.object({
  name: z.string(),
  value: z.string(),
})

export const HttpHeader = z.object({
  name: z.string(),
  value: z.string(),
})

export const McpServerStdio = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.array(EnvVariable).default([]),
})

export const McpServerHttp = z.object({
  name: z.string(),
  type: z.literal("http"),
  url: z.string(),
  headers: z.array(HttpHeader).default([]),
})

export const McpServerSse = z.object({
  name: z.string(),
  type: z.literal("sse"),
  url: z.string(),
  headers: z.array(HttpHeader).default([]),
})

export const McpServer = z.union([McpServerStdio, McpServerHttp, McpServerSse])

// ─── Session ──────────────────────────────────────────────────────────────────

export const SessionId = z.string()

export const SessionModeId = z.string()

export const SessionConfigOption = z.object({
  name: z.string(),
  value: z.unknown(),
})

export const AvailableMode = z.object({
  id: SessionModeId,
  name: z.string(),
  description: z.string().optional(),
})

export const SessionModeState = z.object({
  currentModeId: SessionModeId,
  availableModes: z.array(AvailableMode),
})

// ─── Stop Reason ──────────────────────────────────────────────────────────────

export const StopReason = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
])

// ─── Tool Calls ───────────────────────────────────────────────────────────────

export const ToolKind = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
])

export const ToolCallStatus = z.enum(["pending", "in_progress", "completed", "failed"])

export const ToolCallLocation = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
})

export const DiffContent = z.object({
  type: z.literal("diff"),
  path: z.string(),
  oldText: z.string().nullable().optional(),
  newText: z.string(),
})

export const TerminalContent = z.object({
  type: z.literal("terminal"),
  terminalId: z.string(),
})

export const ToolCallContent = z.union([ContentBlock, DiffContent, TerminalContent])

export const ToolCall = z.object({
  toolCallId: z.string(),
  title: z.string(),
  kind: ToolKind.default("other"),
  status: ToolCallStatus.default("pending"),
  content: z.array(ToolCallContent).optional(),
  locations: z.array(ToolCallLocation).optional(),
  rawInput: z.record(z.string(), z.unknown()).optional(),
  rawOutput: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

// ─── Plans ─────────────────────────────────────────────────────────────────────

export const PlanEntryPriority = z.enum(["high", "medium", "low"])
export const PlanEntryStatus = z.enum(["pending", "in_progress", "completed"])

export const PlanEntry = z.object({
  content: z.string(),
  priority: PlanEntryPriority,
  status: PlanEntryStatus,
})

export const Plan = z.object({
  entries: z.array(PlanEntry),
})

// ─── Permission ───────────────────────────────────────────────────────────────

export const PermissionOptionKind = z.enum(["allow_once", "allow_always", "reject_once", "reject_always"])

export const PermissionOption = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: PermissionOptionKind,
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const RequestPermissionOutcome = z.union([
  z.object({ outcome: z.literal("selected"), optionId: z.string() }),
  z.object({ outcome: z.literal("cancelled") }),
])

// ─── Available Commands (slash commands) ──────────────────────────────────────

export const AvailableCommandInput = z.object({
  type: z.literal("unstructured").optional(),
  hint: z.string().optional(),
})

export const AvailableCommand = z.object({
  name: z.string(),
  description: z.string(),
  input: AvailableCommandInput.nullable().optional(),
})

// ─── Session Update Notifications ─────────────────────────────────────────────

export const UserMessageChunk = z.object({
  sessionUpdate: z.literal("user_message_chunk"),
  content: ContentBlock,
})

export const AgentMessageChunk = z.object({
  sessionUpdate: z.literal("agent_message_chunk"),
  content: ContentBlock,
})

export const AgentThoughtChunk = z.object({
  sessionUpdate: z.literal("agent_thought_chunk"),
  content: ContentBlock,
})

export const ToolCallNotification = ToolCall.extend({
  sessionUpdate: z.literal("tool_call"),
})

export const ToolCallUpdateNotification = z.object({
  sessionUpdate: z.literal("tool_call_update"),
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: ToolKind.optional(),
  status: ToolCallStatus.optional(),
  content: z.array(ToolCallContent).optional(),
  locations: z.array(ToolCallLocation).optional(),
  rawInput: z.record(z.string(), z.unknown()).optional(),
  rawOutput: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const PlanNotification = z.object({
  sessionUpdate: z.literal("plan"),
  entries: z.array(PlanEntry),
})

export const AvailableCommandsUpdate = z.object({
  sessionUpdate: z.literal("available_commands_update"),
  availableCommands: z.array(AvailableCommand),
})

export const CurrentModeUpdate = z.object({
  sessionUpdate: z.literal("current_mode_update"),
  modeId: SessionModeId,
})

export const ConfigOptionUpdate = z.object({
  sessionUpdate: z.literal("config_option_update"),
  configOptions: z.array(SessionConfigOption),
})

export const SessionInfoUpdate = z.object({
  sessionUpdate: z.literal("session_info_update"),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const SessionUpdate = z.union([
  UserMessageChunk,
  AgentMessageChunk,
  AgentThoughtChunk,
  ToolCallNotification,
  ToolCallUpdateNotification,
  PlanNotification,
  AvailableCommandsUpdate,
  CurrentModeUpdate,
  ConfigOptionUpdate,
  SessionInfoUpdate,
])

// ─── Agent Methods (Client → Agent) ───────────────────────────────────────────

export const InitializeRequest = z.object({
  method: z.literal("initialize"),
  params: z.object({
    protocolVersion: ProtocolVersion,
    clientCapabilities: ClientCapabilities.optional(),
    clientInfo: Implementation.nullable().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const InitializeResponse = z.object({
  protocolVersion: ProtocolVersion,
  agentCapabilities: AgentCapabilities,
  agentInfo: Implementation.nullable().optional(),
  authMethods: z.array(AuthMethod).default([]),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const NewSessionRequest = z.object({
  method: z.literal("session/new"),
  params: z.object({
    cwd: z.string(),
    mcpServers: z.array(McpServer).default([]),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const NewSessionResponse = z.object({
  sessionId: SessionId,
  configOptions: z.array(SessionConfigOption).nullable().optional(),
  modes: SessionModeState.nullable().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const LoadSessionRequest = z.object({
  method: z.literal("session/load"),
  params: z.object({
    sessionId: SessionId,
    cwd: z.string(),
    mcpServers: z.array(McpServer).default([]),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const LoadSessionResponse = z.object({
  configOptions: z.array(SessionConfigOption).nullable().optional(),
  modes: SessionModeState.nullable().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const PromptRequest = z.object({
  method: z.literal("session/prompt"),
  params: z.object({
    sessionId: SessionId,
    prompt: z.array(ContentBlock),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const PromptResponse = z.object({
  stopReason: StopReason,
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const CancelNotification = z.object({
  method: z.literal("session/cancel"),
  params: z.object({
    sessionId: SessionId,
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

// ─── Client Methods (Agent → Client) ──────────────────────────────────────────

export const RequestPermissionRequest = z.object({
  method: z.literal("session/request_permission"),
  params: z.object({
    sessionId: SessionId,
    toolCall: z.object({
      toolCallId: z.string(),
      title: z.string().optional(),
      kind: ToolKind.optional(),
    }),
    options: z.array(PermissionOption),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const RequestPermissionResponse = z.object({
  outcome: RequestPermissionOutcome,
})

export const ReadTextFileRequest = z.object({
  method: z.literal("fs/read_text_file"),
  params: z.object({
    sessionId: SessionId,
    path: z.string(),
    line: z.number().int().positive().nullable().optional(),
    limit: z.number().int().positive().nullable().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const ReadTextFileResponse = z.object({
  content: z.string(),
})

export const WriteTextFileRequest = z.object({
  method: z.literal("fs/write_text_file"),
  params: z.object({
    sessionId: SessionId,
    path: z.string(),
    content: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const WriteTextFileResponse = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const CreateTerminalRequest = z.object({
  method: z.literal("terminal/create"),
  params: z.object({
    sessionId: SessionId,
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: z.string().nullable().optional(),
    env: z.array(EnvVariable).default([]),
    outputByteLimit: z.number().int().nullable().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const CreateTerminalResponse = z.object({
  terminalId: z.string(),
})

export const TerminalOutputRequest = z.object({
  method: z.literal("terminal/output"),
  params: z.object({
    sessionId: SessionId,
    terminalId: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const TerminalOutputResponse = z.object({
  output: z.string(),
  truncated: z.boolean().default(false),
  exitStatus: z.object({
    exitCode: z.number().int(),
    signal: z.string().nullable().optional(),
  }).nullable().optional(),
})

export const TerminalWaitForExitRequest = z.object({
  method: z.literal("terminal/wait_for_exit"),
  params: z.object({
    sessionId: SessionId,
    terminalId: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const TerminalWaitForExitResponse = z.object({
  exitCode: z.number().int(),
  signal: z.string().nullable().optional(),
})

export const TerminalKillRequest = z.object({
  method: z.literal("terminal/kill"),
  params: z.object({
    sessionId: SessionId,
    terminalId: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const TerminalKillResponse = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const TerminalReleaseRequest = z.object({
  method: z.literal("terminal/release"),
  params: z.object({
    sessionId: SessionId,
    terminalId: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const TerminalReleaseResponse = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
})

// ─── Agent Configuration Methods ───────────────────────────────────────────────

export const SetSessionModeRequest = z.object({
  method: z.literal("session/set_mode"),
  params: z.object({
    sessionId: SessionId,
    modeId: SessionModeId,
  }),
})

export const SetSessionModeResponse = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
})

export const SetSessionConfigOptionRequest = z.object({
  method: z.literal("session/set_config_option"),
  params: z.object({
    sessionId: SessionId,
    configOptions: z.array(SessionConfigOption),
  }),
})

export const SetSessionConfigOptionResponse = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
})

// ─── Agent-side method union (incoming requests) ──────────────────────────────

export const AgentMethodRequest = z.union([
  InitializeRequest,
  NewSessionRequest,
  LoadSessionRequest,
  PromptRequest,
  SetSessionModeRequest,
  SetSessionConfigOptionRequest,
])

// ─── Client-side notification union (incoming notifications) ──────────────────

export const ClientNotification = z.union([CancelNotification])

// ─── JSON-RPC Envelope ────────────────────────────────────────────────────────

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId,
  method: z.string(),
  params: z.unknown().optional(),
})

export const JsonRpcSuccessResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId,
  result: z.unknown(),
})

export const JsonRpcErrorResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestId,
  error: JsonRpcError,
})

export const JsonRpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
})

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type ProtocolVersion = z.infer<typeof ProtocolVersion>
export type RequestId = z.infer<typeof RequestId>
export type JsonRpcError = z.infer<typeof JsonRpcError>
export type Implementation = z.infer<typeof Implementation>
export type ClientCapabilities = z.infer<typeof ClientCapabilities>
export type AgentCapabilities = z.infer<typeof AgentCapabilities>
export type PromptCapabilities = z.infer<typeof PromptCapabilities>
export type TextContent = z.infer<typeof TextContent>
export type ImageContent = z.infer<typeof ImageContent>
export type AudioContent = z.infer<typeof AudioContent>
export type EmbeddedResource = z.infer<typeof EmbeddedResource>
export type ResourceLink = z.infer<typeof ResourceLink>
export type ContentBlock = z.infer<typeof ContentBlock>
export type McpServer = z.infer<typeof McpServer>
export type SessionId = z.infer<typeof SessionId>
export type StopReason = z.infer<typeof StopReason>
export type ToolKind = z.infer<typeof ToolKind>
export type ToolCallStatus = z.infer<typeof ToolCallStatus>
export type ToolCall = z.infer<typeof ToolCall>
export type PlanEntry = z.infer<typeof PlanEntry>
export type Plan = z.infer<typeof Plan>
export type SessionUpdate = z.infer<typeof SessionUpdate>
export type ToolCallNotification = z.infer<typeof ToolCallNotification>
export type ToolCallUpdateNotification = z.infer<typeof ToolCallUpdateNotification>
export type PlanNotification = z.infer<typeof PlanNotification>
export type PromptRequest = z.infer<typeof PromptRequest>
export type PromptResponse = z.infer<typeof PromptResponse>
export type InitializeRequest = z.infer<typeof InitializeRequest>
export type InitializeResponse = z.infer<typeof InitializeResponse>
export type NewSessionRequest = z.infer<typeof NewSessionRequest>
export type NewSessionResponse = z.infer<typeof NewSessionResponse>
export type LoadSessionRequest = z.infer<typeof LoadSessionRequest>
export type LoadSessionResponse = z.infer<typeof LoadSessionResponse>
export type CancelNotification = z.infer<typeof CancelNotification>
export type RequestPermissionRequest = z.infer<typeof RequestPermissionRequest>
export type RequestPermissionResponse = z.infer<typeof RequestPermissionResponse>
export type ReadTextFileRequest = z.infer<typeof ReadTextFileRequest>
export type ReadTextFileResponse = z.infer<typeof ReadTextFileResponse>
export type WriteTextFileRequest = z.infer<typeof WriteTextFileRequest>
export type WriteTextFileResponse = z.infer<typeof WriteTextFileResponse>
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>
export type JsonRpcNotification = z.infer<typeof JsonRpcNotification>
export type UserMessageChunk = z.infer<typeof UserMessageChunk>
export type AgentMessageChunk = z.infer<typeof AgentMessageChunk>
export type AgentThoughtChunk = z.infer<typeof AgentThoughtChunk>
export type AvailableCommand = z.infer<typeof AvailableCommand>
export type PermissionOption = z.infer<typeof PermissionOption>
export type PermissionOptionKind = z.infer<typeof PermissionOptionKind>
export type RequestPermissionOutcome = z.infer<typeof RequestPermissionOutcome>
export type ToolCallLocation = z.infer<typeof ToolCallLocation>
export type DiffContent = z.infer<typeof DiffContent>
export type TerminalContent = z.infer<typeof TerminalContent>
export type ToolCallContent = z.infer<typeof ToolCallContent>
export type SessionModeId = z.infer<typeof SessionModeId>
export type SessionModeState = z.infer<typeof SessionModeState>
export type SessionConfigOption = z.infer<typeof SessionConfigOption>
export type EnvVariable = z.infer<typeof EnvVariable>
export type AuthMethod = z.infer<typeof AuthMethod>
export type SessionCapabilities = z.infer<typeof SessionCapabilities>
export type McpCapabilities = z.infer<typeof McpCapabilities>
export type FileSystemCapabilities = z.infer<typeof FileSystemCapabilities>
export type SetSessionModeRequest = z.infer<typeof SetSessionModeRequest>
export type SetSessionConfigOptionRequest = z.infer<typeof SetSessionConfigOptionRequest>
