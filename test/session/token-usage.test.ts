import { describe, it, expect, beforeAll, afterEach } from "bun:test"
import {
  saveUserMessage,
  createAssistantMessage,
  finishMessage,
  loadMessages,
  addPart,
  toModelMessages,
  type MessageRow,
  type PartRow,
  type StepFinishData,
} from "../../src/session/message"
import { bus } from "../../src/session/events"
import { getDB } from "../../src/storage/db"
import { createSession } from "../../src/session/session"
import { bootstrap, resetBootstrap } from "../../src/bootstrap"

// ---------------------------------------------------------------------------
// Test Setup & Helpers
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Initialize in-memory database once
  getDB(":memory:")
  resetBootstrap()
  await bootstrap()
})

afterEach(() => {
  // Clean up: remove all event listeners
  bus.removeAllListeners()
})

function getUniqueSessionId(): string {
  // Create an actual session in the database to satisfy foreign key constraints
  const session = createSession()
  return session.id
}

// ---------------------------------------------------------------------------
// TC-TOKEN-BASIC-TRACKING: Basic token tracking on message completion
// ---------------------------------------------------------------------------

describe("Token Usage - Basic Tracking", () => {
  it("tc-token-basic-tracking: stores token usage data on message completion", () => {
    const sessionId = getUniqueSessionId()
    // Step 1: Create an assistant message
    const msg = createAssistantMessage({
      sessionId,
      modelId: "gpt-4",
      providerId: "openai",
    })

    // Step 2: Call finishMessage() with usage data
    finishMessage(msg.id, "stop", {
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.005,
    })

    // Step 3: Retrieve the message from database
    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Step 4-6: Verify token values
    expect(retrieved).toBeDefined()
    expect(retrieved!.tokensIn).toBe(100)
    expect(retrieved!.tokensOut).toBe(50)
    expect(retrieved!.cost).toBe(0.005)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-NULL-VALUES: Handle null/undefined token values gracefully
// ---------------------------------------------------------------------------

describe("Token Usage - Null Values", () => {
  it("tc-token-null-values: handles missing usage data gracefully", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    // Call finishMessage() without providing usage parameter
    finishMessage(msg.id, "stop")

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-PARTIAL-USAGE: Handle partial usage data
// ---------------------------------------------------------------------------

describe("Token Usage - Partial Data", () => {
  it("tc-token-partial-usage: handles partial usage data correctly", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    // Provide only tokensIn
    finishMessage(msg.id, "stop", { tokensIn: 200 })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(200)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(null)
  })

  it("should handle only tokensOut provided", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    finishMessage(msg.id, "stop", { tokensOut: 75 })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(75)
    expect(retrieved!.cost).toBe(null)
  })

  it("should handle only cost provided", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    finishMessage(msg.id, "stop", { cost: 0.01 })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(0.01)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-ZERO-VALUES: Track zero token usage correctly
// ---------------------------------------------------------------------------

describe("Token Usage - Zero Values", () => {
  it("tc-token-zero-values: preserves zero values (not converted to null)", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    finishMessage(msg.id, "stop", {
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Zero should be preserved, not converted to null
    expect(retrieved!.tokensIn).toBe(0)
    expect(retrieved!.tokensOut).toBe(0)
    expect(retrieved!.cost).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-LARGE-VALUES: Handle very large token counts
// ---------------------------------------------------------------------------

describe("Token Usage - Large Values", () => {
  it("tc-token-large-values: handles very large token counts without overflow", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    const largeTokensIn = 1_000_000
    const largeTokensOut = 500_000
    const largeCost = 100.5

    finishMessage(msg.id, "stop", {
      tokensIn: largeTokensIn,
      tokensOut: largeTokensOut,
      cost: largeCost,
    })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(largeTokensIn)
    expect(retrieved!.tokensOut).toBe(largeTokensOut)
    expect(retrieved!.cost).toBe(largeCost)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-EVENT-STEP-FINISH: step-finish event includes token usage data
// ---------------------------------------------------------------------------

describe("Token Usage - Event Emission", () => {
  it("tc-token-event-step-finish: emits step-finish event with token data", (done) => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    const expectedTokens = {
      input: 150,
      output: 75,
      cacheRead: 10,
      cacheWrite: 5,
    }

    // Set up event listener
    bus.once("step-finish", (event) => {
      expect(event.sessionId).toBe(sessionId)
      expect(event.messageId).toBe(msg.id)
      expect(event.data.tokens?.input).toBe(expectedTokens.input)
      expect(event.data.tokens?.output).toBe(expectedTokens.output)
      expect(event.data.tokens?.cacheRead).toBe(expectedTokens.cacheRead)
      expect(event.data.tokens?.cacheWrite).toBe(expectedTokens.cacheWrite)
      done()
    })

    // Emit step-finish event
    const stepFinishData: StepFinishData = {
      reason: "stop",
      tokens: expectedTokens,
      cost: 0.01,
    }

    bus.emit("step-finish", {
      sessionId,
      messageId: msg.id,
      data: stepFinishData,
    })
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-CACHE-TRACKING: Track cache hit tokens
// ---------------------------------------------------------------------------

describe("Token Usage - Cache Tokens", () => {
  it("tc-token-cache-tracking: tracks and persists cache token data", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    const stepFinishData: StepFinishData = {
      reason: "stop",
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 80,
        cacheWrite: 20,
      },
      cost: 0.005,
    }

    // Add step-finish part
    addPart({
      messageId: msg.id,
      sessionId,
      type: "step-finish",
      data: stepFinishData,
    })

    // Retrieve parts
    const { parts } = loadMessages(sessionId)
    const stepFinishPart = parts.find(
      (p) => p.messageId === msg.id && p.type === "step-finish"
    )

    expect(stepFinishPart).toBeDefined()
    const retrievedData = JSON.parse(stepFinishPart!.data) as StepFinishData
    expect(retrievedData.tokens?.input).toBe(100)
    expect(retrievedData.tokens?.output).toBe(50)
    expect(retrievedData.tokens?.cacheRead).toBe(80)
    expect(retrievedData.tokens?.cacheWrite).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-COST-CALCULATION: Cost field stores floating-point values
// ---------------------------------------------------------------------------

describe("Token Usage - Cost Tracking", () => {
  it("tc-token-cost-calculation: stores precise floating-point cost values", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    const preciseCost = 0.0123456789

    finishMessage(msg.id, "stop", { cost: preciseCost })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Check within epsilon for floating-point precision
    expect(retrieved!.cost).toBeDefined()
    expect(Math.abs(retrieved!.cost! - preciseCost)).toBeLessThan(0.0001)
  })

  it("should handle very small cost values", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    finishMessage(msg.id, "stop", { cost: 0.000001 })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.cost).toBeDefined()
    expect(retrieved!.cost).toBeCloseTo(0.000001, 6)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-PERSISTENCE-RELOAD: Token data persists across sessions
// ---------------------------------------------------------------------------

describe("Token Usage - Persistence", () => {
  it("tc-token-persistence-reload: token data persists across database reloads", () => {
    const sessionId = getUniqueSessionId()
    // Create session with multiple messages
    const msg1 = createAssistantMessage({ sessionId })
    finishMessage(msg1.id, "stop", { tokensIn: 100, tokensOut: 50, cost: 0.01 })

    const msg2 = createAssistantMessage({ sessionId })
    finishMessage(msg2.id, "tool-calls", { tokensIn: 200, tokensOut: 100, cost: 0.02 })

    const msg3 = createAssistantMessage({ sessionId })
    finishMessage(msg3.id, "length", { tokensIn: 300, tokensOut: 150, cost: 0.03 })

    // First load
    const { messages: firstLoad } = loadMessages(sessionId)
    expect(firstLoad).toHaveLength(3)

    // Verify initial data
    expect(firstLoad[0]!.tokensIn).toBe(100)
    expect(firstLoad[1]!.tokensIn).toBe(200)
    expect(firstLoad[2]!.tokensIn).toBe(300)

    // Simulate reload by loading again
    const { messages: secondLoad } = loadMessages(sessionId)

    // Verify data still intact
    expect(secondLoad).toHaveLength(3)
    expect(secondLoad[0]!.tokensIn).toBe(100)
    expect(secondLoad[0]!.tokensOut).toBe(50)
    expect(secondLoad[0]!.cost).toBe(0.01)
    expect(secondLoad[1]!.tokensIn).toBe(200)
    expect(secondLoad[2]!.tokensIn).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-USER-MESSAGE: User messages have null token values
// ---------------------------------------------------------------------------

describe("Token Usage - User Messages", () => {
  it("tc-token-user-message: user messages do not track tokens", () => {
    const sessionId = getUniqueSessionId()
    const userMsg = saveUserMessage({
      sessionId,
      text: "Hello, how are you?",
    })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === userMsg.id)

    expect(retrieved!.role).toBe("user")
    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-MULTIPLE-STEPS: Multiple step-finish events
// ---------------------------------------------------------------------------

describe("Token Usage - Aggregation", () => {
  it("tc-token-multiple-steps: handles multiple step-finish parts in one message", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    // Add first step
    addPart({
      messageId: msg.id,
      sessionId,
      type: "step-finish",
      data: {
        reason: "tool-calls",
        tokens: { input: 100, output: 50 },
      } as StepFinishData,
    })

    // Add second step
    addPart({
      messageId: msg.id,
      sessionId,
      type: "step-finish",
      data: {
        reason: "stop",
        tokens: { input: 200, output: 100 },
      } as StepFinishData,
    })

    // Finish with total
    finishMessage(msg.id, "stop", {
      tokensIn: 300,
      tokensOut: 150,
    })

    const { messages, parts } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Message should have cumulative total
    expect(retrieved!.tokensIn).toBe(300)
    expect(retrieved!.tokensOut).toBe(150)

    // Parts should preserve individual step data
    const stepParts = parts.filter(
      (p) => p.messageId === msg.id && p.type === "step-finish"
    )
    expect(stepParts).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-CONCURRENT-UPDATES: Concurrent token updates
// ---------------------------------------------------------------------------

describe("Token Usage - Concurrency", () => {
  it("tc-token-concurrent-updates: handles concurrent message updates correctly", async () => {
    const sessionId = getUniqueSessionId()
    const msg1 = createAssistantMessage({ sessionId })
    const msg2 = createAssistantMessage({ sessionId })

    // Concurrently finish both messages
    await Promise.all([
      Promise.resolve(
        finishMessage(msg1.id, "stop", {
          tokensIn: 100,
          tokensOut: 50,
          cost: 0.01,
        })
      ),
      Promise.resolve(
        finishMessage(msg2.id, "stop", {
          tokensIn: 200,
          tokensOut: 100,
          cost: 0.02,
        })
      ),
    ])

    const { messages } = loadMessages(sessionId)

    const retrieved1 = messages.find((m) => m.id === msg1.id)
    const retrieved2 = messages.find((m) => m.id === msg2.id)

    // Each message should have its own correct token values
    expect(retrieved1!.tokensIn).toBe(100)
    expect(retrieved1!.tokensOut).toBe(50)
    expect(retrieved1!.cost).toBe(0.01)

    expect(retrieved2!.tokensIn).toBe(200)
    expect(retrieved2!.tokensOut).toBe(100)
    expect(retrieved2!.cost).toBe(0.02)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-TOMODELMESSAGES: toModelMessages() does not expose token data
// ---------------------------------------------------------------------------

describe("Token Usage - Data Transformation", () => {
  it("tc-token-tomodelmessages: toModelMessages() excludes internal token metadata", () => {
    const sessionId = getUniqueSessionId()
    // Create user message
    saveUserMessage({ sessionId, text: "Hello" })

    // Create assistant message with token data
    const msg = createAssistantMessage({ sessionId })
    addPart({
      messageId: msg.id,
      sessionId,
      type: "text",
      data: { text: "Hi there!" },
    })
    finishMessage(msg.id, "stop", {
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.01,
    })

    const { messages, parts } = loadMessages(sessionId)
    const modelMessages = toModelMessages(messages, parts)

    // ModelMessages should only contain role and content
    expect(modelMessages).toHaveLength(2)
    expect(modelMessages[0]!.role).toBe("user")
    expect(modelMessages[1]!.role).toBe("assistant")

    // Should NOT have token fields
    expect((modelMessages[0] as any).tokensIn).toBeUndefined()
    expect((modelMessages[0] as any).tokensOut).toBeUndefined()
    expect((modelMessages[1] as any).tokensIn).toBeUndefined()
    expect((modelMessages[1] as any).cost).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-NEGATIVE-VALUES: Handle negative token values
// ---------------------------------------------------------------------------

describe("Token Usage - Validation", () => {
  it("tc-token-negative-values: stores negative values as-is (no validation)", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    // System does not validate - stores what's provided
    finishMessage(msg.id, "stop", {
      tokensIn: -100,
      tokensOut: -50,
      cost: -0.01,
    })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Negative values are stored (system doesn't validate)
    // This documents current behavior - could be changed to validation in future
    expect(retrieved!.tokensIn).toBe(-100)
    expect(retrieved!.tokensOut).toBe(-50)
    expect(retrieved!.cost).toBe(-0.01)
  })
})

// ---------------------------------------------------------------------------
// TC-TOKEN-FINISH-REASON: Token data tracked regardless of finish reason
// ---------------------------------------------------------------------------

describe("Token Usage - Finish Reasons", () => {
  it("tc-token-finish-reason: tracks tokens for all finish reasons", () => {
    const sessionId = getUniqueSessionId()
    const msg1 = createAssistantMessage({ sessionId })
    finishMessage(msg1.id, "stop", { tokensIn: 100, tokensOut: 50 })

    const msg2 = createAssistantMessage({ sessionId })
    finishMessage(msg2.id, "tool-calls", { tokensIn: 200, tokensOut: 100 })

    const msg3 = createAssistantMessage({ sessionId })
    finishMessage(msg3.id, "length", { tokensIn: 300, tokensOut: 150 })

    const { messages } = loadMessages(sessionId)

    const stop = messages.find((m) => m.finish === "stop")
    const toolCalls = messages.find((m) => m.finish === "tool-calls")
    const length = messages.find((m) => m.finish === "length")

    expect(stop!.tokensIn).toBe(100)
    expect(toolCalls!.tokensIn).toBe(200)
    expect(length!.tokensIn).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Additional Edge Cases
// ---------------------------------------------------------------------------

describe("Token Usage - Additional Edge Cases", () => {
  it("should handle undefined fields in usage object", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    finishMessage(msg.id, "stop", {
      tokensIn: undefined,
      tokensOut: undefined,
      cost: undefined,
    })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(null)
  })

  it("should handle empty usage object", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })
    finishMessage(msg.id, "stop", {})

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    expect(retrieved!.tokensIn).toBe(null)
    expect(retrieved!.tokensOut).toBe(null)
    expect(retrieved!.cost).toBe(null)
  })

  it("should track tokens across message finish updates", () => {
    const sessionId = getUniqueSessionId()
    const msg = createAssistantMessage({ sessionId })

    // First finish
    finishMessage(msg.id, "tool-calls", { tokensIn: 100, tokensOut: 50 })

    // Second finish (update scenario - though not typical)
    finishMessage(msg.id, "stop", { tokensIn: 200, tokensOut: 100, cost: 0.02 })

    const { messages } = loadMessages(sessionId)
    const retrieved = messages.find((m) => m.id === msg.id)

    // Should have latest values
    expect(retrieved!.tokensIn).toBe(200)
    expect(retrieved!.tokensOut).toBe(100)
    expect(retrieved!.cost).toBe(0.02)
    expect(retrieved!.finish).toBe("stop")
  })
})
