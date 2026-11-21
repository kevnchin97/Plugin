import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env as hf,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  RawImage,
} from "@xenova/transformers";
import { CLIP_DIMENSIONS, CLIP_MODEL } from "@innovate/shared";
import { env } from "./env";

/**
 * CLIP ViT-B/32 (transformers.js, ONNX on the CPU). The image and text towers share one embedding
 * space, so a text query ranks images by cosine similarity. Quantised weights (~150 MB) download from the
 * Hugging Face hub on first use into MODEL_CACHE_DIR; Node's fetch needs NODE_USE_ENV_PROXY=1 behind
 * an HTTP proxy (the worker scripts set it).
 */
hf.cacheDir = env.MODEL_CACHE_DIR;
hf.allowLocalModels = false;

let vision: Promise<{ processor: Processor; model: PreTrainedModel }> | null = null;
let text: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function visionTower() {
  vision ??= Promise.all([AutoProcessor.from_pretrained(CLIP_MODEL), CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL)]).then(
    ([processor, model]) => ({ processor, model }),
  );
  vision.catch(() => (vision = null));
  return vision;
}

function textTower() {
  text ??= Promise.all([AutoTokenizer.from_pretrained(CLIP_MODEL), CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL)]).then(
    ([tokenizer, model]) => ({ tokenizer, model }),
  );
  text.catch(() => (text = null));
  return text;
}

export function normalize(v: ArrayLike<number>): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

/** L2-normalised embedding of an image file (JPEG, PNG, WebP; a GIF's first frame). */
export async function embedImageFile(file: string): Promise<number[]> {
  const { processor, model } = await visionTower();
  const image = await RawImage.read(file);
  const { image_embeds } = await model(await processor(image));
  return normalize((image_embeds as { data: Float32Array }).data.slice(0, CLIP_DIMENSIONS));
}

/** L2-normalised text embeddings (CLIP truncates to 77 tokens). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { tokenizer, model } = await textTower();
  const { text_embeds } = await model(tokenizer(texts, { padding: true, truncation: true }));
  const data = (text_embeds as { data: Float32Array }).data;
  return texts.map((_, i) => normalize(data.slice(i * CLIP_DIMENSIONS, (i + 1) * CLIP_DIMENSIONS)));
}

/** Load both towers ahead of the first search, so it doesn't pay the ~5 s model load. */
export async function warmClip() {
  await Promise.all([visionTower(), textTower()]);
}

/** Mean of normalised vectors, renormalised (the reference-level embedding). */
export function meanVector(vectors: number[][]): number[] {
  const out = new Array<number>(CLIP_DIMENSIONS).fill(0);
  for (const v of vectors) for (let i = 0; i < CLIP_DIMENSIONS; i++) out[i]! += v[i]!;
  return normalize(out);
}
