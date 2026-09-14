import { WebBackend } from "./backend"
import * as path from "path"

const backend = await WebBackend.create()
const publicDir = path.resolve(import.meta.dir, "dist")

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname.startsWith("/api/")) return backend.fetch(request)

  const pathname = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
  const filePath = path.resolve(publicDir, pathname)
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) return new Response("Not found", { status: 404 })

  const file = Bun.file(filePath)
  if (await file.exists()) return new Response(file)

  const index = Bun.file(path.join(publicDir, "index.html"))
  return await index.exists() ? new Response(index) : new Response("Run bun run web:build first", { status: 503 })
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT ?? 4173),
  fetch: serve,
})

console.log(`Quark web: ${server.url}`)
