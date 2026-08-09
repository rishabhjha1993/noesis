import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { AnalyzeImageBody } from "@workspace/api-zod";
import { runAnalysisPipeline } from "../lib/analysisPipeline";

const router: IRouter = Router();

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
    const analysis = await runAnalysisPipeline(openai, image_data_url);
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Image analysis failed");
    res.status(502).json({
      error: "The analysis failed. Please try again or pick another image.",
    });
  }
});

export default router;
