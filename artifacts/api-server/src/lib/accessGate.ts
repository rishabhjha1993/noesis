import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "./requestSafety";

const COOKIE_NAME = "noesis_access";
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

function tokenFor(accessCode: string): string {
  return createHmac("sha256", accessCode)
    .update("noesis-private-alpha-access")
    .digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const pair of raw.split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return null;
}

function accessPage(error?: string): string {
  const errorMarkup = error ? `<p class="error" role="alert">${error}</p>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Noesis — Private Alpha</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f3ed; color: #20201d; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
      main { width: min(100%, 420px); padding: 40px; border: 1px solid #d9d5ca; border-radius: 18px; background: rgba(255,255,255,.7); box-shadow: 0 24px 80px rgba(40,38,30,.08); }
      h1 { margin: 0 0 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 30px; letter-spacing: .22em; }
      p { margin: 0 0 28px; color: #666158; line-height: 1.55; }
      label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 650; letter-spacing: .04em; }
      input { width: 100%; padding: 13px 14px; border: 1px solid #c9c3b7; border-radius: 9px; background: #fff; color: inherit; font: inherit; outline: none; }
      input:focus { border-color: #6f725b; box-shadow: 0 0 0 3px rgba(111,114,91,.14); }
      button { width: 100%; margin-top: 14px; padding: 13px 16px; border: 0; border-radius: 9px; background: #34382d; color: white; font: inherit; font-weight: 650; cursor: pointer; }
      button:hover { background: #272a22; }
      .error { margin: 14px 0 0; color: #9e3329; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <h1>NOESIS</h1>
      <p>Private alpha. Enter the access code to continue.</p>
      <form method="post" action="/access">
        <label for="access_code">Access code</label>
        <input id="access_code" name="access_code" type="password" autocomplete="current-password" required autofocus />
        <button type="submit">Enter Noesis</button>
        ${errorMarkup}
      </form>
    </main>
  </body>
</html>`;
}

const accessAttemptLimit = rateLimit({
  max: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many access attempts. Please try again later.",
});

export interface AccessGate {
  enabled: boolean;
  show: RequestHandler;
  submit: RequestHandler[];
  requireAccess: RequestHandler;
}

export function createAccessGate(accessCode: string | undefined): AccessGate {
  const configuredCode = accessCode?.trim() || null;
  const expectedToken = configuredCode ? tokenFor(configuredCode) : null;

  const authorized = (req: Request): boolean => {
    if (!expectedToken) return true;
    const supplied = cookieValue(req);
    return supplied !== null && safeEqual(supplied, expectedToken);
  };

  return {
    enabled: configuredCode !== null,
    show: (_req, res) => {
      if (!configuredCode) {
        res.redirect("/");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(accessPage());
    },
    submit: [
      accessAttemptLimit,
      (req, res) => {
        if (!configuredCode || !expectedToken) {
          res.redirect("/");
          return;
        }
        const supplied =
          typeof req.body?.access_code === "string" ? req.body.access_code : "";
        if (!safeEqual(supplied, configuredCode)) {
          res
            .status(401)
            .type("html")
            .send(accessPage("That access code is not valid."));
          return;
        }
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
          "Set-Cookie",
          `${COOKIE_NAME}=${encodeURIComponent(expectedToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ONE_WEEK_SECONDS}${secure}`,
        );
        res.redirect(303, "/");
      },
    ],
    requireAccess: (req: Request, res: Response, next: NextFunction) => {
      if (authorized(req) || req.path === "/api/healthz") {
        next();
        return;
      }
      if (req.path.startsWith("/api/")) {
        res.status(401).json({ error: "Access code required" });
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        res.redirect(303, "/access");
        return;
      }
      res.status(401).json({ error: "Access code required" });
    },
  };
}
