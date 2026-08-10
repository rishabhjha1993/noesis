import { createHash } from "node:crypto";
import {
  DISCOVERY_ENGINE_VERSION,
  type DiscoveryPipelineResult,
} from "./discoveryPipeline";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;

interface CacheEntry {
  createdAt: number;
  result: DiscoveryPipelineResult;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DiscoveryPipelineResult>>();

export function computeDiscoveryCacheKey(
  imageDataUrl: string,
  engineVersion = DISCOVERY_ENGINE_VERSION,
): {
  cacheKey: string;
  imageHash: string;
} {
  const commaIndex = imageDataUrl.indexOf(",");
  const base64 =
    commaIndex >= 0 ? imageDataUrl.slice(commaIndex + 1) : imageDataUrl;
  const imageHash = createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex");
  return {
    cacheKey: `${engineVersion}:${imageHash}`,
    imageHash,
  };
}

function sweep(now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > CACHE_TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function getOrComputeDiscovery(
  cacheKey: string,
  compute: () => Promise<DiscoveryPipelineResult>,
): Promise<{ result: DiscoveryPipelineResult; cacheHit: boolean }> {
  sweep();
  const cached = cache.get(cacheKey);
  if (cached) return { result: cached.result, cacheHit: true };

  const active = inFlight.get(cacheKey);
  if (active) return { result: await active, cacheHit: false };

  const promise = compute().then((result) => {
    cache.set(cacheKey, { createdAt: Date.now(), result });
    sweep();
    return result;
  });
  inFlight.set(cacheKey, promise);
  try {
    return { result: await promise, cacheHit: false };
  } finally {
    inFlight.delete(cacheKey);
  }
}
