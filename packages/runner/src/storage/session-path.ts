// Session storage path resolution
//
// All session data lives under a single root directory:
//   ~/.config/quark/session/<session-id>/
//     session.jsonl   — append-only event log
//     meta.json       — derived cache for fast listing
//
// The root can be overridden for tests via setSessionStorageRoot().

import { join } from "node:path"
import { homedir } from "node:os"

// ---------------------------------------------------------------------------
// Storage root — default: ~/.config/quark/session
// ---------------------------------------------------------------------------

const DEFAULT_ROOT = join(homedir(), ".config", "quark", "session")

let storageRoot: string = DEFAULT_ROOT

/**
 * Get the current session storage root directory.
 */
export function getSessionStorageRoot(): string {
  return storageRoot
}

/**
 * Override the session storage root (for tests).
 * Pass `undefined` to reset to the default.
 */
export function setSessionStorageRoot(root: string | undefined): void {
  storageRoot = root ?? DEFAULT_ROOT
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Get the directory for a specific session.
 * e.g. ~/.config/quark/session/abc123/
 */
export function getSessionDir(sessionId: string): string {
  return join(storageRoot, sessionId)
}

/**
 * Get the path to a session's JSONL log file.
 * e.g. ~/.config/quark/session/abc123/session.jsonl
 */
export function getSessionLogPath(sessionId: string): string {
  return join(storageRoot, sessionId, "session.jsonl")
}

/**
 * Get the path to a session's meta.json file.
 * e.g. ~/.config/quark/session/abc123/meta.json
 */
export function getSessionMetaPath(sessionId: string): string {
  return join(storageRoot, sessionId, "meta.json")
}

/** Get the aggregate session metadata index path. */
export function getSessionIndexPath(): string {
  return join(storageRoot, "index.json")
}
