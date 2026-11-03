// Quality controls whether the AO pass runs. Its artistic strength belongs to
// the validated style and must survive quality changes / style round trips.
export function applyPipelineQuality(pipeline, budget) {
  if (pipeline.ink) pipeline.ink.aoEnabled = budget.aoQuality > 0;
}
