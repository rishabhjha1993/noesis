import { Router, type IRouter } from "express";
import { AnalyzeImageBody } from "@workspace/api-zod";
import { getDiscoveryJob, startDiscoveryJob } from "../lib/discoveryJobs";
import type { DiscoveryEngineVariant } from "../lib/discoveryPipeline";
import {
  analysisRateLimit,
  decodedImageBytes,
  MAX_IMAGE_BYTES,
} from "../lib/requestSafety";

const router: IRouter = Router();

router.post("/discovery", analysisRateLimit, (req, res) => {
  const parsedBody = AnalyzeImageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "image_data_url is required" });
    return;
  }
  const { image_data_url } = parsedBody.data;
  const requestedVariant = (req.body as { engine_variant?: unknown })
    .engine_variant;
  if (
    requestedVariant !== undefined &&
    requestedVariant !== "v1" &&
    requestedVariant !== "v1-batched-research"
  ) {
    res.status(400).json({ error: "Unknown Discovery engine variant" });
    return;
  }
  const engineVariant: DiscoveryEngineVariant = requestedVariant ?? "v1";
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image_data_url)) {
    res.status(400).json({
      error:
        "image_data_url must be a base64 data URL for a PNG, JPEG, WebP, or GIF image",
    });
    return;
  }
  const imageBytes = decodedImageBytes(image_data_url);
  if (imageBytes === null) {
    res
      .status(400)
      .json({ error: "image_data_url contains invalid base64 data" });
    return;
  }
  if (imageBytes > MAX_IMAGE_BYTES) {
    res.status(413).json({
      error: "Image is too large. The maximum decoded image size is 12 MB.",
    });
    return;
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "Discovery service is not configured" });
    return;
  }

  const started = startDiscoveryJob(apiKey, image_data_url, engineVariant);
  if ("busy" in started) {
    res.status(503).json({
      error: "The discovery lab is busy. Please try again in a moment.",
    });
    return;
  }
  res.status(202).json({ discovery_id: started.discoveryId });
});

router.get("/discovery/:discoveryId", (req, res) => {
  const job = getDiscoveryJob(req.params.discoveryId);
  if (!job) {
    res.status(404).json({ error: "Unknown or expired discovery run" });
    return;
  }
  if (job.status === "pending") {
    res.json({ status: "pending" });
  } else if (job.status === "done") {
    res.setHeader("X-Noesis-Discovery-Cache", job.cacheHit ? "HIT" : "MISS");
    res.json({ status: "done", result: job.result, cache_hit: job.cacheHit });
  } else {
    res.json({
      status: "error",
      error: job.error,
      diagnostic: job.diagnostic,
    });
  }
});

export default router;
