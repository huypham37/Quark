// Tests for the Responses Lite transport (Codex CLI 0.144+ format).
//
// gpt-5.6-luna requires this format on chatgpt.com/backend-api/codex/responses;
// legacy models must pass through unchanged. See issue #159 and the reference
// implementation in opencode PR #36143.
//
// TARGET SOURCE: src/provider/codex-consumer.ts
// Pattern: follows test/provider/codex-consumer.test.ts mock fetch style.

import { describe, test, expect } from "bun:test"
import type { FetchFn } from "../../src/provider/codex-auth"
import { createCodexConsumer } from "../../src/provider/codex-consumer"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function simpleTextStream(delta: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	const events = [
		JSON.stringify({ type: "response.output_text.delta", delta }),
		JSON.stringify({
			type: "response.completed",
			response: { usage: { input_tokens: 10, output_tokens: 5 } },
		}),
	]
	const payload = events.map((e) => `data: ${e}\n\n`).join("")
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(payload))
			controller.close()
		},
	})
}

async function drain(streamResult: { stream: ReadableStream<unknown> }): Promise<void> {
	const reader = streamResult.stream.getReader()
	while (true) {
		const { done } = await reader.read()
		if (done) break
	}
}

interface CapturedRequest {
	body: Record<string, unknown>
	headers: Headers
}

function capturingFetch(captured: CapturedRequest[]): FetchFn {
	return async (_url, init) => {
		captured.push({
			body: JSON.parse((init?.body as string) ?? "{}"),
			headers: new Headers(init?.headers as HeadersInit),
		})
		return new Response(simpleTextStream("hi"), { status: 200 })
	}
}

const SAMPLE_TOOL = {
	type: "function" as const,
	name: "read_file",
	description: "Read a file",
	inputSchema: { type: "object", properties: { path: { type: "string" } } },
}

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// ---------------------------------------------------------------------------
// Lite body shape (gpt-5.6-luna)
// ---------------------------------------------------------------------------

describe("Responses Lite body (gpt-5.6-luna)", () => {
	test("moves tools and instructions into input as developer items", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [
				{ role: "system", content: "You are helpful." },
				{ role: "user", content: [{ type: "text", text: "hello" }] },
			],
			tools: [SAMPLE_TOOL],
		}))

		const body = captured[0]!.body
		expect(body.tools).toBeUndefined()
		expect(body.instructions).toBeUndefined()

		const input = body.input as Array<Record<string, unknown>>
		expect(input[0]).toEqual({
			type: "additional_tools",
			role: "developer",
			tools: [
				{
					type: "function",
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
			],
		})
		expect(input[1]).toEqual({
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text: "You are helpful." }],
		})
		expect(input[2]).toEqual({ role: "user", content: "hello" })
	})

	test("sets Lite-specific body fields", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			tools: [SAMPLE_TOOL],
		}))

		const body = captured[0]!.body
		expect(body.tool_choice).toBe("auto")
		expect(body.parallel_tool_calls).toBe(false)
		expect(body.prompt_cache_key).toMatch(UUID_V7_RE)
		expect((body.reasoning as Record<string, unknown>).context).toBe("all_turns")
	})

	test("adds additional_tools item with [] even when no tools are provided", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
		}))

		const input = captured[0]!.body.input as Array<Record<string, unknown>>
		expect(input[0]).toEqual({ type: "additional_tools", role: "developer", tools: [] })
		// No system prompt → no developer message item.
		expect(input[1]).toEqual({ role: "user", content: "hello" })
	})

	test("preserves reasoning effort/summary while forcing context", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			providerOptions: { codex: { reasoningEffort: "high", reasoningSummary: "auto" } },
		}))

		expect(captured[0]!.body.reasoning).toEqual({
			effort: "high",
			summary: "auto",
			context: "all_turns",
		})
	})

	test("strips detail from input_image parts", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe:" },
						{ type: "file", data: "iVBORw0KGgo", mediaType: "image/png" },
					],
				},
			],
		}))

		const input = captured[0]!.body.input as Array<Record<string, unknown>>
		const content = input[1]!.content as Array<Record<string, unknown>>
		expect(content[1]).toEqual({
			type: "input_image",
			image_url: "data:image/png;base64,iVBORw0KGgo",
		})
	})
})

// ---------------------------------------------------------------------------
// Lite headers and session identity
// ---------------------------------------------------------------------------

describe("Responses Lite headers (gpt-5.6-luna)", () => {
	test("sends compatibility headers with matching session identity", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		await drain(await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
		}))

		const { body, headers } = captured[0]!
		expect(headers.get("version")).toBe("0.144.0")
		expect(headers.get("x-openai-internal-codex-responses-lite")).toBe("true")
		const sessionId = headers.get("session-id")
		expect(sessionId).toMatch(UUID_V7_RE)
		expect(headers.get("x-session-affinity")).toBe(sessionId)
		expect(body.prompt_cache_key).toBe(sessionId)
	})

	test("session id is stable across requests on the same provider instance", async () => {
		const captured: CapturedRequest[] = []
		const model = createCodexConsumer({
			modelId: "gpt-5.6-luna",
			jwt: "jwt",
			accountId: "acct",
			fetch: capturingFetch(captured),
		})

		const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }]
		await drain(await model.doStream({ prompt }))
		await drain(await model.doStream({ prompt }))

		expect(captured[0]!.headers.get("session-id")).toBe(captured[1]!.headers.get("session-id"))
	})
})

// ---------------------------------------------------------------------------
// Legacy passthrough (non-Lite models)
// ---------------------------------------------------------------------------

describe("legacy models are untouched", () => {
	for (const modelId of ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5"]) {
		test(`${modelId} keeps legacy body and headers`, async () => {
			const captured: CapturedRequest[] = []
			const model = createCodexConsumer({
				modelId,
				jwt: "jwt",
				accountId: "acct",
				fetch: capturingFetch(captured),
			})

			await drain(await model.doStream({
				prompt: [
					{ role: "system", content: "You are helpful." },
					{ role: "user", content: [{ type: "text", text: "hello" }] },
				],
				tools: [SAMPLE_TOOL],
			}))

			const { body, headers } = captured[0]!
			expect(body.instructions).toBe("You are helpful.")
			expect(Array.isArray(body.tools)).toBe(true)
			expect(body.parallel_tool_calls).toBe(true)
			expect(body.prompt_cache_key).toBeUndefined()
			expect((body.input as unknown[])[0]).toEqual({ role: "user", content: "hello" })

			expect(headers.get("version")).toBeNull()
			expect(headers.get("x-openai-internal-codex-responses-lite")).toBeNull()
			expect(headers.get("session-id")).toBeNull()
			expect(headers.get("x-session-affinity")).toBeNull()
		})
	}
})
