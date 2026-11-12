export { normalizeText, calculateJaroWinklerSimilarity } from './text/index.js';
export { AlgorithmRegistry } from './registry/AlgorithmRegistry.js';
export { AlgorithmChain } from './pipeline/AlgorithmChain.js';
export { AlgorithmPipelineBuilder } from './pipeline/AlgorithmPipelineBuilder.js';
export {
  normalizeMedicineKey, normalizeSimilarityText, levenshteinRatio, tokenSortRatio,
  characterNgrams, buildNameNgramIdf, tfIdfNgramCosine, charNgramDice,
  fieldSimilarity, normalizeStrength, normalizeDosageForm
} from './catalogue/similarity.js';
