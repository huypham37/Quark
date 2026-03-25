// Clipboard utility — reads image (or text) from the system clipboard.
// Mirrors the strategy from opencode: use native OS tools to extract PNG bytes.

import { platform, release } from "os"
import { tmpdir } from "os"
import path from "path"
import fs from "fs/promises"

export interface ClipboardContent {
  data: string // base64
  mime: string
}

async function run(cmd: string[]): Promise<{ stdout: Buffer }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  const out = await new Response(proc.stdout).arrayBuffer()
  return { stdout: Buffer.from(out) }
}

export async function readClipboard(): Promise<ClipboardContent | undefined> {
  const os = platform()

  // macOS — use osascript to export clipboard as PNG to a temp file
  if (os === "darwin") {
    const tmp = path.join(tmpdir(), "atom-clipboard.png")
    try {
      await run([
        "osascript",
        "-e", 'set imageData to the clipboard as "PNGf"',
        "-e", `set fileRef to open for access POSIX file "${tmp}" with write permission`,
        "-e", "set eof fileRef to 0",
        "-e", "write imageData to fileRef",
        "-e", "close access fileRef",
      ])
      const buf = await fs.readFile(tmp)
      if (buf.length === 0) return undefined
      return { data: buf.toString("base64"), mime: "image/png" }
    } catch {
      // No image in clipboard — fall through
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {})
    }
  }

  // Windows / WSL — PowerShell via System.Windows.Forms
  if (os === "win32" || release().includes("WSL")) {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
    const result = await run(["powershell.exe", "-NonInteractive", "-NoProfile", "-command", script])
    const text = result.stdout.toString().trim()
    if (text) {
      const buf = Buffer.from(text, "base64")
      if (buf.length > 0) return { data: buf.toString("base64"), mime: "image/png" }
    }
  }

  // Linux — Wayland first, then X11
  if (os === "linux") {
    const wayland = await run(["wl-paste", "-t", "image/png"])
    if (wayland.stdout.length > 0)
      return { data: wayland.stdout.toString("base64"), mime: "image/png" }

    const x11 = await run(["xclip", "-selection", "clipboard", "-t", "image/png", "-o"])
    if (x11.stdout.length > 0)
      return { data: x11.stdout.toString("base64"), mime: "image/png" }
  }

  return undefined
}
