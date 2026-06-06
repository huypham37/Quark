/**
 * ChatGPT Consumer API Provider
 * Custom AI SDK v3 provider that streams from chatgpt.com/backend-api/codex/responses
 * using a consumer JWT (ChatGPT Plus/Pro subscription token).
 */

import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { generateId } from "ai"
import type { FetchFn } from "./codex-auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodexConsumerOptions {
	modelId: string
	jwt?: string
	accountId?: string
	getToken?: () => Promise<string>
	getAccountId?: () => Promise<string>
	fetch?: FetchFn
	maxRetries?: number
}

interface CodexRequestBody {
	model: string
	store: boolean
	stream: boolean
	instructions?: string
	input: unknown[]
	text?: { verbosity?: string }
	include?: string[]
	tools?: unknown[]
	tool_choice?: string
	parallel_tool_calls?: boolean
	temperature?: number
	previous_response_id?: string
	reasoning?: { effort?: string; summary?: string }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createCodexConsumer(options: CodexConsumerOptions): LanguageModelV3 {
	const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis) as FetchFn
	const maxRetries = options.maxRetries ?? 0

	return {
		specificationVersion: "v3",
		provider: "codex-consumer",
		modelId: options.modelId,
		supportedUrls: {},

		async doGenerate(opts: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
			const streamResult = await this.doStream(opts)
			const reader = streamResult.stream.getReader()
			const parts: LanguageModelV3StreamPart[] = []
			let text = ""
			let finishReason: LanguageModelV3GenerateResult["finishReason"] = { unified: "stop", raw: undefined }
			let usage: LanguageModelV3GenerateResult["usage"] = {
				inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 0, text: 0, reasoning: 0 },
			}
			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break
					parts.push(value)
					if (value.type === "text-delta") {
						text += value.delta
					}
					if (value.type === "finish") {
						finishReason = value.finishReason
						usage = value.usage
					}
				}
			} finally {
				reader.releaseLock()
			}
			return {
				content: [{ type: "text", text }],
				finishReason,
				usage,
				warnings: [],
			}
		},

		async doStream(opts: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
			const jwt = options.jwt ?? (await options.getToken!())
			const accountId = options.accountId ?? (await options.getAccountId!())
			const body = buildRequestBody(options.modelId, opts)
			const headers = buildHeaders(jwt, accountId)

			const response = await fetchWithRetry(
				"https://chatgpt.com/backend-api/codex/responses",
				{
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: opts.abortSignal,
				},
				baseFetch,
				maxRetries,
			)

			const stream = new ReadableStream<LanguageModelV3StreamPart>({
				async start(controller) {
					const reader = response.body!.getReader()
					const decoder = new TextDecoder()
					let buffer = ""
					let readerDone = false
					let aborted = false
					let closed = false

					const onAbort = () => {
						aborted = true
						void reader.cancel().catch(() => {})
					}
					opts.abortSignal?.addEventListener("abort", onAbort, { once: true })

					const closeIfNeeded = () => {
						if (!closed) {
							closed = true
							controller.close()
						}
					}

					try {
						while (!readerDone && !aborted) {
							const { value, done } = await reader.read()
							if (aborted) break
							if (done) {
								readerDone = true
								break
							}
							buffer += decoder.decode(value, { stream: true })

							let idx = buffer.indexOf("\n\n")
							while (idx !== -1) {
								const chunk = buffer.slice(0, idx)
								buffer = buffer.slice(idx + 2)

								const dataLines = chunk
									.split("\n")
									.filter((l) => l.startsWith("data:"))
									.map((l) => l.slice(5).trim())

								for (const data of dataLines) {
									if (!data || data === "[DONE]") continue
									const part = parseCodexSSE(data)
									if (part) {
										controller.enqueue(part)
										if (part.type === "finish" || part.type === "error") {
											closeIfNeeded()
											return
										}
									}
								}
								idx = buffer.indexOf("\n\n")
							}
						}

						// Flush any remaining data in buffer (no trailing \n\n)
						if (buffer.trim().length > 0) {
							const dataLines = buffer
								.split("\n")
								.filter((l) => l.startsWith("data:"))
								.map((l) => l.slice(5).trim())
							for (const data of dataLines) {
								if (!data || data === "[DONE]") continue
								const part = parseCodexSSE(data)
								if (part) {
									controller.enqueue(part)
									if (part.type === "finish" || part.type === "error") {
										closeIfNeeded()
										return
										}
									}
								}
							}

						closeIfNeeded()
					} catch (err) {
						if (!aborted) {
							controller.error(err)
						}
					} finally {
						opts.abortSignal?.removeEventListener("abort", onAbort)
						try {
							await reader.cancel()
						} catch {}
						try {
							reader.releaseLock()
						} catch {}
					}
				},
			})

			return { stream }
		},
	}
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function buildRequestBody(modelId: string, opts: LanguageModelV3CallOptions): CodexRequestBody {
	const systemParts = opts.prompt.filter((m) => m.role === "system")
	const nonSystemParts = opts.prompt.filter((m) => m.role !== "system")

	const instructions = systemParts
		.map((m) => {
			if (typeof m.content === "string") return m.content
			if (Array.isArray(m.content)) {
				return (m.content as Array<{ type: string; text?: string }>)
					.filter((c) => c.type === "text")
					.map((c) => c.text ?? "")
					.join("\n")
			}
			return ""
		})
		.join("\n")
		.trim()

	const input = nonSystemParts.map((m) => {
		if (m.role === "user") {
			if (typeof m.content === "string") {
				return { role: "user", content: m.content }
			}
			if (Array.isArray(m.content)) {
				const hasImages = m.content.some(
					(c) => c.type === "file" && (c as { mediaType?: string }).mediaType?.startsWith("image/"),
				)
				if (!hasImages) {
					// Text-only — join all text parts into a single string
					const text = m.content
						.filter((c) => c.type === "text")
						.map((c) => (c as { text: string }).text)
						.join("")
					return { role: "user", content: text }
				}
				// Mixed text + images — use array format
				const parts = m.content
					.map((c) => {
						if (c.type === "text") {
							return { type: "input_text", text: (c as { text: string }).text }
						}
						if (c.type === "file") {
							const f = c as { data: string | Uint8Array; mediaType: string }
							let imageUrl: string
							if (typeof f.data === "string") {
								// Base64 string or URL
								imageUrl = f.data.startsWith("http") ? f.data : `data:${f.mediaType};base64,${f.data}`
							} else {
								// Uint8Array → base64
								imageUrl = `data:${f.mediaType};base64,${Buffer.from(f.data).toString("base64")}`
							}
							return {
								type: "input_image",
								detail: "auto",
								image_url: imageUrl,
							}
						}
						return null
					})
					.filter(Boolean)
				return { role: "user", content: parts }
			}
			return m
		}
		if (m.role === "assistant") {
			const parts: Array<Record<string, unknown>> = []
			if (Array.isArray(m.content)) {
				for (const c of m.content) {
					if (c.type === "text") {
						parts.push({ type: "input_text", text: (c as { text: string }).text })
					} else if (c.type === "reasoning") {
						parts.push({ type: "input_text", text: (c as { text: string }).text })
					} else if (c.type === "tool-call") {
						const tc = c as { toolCallId: string; toolName: string; input: unknown }
						parts.push({
							type: "tool_call",
							id: tc.toolCallId,
							call_id: tc.toolCallId,
							type_: "tool_call",
							name: tc.toolName,
							arguments: String(tc.input),
						})
					}
				}
			}
			return { role: "assistant", content: parts }
		}
		if (m.role === "tool") {
			const results = Array.isArray(m.content) ? m.content : []
			return {
				role: "user",
				content: results
					.filter((c) => c.type === "tool-result")
					.map((c) => {
						const tr = c as { toolCallId: string; toolName: string; output: unknown; isError?: boolean }
						return {
							type: "tool_result",
							tool_call_id: tr.toolCallId,
							output: JSON.stringify(tr.output),
							is_error: tr.isError ?? false,
						}
					}),
			}
		}
		return m
	})

	const body: CodexRequestBody = {
		model: modelId,
		store: false,
		stream: true,
		input,
		text: { verbosity: "low" },
		include: ["reasoning.encrypted_content"],
	}

	if (instructions.length > 0) {
		body.instructions = instructions
	}

	if (opts.tools && opts.tools.length > 0) {
		body.tools = opts.tools.map((t) => {
			if (t.type !== "function") {
				return t as unknown
			}
			const ft = t as { name: string; description?: string; inputSchema?: unknown }
			return {
				type: "function",
				function: {
					name: ft.name,
					description: ft.description,
					parameters: ft.inputSchema,
				},
			}
		})
		body.tool_choice = "auto"
		body.parallel_tool_calls = true
	}

	if (opts.temperature !== undefined) {
		body.temperature = opts.temperature
	}

	// Codex consumer API uses nested `reasoning: { effort, summary }`
	// rather than the standard OpenAI `reasoningEffort` flat field.
	const codexOpts = opts.providerOptions?.codex as Record<string, unknown> | undefined
	const reasoningEffort = codexOpts?.reasoningEffort as string | undefined
	const reasoningSummary = codexOpts?.reasoningSummary as string | undefined
	if (reasoningEffort && reasoningEffort !== "none") {
		body.reasoning = {
			effort: reasoningEffort,
			summary: reasoningSummary ?? "auto",
		}
	}

	return body
}

