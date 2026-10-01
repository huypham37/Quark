import { createEffect, onCleanup } from "solid-js"
import type { CatalogModel } from "@quark/runner/provider/catalog-snapshot"
import type { TypedBus } from "@quark/runner/session/events"
import type { AppState } from "./state"

/** Catalog replacement is not reactive: refresh context limits on its bus event too. */
export function bindCatalogContext(
  state: AppState,
  bus: TypedBus,
  getCatalogModel?: (spec: string) => CatalogModel | null,
): void {
  const update = () => {
    const model = getCatalogModel?.(state.store.status.modelName)
    const limit = model?.limit.context ?? model?.limit.input
    if (limit) state.setStore("status", "tokenLimit", limit)
  }
  createEffect(update)
  bus.on("catalog-refreshed", update)
  onCleanup(() => bus.off("catalog-refreshed", update))
}
