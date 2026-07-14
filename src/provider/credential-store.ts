import { execFile } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { access, chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { promisify } from "node:util"
import type { Credential } from "./credentials"

export type CredentialStoreStatus = "present" | "missing" | "unavailable"

export interface CredentialStore {
  get(providerId: string): Promise<Credential | null>
  set(providerId: string, credential: Credential): Promise<void>
  delete(providerId: string): Promise<void>
  status(providerId: string): Promise<CredentialStoreStatus>
}

function validateProviderId(providerId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) {
    throw new Error(`Invalid credential provider ID "${providerId}".`)
  }
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false
  const credential = value as Partial<Credential>
  if (credential.type === "api-key") return typeof credential.value === "string"
  return credential.type === "oauth" && typeof credential.access === "string"
}

/** Permission-protected fallback store. It is not encrypted at rest. */
export class ProtectedFileCredentialStore implements CredentialStore {
  constructor(
    private readonly directory = join(homedir(), ".config", "quark", "credentials"),
  ) {}

  private file(providerId: string): string {
    validateProviderId(providerId)
    return join(this.directory, `${providerId}.json`)
  }

  async get(providerId: string): Promise<Credential | null> {
    const file = this.file(providerId)
    try {
      const info = await stat(file)
      if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
        throw new Error(`Credential file for "${providerId}" has unsafe permissions; expected mode 0600.`)
      }
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
      if (!isCredential(parsed)) throw new Error(`Credential file for "${providerId}" is invalid.`)
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async set(providerId: string, credential: Credential): Promise<void> {
    const file = this.file(providerId)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") await chmod(this.directory, 0o700)

    const temporary = join(
      dirname(file),
      `.${providerId}.${process.pid}.${crypto.randomUUID()}.tmp`,
    )
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
      await handle.writeFile(JSON.stringify(credential), "utf8")
      await handle.sync()
      await handle.close()
      handle = undefined
      if (process.platform !== "win32") await chmod(temporary, 0o600)
      await rename(temporary, file)
    } finally {
      await handle?.close().catch(() => {})
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  async delete(providerId: string): Promise<void> {
    await rm(this.file(providerId), { force: true })
  }

  async status(providerId: string): Promise<CredentialStoreStatus> {
    try {
      return (await this.get(providerId)) ? "present" : "missing"
    } catch {
      return "unavailable"
    }
  }
}

const execFileAsync = promisify(execFile)

/** macOS Keychain backend using the system `security` command. */
export class MacOSKeychainCredentialStore implements CredentialStore {
  constructor(private readonly service = "com.quark.credentials") {}

  private async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("security", args, { encoding: "utf8" })
    return stdout
  }

  async get(providerId: string): Promise<Credential | null> {
    validateProviderId(providerId)
    try {
      const output = await this.run(["find-generic-password", "-s", this.service, "-a", providerId, "-w"])
      const parsed: unknown = JSON.parse(output.trim())
      if (!isCredential(parsed)) throw new Error(`Keychain credential for "${providerId}" is invalid.`)
      return parsed
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 44) return null
      throw error
    }
  }

  async set(providerId: string, credential: Credential): Promise<void> {
    validateProviderId(providerId)
    await this.run([
      "add-generic-password", "-U", "-s", this.service, "-a", providerId,
      "-w", JSON.stringify(credential),
    ])
  }

  async delete(providerId: string): Promise<void> {
    validateProviderId(providerId)
    try {
      await this.run(["delete-generic-password", "-s", this.service, "-a", providerId])
    } catch (error) {
      if ((error as { code?: number }).code !== 44) throw error
    }
  }

  async status(providerId: string): Promise<CredentialStoreStatus> {
    try {
      return (await this.get(providerId)) ? "present" : "missing"
    } catch {
      return "unavailable"
    }
  }
}

export async function createDefaultCredentialStore(): Promise<CredentialStore> {
  if (process.platform === "darwin") {
    try {
      await access("/usr/bin/security", fsConstants.X_OK)
      return new MacOSKeychainCredentialStore()
    } catch {}
  }
  return new ProtectedFileCredentialStore()
}