function buildHeaders(jwt: string, accountId: string): Headers {
	const h = new Headers()
	h.set("Authorization", `Bearer ${jwt}`)
	h.set("chatgpt-account-id", accountId)
	h.set("originator", "pi")
	h.set("OpenAI-Beta", "responses=experimental")
	h.set("Accept", "text/event-stream")
	h.set("Content-Type", "application/json")
	return h
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

const BASE_DELAY_MS = 1000

function isRetryableError(status: number, _errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true
	}
	return false
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"))
			return
		}
		const timeout = setTimeout(resolve, ms)
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout)
			reject(new Error("Request was aborted"))
		}, { once: true })
	})
}

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	fetchFn: FetchFn,
	maxRetries: number,
): Promise<Response> {
	let lastError: Error | undefined

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await fetchFn(url, init)

			if (response.ok) {
				return response
			}

			const errorText = await response.text().catch(() => "")

			if (attempt < maxRetries && isRetryableError(response.status, errorText)) {
				const delayMs = BASE_DELAY_MS * 2 ** attempt
				await sleep(delayMs, init.signal as AbortSignal | undefined)
				continue
			}

			throw new Error(`Codex consumer API error: ${response.status} ${response.statusText} — ${errorText || "no details"}`)
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
				throw error
			}
			// Don't retry HTTP errors we already evaluated as non-retryable
			if (error instanceof Error && error.message.startsWith("Codex consumer API error")) {
				throw error
			}
			lastError = error instanceof Error ? error : new Error(String(error))
			if (attempt < maxRetries) {
				const delayMs = BASE_DELAY_MS * 2 ** attempt
				await sleep(delayMs, init.signal as AbortSignal | undefined)
				continue
			}
			throw lastError
		}
	}

	throw lastError ?? new Error("Failed after retries")
}

