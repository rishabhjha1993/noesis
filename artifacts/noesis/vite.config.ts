import path from "path";
import { createReadStream } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const rawPort = process.env.PORT ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

function publicDemoFixturePlugin(): Plugin {
  const fixturePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "attached_assets",
    "noesis-demo-asia.jpg",
  );
  return {
    name: "noesis-public-demo-fixture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/__noesis-dev-fixtures/asia-map.jpg",
        (request, response, next) => {
          if (request.method !== "GET") {
            next();
            return;
          }
          response.setHeader("Content-Type", "image/jpeg");
          response.setHeader("Cache-Control", "no-store");
          createReadStream(fixturePath).pipe(response);
        },
      );
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), publicDemoFixturePlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
