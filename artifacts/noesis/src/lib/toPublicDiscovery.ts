import type {
  Discovery,
  DiscoveryRegion,
  DiscoveryRunResult,
} from "@workspace/api-client-react";

export interface PublicDiscoveryRegion {
  /** Percentage coordinates in the original image, with a top-left origin. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PublicDiscoverySource {
  url: string;
  displayDomain: string;
}

export interface PublicDiscoveryItem {
  id: string;
  title: string;
  lede: string;
  detail: string[];
  regions: PublicDiscoveryRegion[];
  sources: PublicDiscoverySource[];
}

export interface PublicDiscoveryViewModel {
  discoveries: PublicDiscoveryItem[];
}

export type PublicDiscoverySourceResult = Pick<
  DiscoveryRunResult,
  "regions" | "discoveries"
>;

const PUBLIC_LEDE_WORD_TARGET = 45;

function normalizeCopy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function sentenceBoundedLede(value: string): string {
  const normalized = normalizeCopy(value);
  const sentences = normalized.split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (
    sentences.length <= 1 ||
    wordCount(normalized) <= PUBLIC_LEDE_WORD_TARGET
  ) {
    return normalized;
  }

  const selected: string[] = [];
  let selectedWords = 0;
  for (const sentence of sentences) {
    const nextWords = wordCount(sentence);
    if (
      selected.length > 0 &&
      selectedWords + nextWords > PUBLIC_LEDE_WORD_TARGET
    ) {
      break;
    }
    selected.push(sentence);
    selectedWords += nextWords;
    if (selectedWords >= PUBLIC_LEDE_WORD_TARGET) break;
  }
  return selected.join(" ");
}

function publicDetail(discovery: Discovery, lede: string): string[] {
  const seen = new Set([normalizeCopy(lede).toLocaleLowerCase()]);
  return [
    discovery.why_it_matters,
    discovery.explanation,
    discovery.reinterpretation,
  ].flatMap((value) => {
    const normalized = normalizeCopy(value);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function publicSources(discovery: Discovery): PublicDiscoverySource[] {
  const seen = new Set<string>();
  return discovery.sources.flatMap((source) => {
    if (seen.has(source.url)) return [];
    seen.add(source.url);
    const domain = new URL(source.url).hostname.replace(/^www\./, "");
    return [{ url: source.url, displayDomain: domain }];
  });
}

function publicRegion(region: DiscoveryRegion): PublicDiscoveryRegion {
  return {
    left: region.x * 100,
    top: region.y * 100,
    width: region.width * 100,
    height: region.height * 100,
  };
}

export function toPublicDiscovery(
  result: PublicDiscoverySourceResult,
): PublicDiscoveryViewModel {
  const regionsById = new Map(
    result.regions.map((region) => [region.id, region]),
  );

  return {
    discoveries: result.discoveries.map((discovery, index) => {
      const regions = discovery.region_ids.map((regionId) => {
        const region = regionsById.get(regionId);
        if (!region) {
          throw new Error("A discovery references unavailable image geometry");
        }
        return publicRegion(region);
      });
      const lede = sentenceBoundedLede(discovery.discovery);
      return {
        id: `discovery-${String(index + 1).padStart(2, "0")}`,
        title: normalizeCopy(discovery.title),
        lede,
        detail: publicDetail(discovery, lede),
        regions,
        sources: publicSources(discovery),
      };
    }),
  };
}

export function aggregateRegionCentroid(regions: PublicDiscoveryRegion[]): {
  x: number;
  y: number;
} {
  if (regions.length === 0) return { x: 50, y: 50 };

  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;
  for (const region of regions) {
    const area = Math.max(region.width * region.height, 0.0001);
    weightedX += (region.left + region.width / 2) * area;
    weightedY += (region.top + region.height / 2) * area;
    totalArea += area;
  }
  return { x: weightedX / totalArea, y: weightedY / totalArea };
}

export function publicTextPlacement(
  regions: PublicDiscoveryRegion[],
): "left" | "right" {
  const centroid = aggregateRegionCentroid(regions);
  return centroid.x < 50 && centroid.y >= 50 ? "right" : "left";
}
