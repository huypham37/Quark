import { describe, expect, test } from "bun:test"
import { HttpError, MAX_IMAGES, messagePromptInput, readJsonBody, validateMessageInput } from "../../web/backend"

function jsonRequest(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/sessions/s1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit)
}

function chunked(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

async function readError(request: Request, limit?: number): Promise<HttpError> {
  try {
    await readJsonBody(request, limit)
  } catch (error) {
    return error as HttpError
  }
  throw new Error("expected readJsonBody to throw")
}

describe("readJsonBody", () => {
  test("parses a JSON object", async () => {
    expect(await readJsonBody(jsonRequest('{"text":"hi"}'))).toEqual({ text: "hi" })
  })

  test("rejects malformed JSON with 400", async () => {
    const error = await readError(jsonRequest("{not json"))
    expect(error.status).toBe(400)
  })

  test("rejects an empty body with 400", async () => {
    const error = await readError(jsonRequest(""))
    expect(error.status).toBe(400)
  })

  test("rejects an over-limit Content-Length with 413 before reading", async () => {
    const error = await readError(jsonRequest("{}", { "content-length": "50" }), 16)
    expect(error.status).toBe(413)
    expect((error as HttpError & { message: string }).message).toContain("too large")
  })

  test("caps streamed bytes when Content-Length lies", async () => {
    const error = await readError(jsonRequest(chunked("aaaaaaaaaa", "bbbbbbbbbb"), { "content-length": "4" }), 16)
    expect(error.status).toBe(413)
  })

  test("caps streamed bytes when Content-Length is missing", async () => {
    const error = await readError(jsonRequest(chunked('{"text":"', "way too long", '"}')), 16)
    expect(error.status).toBe(413)
  })

  test("accepts a body exactly at the limit", async () => {
    const body = '{"text":"hi"}'
    expect(await readJsonBody(jsonRequest(body), body.length)).toEqual({ text: "hi" })
  })

  test("rejects an invalid Content-Length with 400", async () => {
    const error = await readError(jsonRequest("{}", { "content-length": "abc" }))
    expect(error.status).toBe(400)
  })
})

describe("validateMessageInput", () => {
  const png = { mime: "image/png", data: "aGVsbG8=" }

  test("keeps text required and trims it", () => {
    expect(validateMessageInput({ text: "  hi  " })).toEqual({ text: "hi", images: [] })
  })

  test("rejects non-object and non-string text bodies with 400", () => {
    for (const body of [null, [], "text", { text: 5 }, {}, { text: "   " }]) {
      expect(() => validateMessageInput(body)).toThrow(HttpError)
    }
  })

  test("treats absent or empty images as text-only", () => {
    expect(validateMessageInput({ text: "hi" }).images).toEqual([])
    expect(validateMessageInput({ text: "hi", images: [] }).images).toEqual([])
  })

  test("accepts supported, canonical images", () => {
    expect(validateMessageInput({ text: "hi", images: [png] }).images).toEqual([png])
  })

  test("names the offending index for non-object entries", () => {
    const error = callError({ text: "hi", images: [png, "nope"] })
    expect(error.status).toBe(400)
    expect(error.message).toContain("images[1]")
  })

  test("rejects unsupported MIME types by index", () => {
    const error = callError({ text: "hi", images: [{ mime: "image/svg+xml", data: "AAAA" }] })
    expect(error.status).toBe(400)
    expect(error.message).toContain("images[0]")
    expect(error.message).toContain("image/svg+xml")
  })

  test("rejects non-canonical or empty base64", () => {
    for (const data of ["", "AA", "AAA", "AAAAA", "A===", "AA=A", "!!!!", "aGVs bG8=", "-_-_"]) {
      const error = callError({ text: "hi", images: [{ mime: "image/png", data }] })
      expect(error.status).toBe(400)
      expect(error.message).toContain("images[0]")
    }
  })

  test("rejects a non-array images field", () => {
    expect(callError({ text: "hi", images: "png" }).status).toBe(400)
  })

  test("bounds the number of images", () => {
    const many = Array.from({ length: MAX_IMAGES + 1 }, () => png)
    expect(callError({ text: "hi", images: many }).status).toBe(400)
  })
})

describe("messagePromptInput", () => {
  test("omits images entirely for text-only messages", () => {
    const input = messagePromptInput({ text: "hi", images: [] })
    expect(input).toEqual({ parts: [{ type: "text", text: "hi" }] })
    expect("images" in input).toBe(false)
  })

  test("passes validated images through when present", () => {
    const images = [{ mime: "image/png", data: "aGVsbG8=" }]
    expect(messagePromptInput({ text: "hi", images }).images).toEqual(images)
  })
})

function callError(body: unknown): HttpError & { message: string } {
  try {
    validateMessageInput(body)
  } catch (error) {
    return error as HttpError & { message: string }
  }
  throw new Error("expected validateMessageInput to throw")
}
