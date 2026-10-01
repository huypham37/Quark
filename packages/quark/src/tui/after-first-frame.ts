export interface FirstFrameRenderer {
  addPostProcessFn(callback: () => void): void
  removePostProcessFn(callback: () => void): void
}

/** Yield until the first frame has been flushed before doing synchronous startup work. */
export function afterFirstFrame(renderer: FirstFrameRenderer, callback: () => void): () => void {
  let pending = true
  let immediate: ReturnType<typeof setImmediate> | undefined
  const onFrame = () => {
    if (!pending) return
    pending = false
    renderer.removePostProcessFn(onFrame)
    // Post-process callbacks run before the native flush. The next event-loop
    // turn is therefore essential: doing the work here would still block it.
    immediate = setImmediate(callback)
  }
  renderer.addPostProcessFn(onFrame)
  return () => {
    pending = false
    renderer.removePostProcessFn(onFrame)
    if (immediate) clearImmediate(immediate)
  }
}
