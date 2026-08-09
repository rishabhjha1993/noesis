import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { AnalyzeImageBody, AnalyzeImageResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are Noesis, an expert at teaching people how to read complex visuals (charts, diagrams, maps, infographics, technical figures).

Given an image, produce a guided walkthrough as STRICT JSON (no markdown, no code fences) with exactly this shape:

{
  "title": string,                 // short descriptive title of the visual
  "image_type": string,            // e.g. "Sankey diagram", "bar chart", "flowchart"
  "central_question": string,      // the one question this visual answers
  "overall_summary": string,       // 1-2 sentence summary of what it shows
  "big_takeaway": string,          // the single most important insight
  "regions": [                     // 4 to 6 regions, ordered as a teaching sequence
    {
      "id": string,                          // "1", "2", ...
      "label": string,                       // short name for the region
      "x": number, "y": number,              // top-left corner, normalized 0-1 (fraction of image width/height)
      "width": number, "height": number,     // normalized 0-1
      "sequence_order": number,              // 1-based order to visit regions
      "explanation": string,                 // what this region shows and how to read it
      "why_it_matters": string,              // why it is important to understanding the visual
      "related_region_ids": string[],        // ids of related regions
      "relationship_explanation": string,    // how it relates to those regions
      "confidence": number                   // 0-1 confidence in this region's bounding box and reading
    }
  ]
}

Rules:
- Bounding boxes must tightly cover the actual visual element described, in normalized coordinates where (0,0) is the top-left of the image and (1,1) is the bottom-right.
- x + width and y + height must each stay within 0 and 1.
- Provide 4-6 regions forming a logical reading order for a newcomer.
- related_region_ids must only reference ids present in the regions array.
- Output ONLY the JSON object, nothing else.

SPATIAL LOCALISATION RULES

Each selected region must correspond as tightly as practical to the visual structure being explained.

The region should include enough context to understand the concept, but should NOT cover large unrelated areas merely because the concept connects to them.

A good region:
- encloses the main component, cluster, flow, panel or area being discussed
- contains enough surrounding context to make the explanation understandable
- avoids large blank areas
- avoids swallowing other selected concepts unless overlap is genuinely necessary
- remains comfortably clickable

A bad region:
- covers most of the image
- spans large unrelated areas
- exists primarily to encompass every connected element
- overlaps several other regions without explanatory need

When a relationship spans distant parts of the image:
DO NOT create one enormous bounding box connecting them.

Instead:
- give each meaningful area its own region
- use related_region_ids and relationship_explanation to express the connection

Prefer spatially distinct regions whenever the visual permits it.

Aim for region rectangles that usually occupy less than roughly 30% of total image area.
This is a heuristic, not an absolute rule: use a larger region only when the concept genuinely occupies a large coherent area.

Before returning coordinates, internally check:
1. Does this rectangle contain the thing I am explaining?
2. Does it contain large areas unrelated to that explanation?
3. Could I tighten the rectangle while preserving useful context?
4. Does it substantially overlap another selected region unnecessarily?

If yes to 2 or 4, tighten or reconsider the region.

Do NOT return a region for the chart title unless the title itself is genuinely necessary to teach the visual.

Do NOT select decorative logos, footnotes, source text, or headers as explanatory regions unless essential.

Continue returning exactly 4–6 regions.`;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

router.post("/analyze", async (req, res) => {
  const parsedBody = AnalyzeImageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "image_data_url is required" });
    return;
  }
  const { image_data_url } = parsedBody.data;
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image_data_url)) {
    res.status(400).json({
      error: "image_data_url must be a base64 data URL for a PNG, JPEG, WebP, or GIF image",
    });
    return;
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "Analysis service is not configured" });
    return;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-sol",
      reasoning_effort: "low",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this visual and return the walkthrough JSON.",
            },
            { type: "image_url", image_url: { url: image_data_url } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Model returned an empty response");
    }

    const candidate: unknown = JSON.parse(raw);

    // Defensively clamp coordinates before contract validation.
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      Array.isArray((candidate as { regions?: unknown }).regions)
    ) {
      for (const region of (candidate as { regions: unknown[] }).regions) {
        if (region === null || typeof region !== "object") continue;
        const r = region as Record<string, unknown>;
        for (const key of ["x", "y", "width", "height", "confidence"]) {
          if (typeof r[key] === "number") r[key] = clamp01(r[key]);
        }
        if (typeof r["x"] === "number" && typeof r["width"] === "number") {
          r["width"] = Math.min(r["width"], 1 - r["x"]);
        }
        if (typeof r["y"] === "number" && typeof r["height"] === "number") {
          r["height"] = Math.min(r["height"], 1 - r["y"]);
        }
      }
    }

    const analysis = AnalyzeImageResponse.parse(candidate);
    if (analysis.regions.length === 0) {
      throw new Error("Model returned no regions");
    }
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Image analysis failed");
    res.status(502).json({
      error: "The analysis failed. Please try again or pick another image.",
    });
  }
});

export default router;
