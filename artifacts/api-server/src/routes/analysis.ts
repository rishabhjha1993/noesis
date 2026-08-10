import { Router, type IRouter } from "express";
import { AnalyzeImageBody } from "@workspace/api-zod";
import { startAnalysisJob, getAnalysisJob } from "../lib/analysisJobs";
import {
  analysisRateLimit,
  decodedImageBytes,
  MAX_IMAGE_BYTES,
} from "../lib/requestSafety";

const router: IRouter = Router();

// Starts an analysis job and returns its id immediately. The pipeline takes
// ~2 minutes, which exceeds the ~120s proxy limit on browser requests, so
// the client polls GET /analyze/:analysisId for the result.
//
// Cache hits (same image previously analyzed) complete in milliseconds.
router.post("/analyze", analysisRateLimit, (req, res) => {
  const parsedBody = AnalyzeImageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "image_data_url is required" });
    return;
  }
  const { image_data_url } = parsedBody.data;
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
    res.status(502).json({ error: "Analysis service is not configured" });
    return;
  }

  const started = startAnalysisJob(apiKey, image_data_url);
  if ("busy" in started) {
    res.status(503).json({
      error: "The analysis service is busy. Please try again in a moment.",
    });
    return;
  }
  res.status(202).json({ analysis_id: started.analysisId });
});

router.get("/analyze/:analysisId", (req, res) => {
  // Must not be cached — the status transitions from pending → done/error.
  res.setHeader("Cache-Control", "no-store");

  const job = getAnalysisJob(req.params.analysisId);
  if (!job) {
    res.status(404).json({ error: "Unknown or expired analysis" });
    return;
  }
  if (job.status === "pending") {
    res.json({ status: "pending" });
  } else if (job.status === "done") {
    res.setHeader("X-Noesis-Cache", job.cacheHit ? "HIT" : "MISS");
    res.json({ status: "done", analysis: job.analysis });
  } else {
    res.json({ status: "error", error: job.error });
  }
});

export default router;
