import * as path from "node:path"
import { fileURLToPath } from "node:url"

export interface FileTarget {
  filePath: string
  line?: number
  column?: number
}

/** Parse a local file URI and its common #L<line>C<column> location fragment. */
export function parseFileUri(href: string): FileTarget | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== "file:" || (url.host && url.host !== "localhost")) return null

  let filePath: string
  try {
    filePath = fileURLToPath(url)
  } catch {
    return null
  }

  const location = /^#L(\d+)(?:C(\d+))?(?:-L\d+(?:C\d+)?)?$/i.exec(url.hash)
  return {
    filePath,
    ...(location ? { line: Number(location[1]) } : {}),
    ...(location?.[2] ? { column: Number(location[2]) } : {}),
  }
}

export function resolveEditor(configEditor?: string): string {
  return configEditor ?? process.env.EDITOR ?? process.env.VISUAL ?? "nvim"
}

/** Build a shell-free argv suitable for the configured editor. */
export function buildEditorArgv(editor: string, target: FileTarget): string[] {
  const name = path.basename(editor).toLowerCase()
  if (["nvim", "vim", "vi"].includes(name)) {
    return [editor, ...(target.line ? [`+${target.line}`] : []), "--", target.filePath]
  }
  if (["code", "code-insiders", "codium"].includes(name) && target.line) {
    return [editor, "--goto", `${target.filePath}:${target.line}${target.column ? `:${target.column}` : ""}`]
  }
  return [editor, target.filePath]
}

export function displayFileTarget(target: FileTarget, cwd = process.cwd()): string {
  const relative = path.relative(cwd, target.filePath)
  const displayPath = relative && !relative.startsWith(`..${path.sep}`) && relative !== ".."
    ? relative
    : target.filePath
  return `${displayPath}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ""}` : ""}`
}
