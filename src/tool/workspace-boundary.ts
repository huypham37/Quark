// Workspace boundary — classify tool access and extract resource paths
//
// Used by the tool adapter to pass real file paths (instead of "*")
// to the permission system, so external access triggers a TUI prompt.

import { isAbsolute, resolve } from "node:path";
import { relative } from "node:path";

// ---------------------------------------------------------------------------
// Access type classification
// ---------------------------------------------------------------------------

/** What kind of access a tool performs on the filesystem. */
export type AccessType = "read" | "write";

/** Map tool ID → access type. */
const ACCESS_TYPES: Record<string, AccessType> = {
  read: "read",
  look: "read",
  grep: "read",
  glob: "read",
  write: "write",
  edit: "write",
  bash: "write",
};

/** Get the access type for a tool, or null if not filesystem-related. */
export function getAccessType(toolId: string): AccessType | null {
  return ACCESS_TYPES[toolId] ?? null;
}

// ---------------------------------------------------------------------------
// Path extraction
// ---------------------------------------------------------------------------

/**
 * Extract a canonical absolute resource path from parsed tool arguments.
 * Returns the resolved absolute path, or null if the tool has no
 * identifiable filesystem target.
 *
 * For tools with an optional directory parameter (grep, glob), returns
 * null when the parameter is omitted (the tool defaults to cwd, which
 * is inside the workspace).
 */
export function extractResourcePath(
  toolId: string,
  args: Record<string, unknown>,
): string | null {
  switch (toolId) {
    case "read":
    case "look":
      return extractPathArg(args, "path");

    case "write":
    case "edit":
      // Prefer `path` (reference convention), fall back to `filePath` (legacy)
      return extractPathArg(args, "path") ?? extractPathArg(args, "filePath");

    case "grep":
    case "glob": {
      const p = extractPathArg(args, "path");
      return p ?? null; // null when omitted — defaults to cwd (inside workspace)
    }

    default:
      return null;
  }
}

function extractPathArg(
  args: Record<string, unknown>,
  key: string,
): string | null {
  const val = args[key];
  if (typeof val !== "string" || val.length === 0) return null;
  // Resolve relative paths against cwd to get a canonical absolute path
  return isAbsolute(val) ? val : resolve(process.cwd(), val);
}

// ---------------------------------------------------------------------------
// Boundary check
// ---------------------------------------------------------------------------

/**
 * Check whether a canonical absolute path falls inside the workspace root.
 */
export function isInsideWorkspace(absPath: string, workspaceRoot?: string): boolean {
  const root = workspaceRoot ?? process.cwd();
  const rel = relative(root, absPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
}
