import type { DiscoveryRunResult } from "@workspace/api-client-react";
import capturedRun from "../dev-fixtures/asia-frozen-v1.json";

const result = capturedRun as unknown as DiscoveryRunResult & {
  discovery_id: string;
};

export const PUBLIC_DEMO_FIXTURE = {
  imageUrl: "/__noesis-dev-fixtures/asia-map.jpg",
  result,
};
