import { stableRandom } from './osm.js';

// Illustrative planting proportions, not a survey of local species.
export const VEGETATION_MIX = Object.freeze({
  woodland: .38, 'park-belt': .30, 'lawn-edge': .12,
  'garden-court': .26, 'pocket-common': .32, forecourt: .14, verge: .08,
});
const needle = shape => shape === 'conifer' || shape === 'cypress';

export function chooseTreeHabit({tags={},context='',group='',patch='',key='',seed=1,fallback='spreading',mix={}}={}) {
  const botanical = [tags.genus,tags.species,tags['species:en'],tags['species:zh'],tags.taxon].filter(Boolean).join(' ').toLowerCase();
  const spire = /\b(cupressus|juniperus|thuja|platycladus|cypress)\b|侧柏|圆柏|桧柏/.test(botanical);
  const pyramidal = /\b(picea|abies|cedrus|pinus|larix|spruce|fir|cedar|pine)\b|云杉|冷杉|雪松|油松|落叶松/.test(botanical);
  const broad = /\b(quercus|acer|platanus|populus|salix|tilia|ginkgo|sophora|styphnolobium|robinia)\b|银杏|国槐|悬铃木/.test(botanical);
  const patchRandom=stableRandom(`vegetation:${group}:${patch}:${seed}`), variant=patchRandom();
  const selectedNeedle=spire?'cypress':pyramidal?'conifer':variant<.52?'cypress':'conifer';
  const broadFallback=needle(fallback)?'round':fallback;
  if(tags.leaf_type==='broadleaved')return {shape:broadFallback,habitSource:'osm-leaf-type'};
  if(tags.leaf_type==='needleleaved')return {shape:selectedNeedle,habitSource:'osm-leaf-type'};
  if(spire||pyramidal)return {shape:selectedNeedle,habitSource:'osm-taxon'};
  if(broad)return {shape:broadFallback,habitSource:'osm-taxon'};
  // Evergreen describes leaf persistence, and is deliberately not a needle test.
  if(needle(fallback))return {shape:fallback,habitSource:'explicit-shape'};
  const proportion=tags.leaf_type==='mixed'?.48:(mix[context]??VEGETATION_MIX[context]??0);
  const chance=Math.max(0,Math.min(1,Number.isFinite(proportion)?proportion:0));
  // One decision per short planting patch preserves groves/rows; individual
  // crowns still vary via their own key. No absolute coordinates enter this rule.
  const chosen=patchRandom()<chance;
  return {shape:chosen?selectedNeedle:broadFallback,habitSource:tags.leaf_type==='mixed'?'osm-mixed-illustration':'context-illustration'};
}
