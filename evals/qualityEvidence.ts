import type {
  ComputedEvidence,
  VisualEvidence,
} from "../artifacts/api-server/src/lib/evidence";

/**
 * Quality-first, text-only input for the parallel V2 reasoners.
 *
 * It intentionally preserves every extracted fact and computation. The only
 * omitted fields are spatial coordinates, because the reasoners do not see the
 * image and do not make localization decisions. Region ids and descriptions
 * retain the semantic link needed by the final image-aware synthesizer.
 */
export interface SocraticQualityPacket {
  image_type: string;
  apparent_purpose: string;
  visual_structure: string;
  regions: Array<{
    id: string;
    label: string;
    visible_content: string;
    confidence: number;
  }>;
  numeric_facts: VisualEvidence["numeric_facts"];
  categorical_facts: VisualEvidence["categorical_facts"];
  structural_observations: VisualEvidence["structural_observations"];
  relationships: VisualEvidence["relationships"];
  computations: ComputedEvidence[];
}

export function createSocraticQualityPacket(
  evidence: VisualEvidence,
  computed: ComputedEvidence[],
): SocraticQualityPacket {
  return {
    image_type: evidence.image_type,
    apparent_purpose: evidence.apparent_purpose,
    visual_structure: evidence.visual_structure,
    regions: evidence.candidate_regions.map((region) => ({
      id: region.id,
      label: region.label,
      visible_content: region.visible_content,
      confidence: region.confidence,
    })),
    numeric_facts: evidence.numeric_facts,
    categorical_facts: evidence.categorical_facts,
    structural_observations: evidence.structural_observations,
    relationships: evidence.relationships,
    computations: computed,
  };
}

export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
