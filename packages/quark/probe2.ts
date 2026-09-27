import { createRuntimeProviderRegistry } from "@quark/runner/provider/resolver"
import { createDefaultCredentialStore } from "@quark/runner/provider/credential-store"
import { DefaultCredentialResolver } from "@quark/runner/provider/credentials"
import { loadOAuthTokenFile } from "@quark/runner/provider/oauth-token-files"

const registry = createRuntimeProviderRegistry()
const ids = registry.list().map((r) => r.definition.id)
console.log("registered:", ids.join(","))
console.log("agy registered?", ids.includes("agy"))

const agy = registry.get("agy")
if (agy) {
  console.log("agy catalogProviderId:", agy.definition.catalogProviderId)
  const store = await createDefaultCredentialStore()
  const cred: any = await store.get("agy")
  console.log("stored expiresAt delta(s):", cred?.expiresAt ? Math.round((cred.expiresAt - Date.now()) / 1000) : null)
  const resolver = new DefaultCredentialResolver(store, undefined, process.env, loadOAuthTokenFile)
  const status = await resolver.status({ provider: agy.definition as any, source: { source: "auto" } })
  console.log("status:", JSON.stringify(status))
}
