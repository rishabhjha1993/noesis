import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { loadDiscoveryResearchReplayImage } from "./discoveryResearchReplay";
import type { DiscoveryReplayChatClient } from "./discoveryStage1Replay";
import {
  createDiscoveryStage3ReplayDryRun,
  createDiscoveryStage3ReplayPlan,
  executeDiscoveryStage3Replay,
  loadRetainedStage3ReplayInput,
} from "./discoveryStage3Replay";

function option(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const baselineOption = option("--input") ?? option("--baseline-json");
  if (!baselineOption) throw new Error("--input is required");
  const retained = await loadRetainedStage3ReplayInput(
    path.resolve(baselineOption),
    option("--source-discovery-id"),
  );
  const outputOption = option("--output");
  const outputPath = outputOption ? path.resolve(outputOption) : null;
  const plan = createDiscoveryStage3ReplayPlan(retained, outputPath);

  if (!process.argv.includes("--execute")) {
    process.stdout.write(
      `${JSON.stringify(createDiscoveryStage3ReplayDryRun(plan), null, 2)}\n`,
    );
    return;
  }
  const imageOption = option("--image");
  if (!imageOption) throw new Error("--image is required with --execute");
  if (!outputPath) throw new Error("--output is required with --execute");
  const image = await loadDiscoveryResearchReplayImage(
    path.resolve(imageOption),
  );

  const repoRoot = path.resolve(__dirname, "..");
  if (!process.env.OPENAI_API_KEY) {
    try {
      loadEnvFile(path.join(repoRoot, ".env.local"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required with --execute");
  const apiRequire = createRequire(
    path.join(repoRoot, "artifacts/api-server/package.json"),
  );
  const OpenAI = apiRequire("openai").default as new (options: {
    apiKey: string;
  }) => unknown;
  const result = await executeDiscoveryStage3Replay(
    new OpenAI({ apiKey }) as DiscoveryReplayChatClient,
    plan,
    image,
  );
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ status: "completed", output_path: outputPath }, null, 2)}\n`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
