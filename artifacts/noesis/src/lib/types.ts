export interface NoesisRegion {
  id: string;
  label: string;
  /** Normalized 0-1, fraction of image width from the left edge. */
  x: number;
  /** Normalized 0-1, fraction of image height from the top edge. */
  y: number;
  /** Normalized 0-1, fraction of image width. */
  width: number;
  /** Normalized 0-1, fraction of image height. */
  height: number;
  sequence_order: number;
  explanation: string;
  why_it_matters: string;
  related_region_ids: string[];
  relationship_explanation: string;
  /** 0-1 confidence score from the analysis. */
  confidence: number;
}

export interface NoesisAnalysis {
  title: string;
  image_type: string;
  central_question: string;
  overall_summary: string;
  big_takeaway: string;
  regions: NoesisRegion[];
}

export type NoesisScreen = "upload" | "loading" | "result";
