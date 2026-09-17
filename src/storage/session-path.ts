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

/** Socket used to stream live events to local session observers. */
export function getLiveSessionSocketPath(sessionId: string): string {
  return join(storageRoot, sessionId, "live.sock")
}

/**
 * Directory holding supervisor sockets, addressed by a supervisor-chosen tag.
 *
 * Inside the storage root on purpose: `setSessionStorageRoot()` then isolates
 * these sockets too, so a test never touches the real `~/.config`.
 *
 * Session enumeration tolerates it — `scanSessionMetaFiles()` skips any entry
 * without a readable `meta.json`.
 */
export function getLiveSupervisorDir(): string {
  return join(storageRoot, "live")
}

/**
 * Socket a supervisor connects to, named by the tag it supplied.
 *
 * Returns `null` for a tag that cannot be a single path component. Rejected
 * rather than sanitised: stripping characters would let two different tags
 * collapse onto one path, and a supervisor that misspells its tag would be
 * silently talking to somebody else's socket.
 *
 * The tag arrives from outside the process (`QUARK_SESSION_TAG`), so it is
 * untrusted — `../` must not be able to escape this directory.
 */
export function getLiveSupervisorSocketPath(tag: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(tag) || tag === "." || tag === "..") return null
  return join(getLiveSupervisorDir(), `${tag}.sock`)
}

/** Get the aggregate session metadata index path. */
export function getSessionIndexPath(): string {
  return join(storageRoot, "index.json")
}
