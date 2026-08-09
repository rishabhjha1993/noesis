import type { ComputedEvidence, NumericFact, VisualEvidence } from "./evidence";

/**
 * Pure deterministic numeric analysis over Pass 1 evidence.
 * No LLM calls, no side effects.
 *
 * Safety model: calculations are generated ONLY within an explicit
 * comparison_group assigned by Pass 1 (facts the visual itself frames as
 * directly comparable) AND with matching units. Unit text alone is never
 * treated as sufficient compatibility.
 */

const MIN_CONFIDENCE = 0.5;
const MAX_PER_TYPE = 12;

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function usable(facts: NumericFact[]): NumericFact[] {
  return facts.filter(
    (f) =>
      Number.isFinite(f.value) &&
      f.confidence >= MIN_CONFIDENCE &&
      f.comparison_group !== null &&
      f.comparison_group.trim() !== "",
  );
}

/** Group by explicit comparison_group + normalized unit. */
function groupComparable(facts: NumericFact[]): Map<string, NumericFact[]> {
  const groups = new Map<string, NumericFact[]>();
  for (const f of facts) {
    const unit = f.unit.trim().toLowerCase();
    if (!unit) continue;
    const key = `${f.comparison_group!.trim().toLowerCase()}::${unit}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  return groups;
}

function pairConfidence(a: NumericFact, b: NumericFact): number {
  return round(Math.min(a.confidence, b.confidence), 2);
}

/**
 * Parse a qualifier into an orderable number (year, temperature level,
 * plain number). Returns null when no reliable ordering exists.
 */
function qualifierOrder(qualifier: string | null): number | null {
  if (!qualifier) return null;
  const m = qualifier.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Ratios and differences between the most significant comparable facts. */
function ratiosAndDifferences(
  group: NumericFact[],
  unit: string,
  out: ComputedEvidence[],
): void {
  const nonTotals = group.filter((f) => !f.is_total);
  const sorted = [...nonTotals].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 6);
  let ratios = 0;
  let diffs = 0;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]!;
      const b = top[j]!;
      if (b.value > 0 && a.value !== b.value && ratios < MAX_PER_TYPE) {
        const r = a.value / b.value;
        out.push({
          id: `ratio-${a.id}-${b.id}`,
          type: "ratio",
          description: `${a.subject} is ${round(r, 2)}x ${b.subject} (${a.value} vs ${b.value} ${unit})`,
          value: round(r),
          unit: null,
          formula: `${a.value} / ${b.value} = ${round(r)}`,
          supporting_fact_ids: [a.id, b.id],
          confidence: pairConfidence(a, b),
        });
        ratios++;
      }
      if (diffs < MAX_PER_TYPE) {
        const d = a.value - b.value;
        out.push({
          id: `diff-${a.id}-${b.id}`,
          type: "difference",
          description: `${a.subject} exceeds ${b.subject} by ${round(d, 2)} ${unit}`,
          value: round(d),
          unit,
          formula: `${a.value} - ${b.value} = ${round(d)}`,
          supporting_fact_ids: [a.id, b.id],
          confidence: pairConfidence(a, b),
        });
        diffs++;
      }
    }
  }
}

/** Percentage shares of components against an explicitly labelled total. */
function shares(group: NumericFact[], unit: string, out: ComputedEvidence[]): void {
  const totals = group.filter((f) => f.is_total);
  const components = group.filter((f) => !f.is_total);
  let count = 0;
  for (const total of totals) {
    if (total.value <= 0) continue;
    for (const c of components) {
      if (c.value < 0 || c.value > total.value || count >= MAX_PER_TYPE) continue;
      const share = c.value / total.value;
      out.push({
        id: `share-${c.id}-${total.id}`,
        type: "percentage_share",
        description: `${c.subject} is about ${round(share * 100, 1)}% of ${total.subject} (${c.value} of ${total.value} ${unit})`,
        value: round(share),
        unit: null,
        formula: `${c.value} / ${total.value} = ${round(share)}`,
        supporting_fact_ids: [c.id, total.id],
        confidence: pairConfidence(c, total),
      });
      count++;
    }
  }
}

/**
 * Percentage / multiplicative change between facts sharing a subject whose
 * qualifiers carry a reliable numeric ordering (years, temperature levels).
 * Pairs without an orderable qualifier are omitted entirely.
 */
function changes(group: NumericFact[], unit: string, out: ComputedEvidence[]): void {
  const bySubject = new Map<string, NumericFact[]>();
  for (const f of group) {
    if (f.is_total || qualifierOrder(f.qualifier) === null) continue;
    const key = f.subject.trim().toLowerCase();
    const list = bySubject.get(key);
    if (list) list.push(f);
    else bySubject.set(key, [f]);
  }
  let count = 0;
  for (const facts of bySubject.values()) {
    if (facts.length < 2) continue;
    const ordered = [...facts].sort(
      (a, b) => qualifierOrder(a.qualifier)! - qualifierOrder(b.qualifier)!,
    );
    for (let i = 0; i < ordered.length - 1 && count < MAX_PER_TYPE; i++) {
      const a = ordered[i]!;
      const b = ordered[i + 1]!;
      if (qualifierOrder(a.qualifier) === qualifierOrder(b.qualifier)) continue;
      if (a.value !== 0) {
        const pct = (b.value - a.value) / a.value;
        out.push({
          id: `change-${a.id}-${b.id}`,
          type: "percentage_change",
          description: `${a.subject} changes ${round(pct * 100, 1)}% from ${a.qualifier} (${a.value} ${unit}) to ${b.qualifier} (${b.value} ${unit})`,
          value: round(pct),
          unit: null,
          formula: `(${b.value} - ${a.value}) / ${a.value} = ${round(pct)}`,
          supporting_fact_ids: [a.id, b.id],
          confidence: pairConfidence(a, b),
        });
        count++;
      }
      if (a.value > 0 && b.value > 0 && count < MAX_PER_TYPE) {
        const mult = b.value / a.value;
        out.push({
          id: `mult-${a.id}-${b.id}`,
          type: "multiplicative_change",
          description: `${a.subject} is ${round(mult, 2)}x from ${a.qualifier} to ${b.qualifier}`,
          value: round(mult),
          unit: null,
          formula: `${b.value} / ${a.value} = ${round(mult)}`,
          supporting_fact_ids: [a.id, b.id],
          confidence: pairConfidence(a, b),
        });
        count++;
      }
    }
  }
}

/** Ranking (largest/smallest) and spread within a comparable group. */
function rankingAndSpread(
  group: NumericFact[],
  unit: string,
  out: ComputedEvidence[],
): void {
  const nonTotals = group.filter((f) => !f.is_total);
  if (nonTotals.length < 3) return;
  const sorted = [...nonTotals].sort((a, b) => b.value - a.value);
  const max = sorted[0]!;
  const min = sorted[sorted.length - 1]!;
  out.push({
    id: `rank-max-${max.id}`,
    type: "ranking",
    description: `${max.subject} is the largest comparable value shown (${max.value} ${unit}); ${min.subject} is the smallest (${min.value} ${unit})`,
    value: max.value,
    unit,
    formula: `max(${sorted.map((f) => f.value).join(", ")}) = ${max.value}`,
    supporting_fact_ids: [max.id, min.id],
    confidence: pairConfidence(max, min),
  });
  const spread = max.value - min.value;
  out.push({
    id: `spread-${max.id}-${min.id}`,
    type: "range_spread",
    description: `Comparable values span ${round(spread, 2)} ${unit}, from ${min.value} (${min.subject}) to ${max.value} (${max.subject})`,
    value: round(spread),
    unit,
    formula: `${max.value} - ${min.value} = ${round(spread)}`,
    supporting_fact_ids: [max.id, min.id],
    confidence: pairConfidence(max, min),
  });
}

const MAX_TOTAL = 60;

export function computeEvidence(evidence: VisualEvidence): ComputedEvidence[] {
  const facts = usable(evidence.numeric_facts);
  const out: ComputedEvidence[] = [];
  for (const [key, group] of groupComparable(facts)) {
    if (group.length < 2) continue;
    const unit = key.split("::")[1] ?? "";
    ratiosAndDifferences(group, unit, out);
    shares(group, unit, out);
    changes(group, unit, out);
    rankingAndSpread(group, unit, out);
  }
  // Prefer higher-confidence computations if we overflow.
  return out
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TOTAL);
}
