import { Router, type IRouter, type Request } from "express";
import OpenAI from "openai";
import { AnalyzeImageBody, AnalyzeImageResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const openai = new OpenAI(); // reads OPENAI_API_KEY (server-side only)

const NOESIS_PROMPT = `You are Noesis, an AI system that teaches people HOW TO READ complex visuals.

The user has supplied one visual. It may be a chart, Sankey diagram, architecture diagram, dashboard, scientific figure, process flow, map, infographic, slide, form, UI screenshot, network diagram, or another information-dense visual.

Your goal is NOT to describe every visible object.

Your goal is to transform the visual into a guided learning experience.

FIRST analyse the visual as a whole.

Determine:

1. What kind of visual is this?
2. What is its apparent purpose?
3. What central question does it help answer?
4. What are the most important relationships, patterns, flows, comparisons, dependencies, transitions, anomalies, or conclusions?
5. What does a viewer need to notice, and in what order, to build a correct mental model of the visual?

Then construct the Noesis walkthrough.

TITLE
Give the visual a concise descriptive title grounded in what is visible.

IMAGE TYPE
Identify the type of visual.

CENTRAL QUESTION
Write the single most useful question that this visual helps the viewer answer.

OVERALL SUMMARY
In 2-3 concise sentences, explain what the viewer is looking at and how the visual is structured.

BIG TAKEAWAY
State the most important insight that is directly supported by the visual.

REGIONS

Choose exactly 4-6 explanatory regions.

The selected regions must TOGETHER teach the viewer how to understand the whole visual.

Do NOT simply choose the largest objects.

Do NOT simply identify labels.

Do NOT choose six isolated objects when relationships or flows are more important.

Prefer regions representing things such as:

- an important system component
- a major flow or transition
- a meaningful cluster
- a critical comparison
- an important dependency
- a major conversion point
- an anomaly
- a key result
- a necessary legend/axis only when needed to interpret the rest
- an important beginning/end state

The regions should be complementary rather than repetitive.

GUIDED ORDER

sequence_order defines the order in which a good teacher would walk a first-time viewer through this image.

Ask:

'Where should I direct the viewer's attention first?'

Then:

'What should they notice next so the previous point makes more sense?'

Continue until the visual's key insight becomes understandable.

EXPLANATION

For each region:

explanation:
Explain what the viewer should notice here in plain English.

why_it_matters:
Explain why this region is important to understanding the whole visual.

related_region_ids:
Identify other selected regions whose relationship to this region materially helps understanding.

relationship_explanation:
Explain the meaningful relationship between this region and its related regions.

CONFIDENCE

Return confidence from 0 to 1 based on how clearly the interpretation is supported by the image.

GROUNDING RULES

Only make claims supported by the supplied visual.

Do not invent unreadable labels or values.

Do not infer causality unless the visual actually supports it.

Do not use external factual knowledge to fill gaps in the image.

If something is uncertain, say so through lower confidence rather than pretending certainty.

Select regions for EXPLANATORY VALUE, not merely visual salience.

Prefer broad, clickable regions.

The goal is teaching quality, not object detection.

COORDINATES

Coordinates are NORMALIZED between 0 and 1 relative to the entire image:

x = left edge
y = top edge
width = region width
height = region height

All x, y, width, height values must be between 0 and 1.

x + width must not exceed 1.

y + height must not exceed 1.

Prefer BROAD explanatory regions rather than pixel-perfect small boxes.

SUCCESS CRITERION

After completing the guided walkthrough, a viewer who initially found the image confusing should understand:

- what the visual is showing
- how its important parts relate
- how to read it
- what its main insight is.`;

// Strict Structured Outputs schema — mirrors the NoesisAnalysis contract.
// Numeric min/max bounds are enforced post-hoc by the Zod schema instead:
// Structured Outputs only guarantees support for a subset of JSON Schema.
const NOESIS_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "image_type",
    "central_question",
    "overall_summary",
    "big_takeaway",
    "regions",
  ],
  properties: {
    title: { type: "string" },
    image_type: { type: "string" },
    central_question: { type: "string" },
    overall_summary: { type: "string" },
    big_takeaway: { type: "string" },
    regions: {
      type: "array",
      minItems: 4,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "x",
          "y",
          "width",
          "height",
          "sequence_order",
          "explanation",
          "why_it_matters",
          "related_region_ids",
          "relationship_explanation",
          "confidence",
        ],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          sequence_order: { type: "integer" },
          explanation: { type: "string" },
          why_it_matters: { type: "string" },
          related_region_ids: { type: "array", items: { type: "string" } },
          relationship_explanation: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

// 12 MB of decoded image bytes. Base64 inflates ~4/3, so the transport body
// for the largest accepted image is ~16 MB + JSON wrapper; the Express JSON
// limit (25 MB) is deliberately larger so this clean 400 stays reachable.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
// Tolerance for float rounding when checking x + width <= 1.
const BOUNDS_EPSILON = 0.02;
// Upstream deadline: an interactive demo cannot wait on a stalled request.
const ANALYSIS_TIMEOUT_MS = 90_000;
// Lightweight abuse protection for a public, paid-per-call endpoint.
const MAX_CONCURRENT_ANALYSES = 3;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;

let analysesInFlight = 0;
const requestTimestampsByIp = new Map<string, number[]>();

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

const IMAGE_SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) =>
    b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
};