// ---------------------------------------------------------------------------
// SSE event parsing
// ---------------------------------------------------------------------------

export function parseCodexSSE(data: string): LanguageModelV3StreamPart | null {
	let event: Record<string, unknown>
	try {
		event = JSON.parse(data) as Record<string, unknown>
	} catch {
		return null
	}

	const type = typeof event.type === "string" ? event.type : undefined
	if (!type) return null

	const id = generateId()

	switch (type) {
		case "response.output_text.delta": {
			const delta = typeof event.delta === "string" ? event.delta : ""
			return { type: "text-delta", id, delta }
		}

		case "response.reasoning_text.delta": {
			const delta = typeof event.delta === "string" ? event.delta : ""
			return { type: "reasoning-delta", id, delta }
		}

		case "response.function_call_arguments.delta": {
			const delta = typeof event.delta === "string" ? event.delta : ""
			return { type: "tool-input-delta", id, delta }
		}

		case "response.output_item.done": {
			const item = event.item as Record<string, unknown> | undefined
			if (item && item.type === "function_call") {
				return {
					type: "tool-call",
					toolCallId: String(item.id ?? generateId()),
					toolName: String(item.name ?? ""),
					input: String(item.arguments ?? ""),
				}
			}
			return null
		}

		case "response.completed": {
			const response = event.response as Record<string, unknown> | undefined
			const usage = response?.usage as Record<string, unknown> | undefined
			return {
				type: "finish",
				usage: mapUsage(usage),
				finishReason: { unified: "stop", raw: "completed" },
			}
		}

		case "response.done": {
			return {
				type: "finish",
				usage: zeroUsage(),
				finishReason: { unified: "stop", raw: "done" },
			}
		}

		case "response.incomplete": {
			return {
				type: "finish",
				usage: zeroUsage(),
				finishReason: { unified: "length", raw: "incomplete" },
			}
		}

		case "response.failed": {
			const error = event.error as Record<string, unknown> | undefined
			const message = error && typeof error.message === "string" ? error.message : "Codex response failed"
			return { type: "error", error: new Error(message) }
		}

		case "error": {
			const message = typeof event.message === "string" ? event.message : "Codex error"
			return { type: "error", error: new Error(message) }
		}

		default:
			return null
	}
}

function mapUsage(usage?: Record<string, unknown>): LanguageModelV3StreamPart & { type: "finish" } extends infer U ? (U extends { usage: infer V } ? V : never) : never {
	const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : 0
	const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : 0
	return {
		inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
	} as any
}

function zeroUsage(): any {
	return {
		inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 0, text: 0, reasoning: 0 },
	}
}
