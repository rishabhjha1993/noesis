import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { createAccessGate } from "./lib/accessGate";
import { logger } from "./lib/logger";
import { securityHeaders } from "./lib/requestSafety";

const app: Express = express();
app.disable("x-powered-by");
// Railway and most container platforms forward the original client address.
// Trust exactly the first proxy so rate limiting uses that address.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);

const allowedOrigins = (process.env.NOESIS_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  app.use(cors({ origin: true, credentials: true }));
} else if (allowedOrigins.length > 0) {
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.includes(origin));
      },
    }),
  );
}
// analyze accepts base64 images up to 12 MB decoded (~16 MB base64 + JSON
// wrapper); 25 MB leaves headroom so the route's clean 400 stays reachable.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

const accessGate = createAccessGate(process.env.NOESIS_ACCESS_CODE);
app.get("/access", accessGate.show);
app.post("/access", ...accessGate.submit);
app.use(accessGate.requireAccess);

app.use("/api", router);

const bundledDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(bundledDir, "../../noesis/dist/public");
const frontendIndex = path.join(frontendDir, "index.html");

if (existsSync(frontendIndex)) {
  app.use(
    express.static(frontendDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  const spaFallback: RequestHandler = (req, res, next) => {
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      req.accepts("html") &&
      !req.path.startsWith("/api/")
    ) {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(frontendIndex);
      return;
    }
    next();
  };
  app.use(spaFallback);
} else if (process.env.NODE_ENV === "production") {
  logger.warn({ frontend_dir: frontendDir }, "Frontend build was not found");
}

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err, request_id: req.id }, "Unhandled request error");
  const status =
    typeof err?.status === "number" && err.status >= 400 && err.status < 500
      ? err.status
      : 500;
  res.status(status).json({
    error:
      status === 413
        ? "Request is too large"
        : "The request could not be processed",
  });
};
app.use(errorHandler);

export default app;