router.post("/analyze", async (req, res) => {
  const now = Date.now();
  const ip = clientIp(req);
  const recent = (requestTimestampsByIp.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      error: "Too many analysis requests. Please wait a few minutes and try again.",
    });
    return;
  }
  if (analysesInFlight >= MAX_CONCURRENT_ANALYSES) {
    res.status(429).json({
      error: "The analyzer is busy with other requests. Please try again shortly.",
    });
    return;
  }
  recent.push(now);
  requestTimestampsByIp.set(ip, recent);

  const parsedBody = AnalyzeImageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error:
        "Invalid request. Expected a base64-encoded PNG, JPEG, or WebP image.",
    });
    return;
  }

  const { image, mediaType } = parsedBody.data;

  // Strict base64: re-encoding the decoded bytes must reproduce the input.
  const normalizedImage = image.replace(/\s/g, "");
  const decoded = Buffer.from(normalizedImage, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== normalizedImage) {
    res.status(400).json({ error: "Image payload is not valid base64." });
    return;
  }
  if (decoded.length > MAX_IMAGE_BYTES) {
    res
      .status(400)
      .json({ error: "Image is too large. Please upload an image under 12 MB." });
    return;
  }
  if (!IMAGE_SIGNATURES[mediaType]?.(decoded)) {
    res.status(400).json({
      error:
        "The image content does not match its declared type. Please upload a PNG, JPEG, or WebP image.",
    });
    return;
  }

  analysesInFlight += 1;
  try {
    const response = await openai.responses.create(
      {
        model: "gpt-5.6-sol",
        reasoning: { effort: "low" },
        max_output_tokens: 8192,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: NOESIS_PROMPT },
              {
                type: "input_image",
                image_url: `data:${mediaType};base64,${normalizedImage}`,
                detail: "original",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "noesis_analysis",
            strict: true,
            schema: NOESIS_ANALYSIS_JSON_SCHEMA,
          },
        },
      },
      { timeout: ANALYSIS_TIMEOUT_MS },
    );

    const outputText = response.output_text;
    if (!outputText) {
      req.log.error("Analysis returned empty output");
      res.status(502).json({
        error: "The analysis came back empty. Please try again.",
      });
      return;
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(outputText);
    } catch {
      req.log.error("Analysis output was not valid JSON");
      res.status(502).json({
        error: "The analysis could not be read. Please try again.",
      });
      return;
    }

    const parsedAnalysis = AnalyzeImageResponse.safeParse(rawJson);
    if (!parsedAnalysis.success) {
      req.log.error(
        { issues: parsedAnalysis.error.issues },
        "Analysis output failed contract validation",
      );
      res.status(502).json({
        error:
          "The analysis did not match the expected format. Please try again.",
      });
      return;
    }

    const analysis = parsedAnalysis.data;

    // Enforce the normalized-coordinate contract; clamp only float-level
    // rounding at the edges, reject genuinely out-of-bounds regions.
    for (const region of analysis.regions) {
      if (
        region.x + region.width > 1 + BOUNDS_EPSILON ||
        region.y + region.height > 1 + BOUNDS_EPSILON
      ) {
        req.log.error(
          { region },
          "Analysis region exceeded normalized bounds",
        );
        res.status(502).json({
          error:
            "The analysis returned an invalid region layout. Please try again.",
        });
        return;
      }
      region.x = Math.min(Math.max(region.x, 0), 1);
      region.y = Math.min(Math.max(region.y, 0), 1);
      region.width = Math.min(Math.max(region.width, 0.01), 1 - region.x);
      region.height = Math.min(Math.max(region.height, 0.01), 1 - region.y);
    }

    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Analysis request failed");
    res.status(502).json({
      error: "The analysis failed to complete. Please try again.",
    });
  } finally {
    analysesInFlight -= 1;
  }
});

export default router;
