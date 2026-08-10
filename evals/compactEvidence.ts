import type {
  ComputedEvidence,
  VisualEvidence,
} from "../artifacts/api-server/src/lib/evidence";

export interface CompactEvidencePack {
  visual_type: string;
  purpose: string;
  regions: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible_content: string;
    confidence: number;
  }>;
  numeric_facts: Array<{
    id: string;
    region_id: string | null;
    subject: string;
    value: number;
    unit: string;
    qualifier: string | null;
    comparison_group: string | null;
    is_total: boolean;
    confidence: number;
  }>;
  categorical_facts: Array<{
    id: string;
    region_id: string | null;
    subject: string;
    state: string;
    confidence: number;
  }>;
  structural_observations: Array<{
    id: string;
    region_id: string | null;
    observation: string;
    confidence: number;
  }>;
  relationships: Array<{
    id: string;
    from_region_id: string | null;
    to_region_id: string | null;
    relationship: string;
    supporting_fact_ids: string[];
    confidence: number;
  }>;
  computations: Array<{
    id: string;
    type: string;
    description: string;
    supporting_fact_ids: string[];
    confidence: number;
  }>;
}

function strongest<T extends { confidence: number }>(
  values: T[],
  minimum: number,
  limit: number,
): T[] {
  return values
    .filter((value) => value.confidence >= minimum)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** Deterministic, benchmark-agnostic projection for downstream reasoning. */
export function compactEvidence(
  evidence: VisualEvidence,
  computed: ComputedEvidence[],
): CompactEvidencePack {
  return {
    visual_type: evidence.image_type,
    purpose: evidence.apparent_purpose,
    regions: evidence.candidate_regions.map((region) => ({
      id: region.id,
      label: region.label,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      visible_content: region.visible_content,
      confidence: region.confidence,
    })),
    numeric_facts: strongest(evidence.numeric_facts, 0.7, 30).map((fact) => ({
      id: fact.id,
      region_id: fact.region_id,
      subject: fact.subject,
      value: fact.value,
      unit: fact.unit,
      qualifier: fact.qualifier,
      comparison_group: fact.comparison_group,
      is_total: fact.is_total,
      confidence: fact.confidence,
    })),
    categorical_facts: strongest(evidence.categorical_facts, 0.7, 20).map(
      (fact) => ({
        id: fact.id,
        region_id: fact.region_id,
        subject: fact.subject,
        state: fact.category_or_state,
        confidence: fact.confidence,
      }),
    ),
    structural_observations: strongest(
      evidence.structural_observations,
      0.65,
      12,
    ).map((item) => ({
      id: item.id,
      region_id: item.region_id,
      observation: item.observation,
      confidence: item.confidence,
    })),
    relationships: strongest(evidence.relationships, 0.65, 12).map(
      (relationship) => ({
        id: relationship.id,
        from_region_id: relationship.from_region_id,
        to_region_id: relationship.to_region_id,
        relationship: relationship.relationship,
        supporting_fact_ids: relationship.supporting_fact_ids,
        confidence: relationship.confidence,
      }),
    ),
    computations: strongest(computed, 0.65, 20).map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      supporting_fact_ids: item.supporting_fact_ids,
      confidence: item.confidence,
    })),
  };
}

export function evidenceCompressionMetrics(
  evidence: VisualEvidence,
  computed: ComputedEvidence[],
  compact: CompactEvidencePack,
): { full_evidence_bytes: number; compact_evidence_bytes: number; compression_ratio: number } {
  const full = Buffer.byteLength(JSON.stringify({ evidence, computed }));
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  return {
    full_evidence_bytes: full,
    compact_evidence_bytes: compactBytes,
    compression_ratio: full === 0 ? 1 : compactBytes / full,
  };
}
