// model-cycle — pure functions for Tab/Shift+Tab model cycling
//
// Given a list of models and the current model ID, returns the next or
// previous model ID in the list (wrapping around). Returns null if cycling
// is not possible (0 or 1 models).

export function getNextModel(
  models: { id: string; name: string }[],
  currentModelId: string,
): string | null {
  if (models.length <= 1) return null
  const currentIndex = models.findIndex((m) => m.id === currentModelId)
  const nextIndex = (currentIndex + 1) % models.length
  return models[nextIndex]!.id
}

export function getPrevModel(
  models: { id: string; name: string }[],
  currentModelId: string,
): string | null {
  if (models.length <= 1) return null
  const currentIndex = models.findIndex((m) => m.id === currentModelId)
  const prevIndex = (currentIndex - 1 + models.length) % models.length
  return models[prevIndex]!.id
}
