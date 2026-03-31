// model-cycle — pure function for Tab-to-next-model cycling
//
// Given a list of models and the current model ID, returns the next
// model ID in the list (wrapping around). Returns null if cycling
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
