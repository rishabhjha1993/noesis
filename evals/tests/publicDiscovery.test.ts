import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DiscoveryRunResult } from "../../lib/api-client-react/src/discovery";
import {
  publicTextPlacement,
  toPublicDiscovery,
} from "../../artifacts/noesis/src/lib/toPublicDiscovery";
import {
  DISCOVERY_LAB_PATH,
  LEGACY_APP_PATH,
  PUBLIC_DISCOVERY_PATH,
} from "../../artifacts/noesis/src/lib/appRoutes";

function capturedJson(fileName: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../artifacts/noesis/src/dev-fixtures/${fileName}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

const asiaCapture = capturedJson(
  "asia-frozen-v1.json",
) as DiscoveryRunResult & {
  discovery_id: string;
};
const noordCapture = capturedJson("noordoostpolder-v1.json") as {
  status: "done";
  result: DiscoveryRunResult;
};

test("public adapter maps a real multi-region captured run", () => {
  const publicResult = toPublicDiscovery(asiaCapture);

  assert.equal(publicResult.discoveries.length, 3);
  assert.deepEqual(
    publicResult.discoveries.map((discovery) => discovery.id),
    ["discovery-01", "discovery-02", "discovery-03"],
  );

  const first = publicResult.discoveries[0]!;
  assert.equal(
    first.title,
    "The Himalaya creates the map’s sharpest environmental divide",
  );
  assert.equal(first.regions.length, 2);
  assert.equal(first.regions[0]?.left, 12);
  assert.equal(first.regions[0]?.top, 17);
  assert.ok(Math.abs((first.regions[0]?.width ?? 0) - 55) < 0.000001);
  assert.equal(first.regions[0]?.height, 21);
  assert.equal(first.sources[0]?.displayDomain, "erdkunde.uni-bonn.de");
  assert.ok(first.lede.split(/\s+/).length <= 45);
  assert.deepEqual(first.detail, [
    asiaCapture.discoveries[0]!.why_it_matters,
    asiaCapture.discoveries[0]!.explanation,
    asiaCapture.discoveries[0]!.reinterpretation,
  ]);
});

test("public adapter maps the second real capture without engineering metadata", () => {
  const publicResult = toPublicDiscovery(noordCapture.result);
  assert.equal(publicResult.discoveries.length, 3);
  assert.equal(
    publicResult.discoveries[2]?.title,
    "The offshore “eye” contains polluted sediment",
  );
  assert.equal(publicResult.discoveries[2]?.regions.length, 2);
  assert.ok(
    publicResult.discoveries.every(
      (discovery) => discovery.lede.split(/\s+/).length <= 45,
    ),
  );

  const publicKeys = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      publicKeys.add(key);
      visit(child);
    }
  };
  visit(publicResult);
  assert.deepEqual([...publicKeys].sort(), [
    "detail",
    "discoveries",
    "displayDomain",
    "height",
    "id",
    "lede",
    "left",
    "regions",
    "sources",
    "title",
    "top",
    "url",
    "width",
  ]);
});

test("public text placement moves right only for lower-left focus", () => {
  assert.equal(
    publicTextPlacement([{ left: 5, top: 60, width: 20, height: 20 }]),
    "right",
  );
  assert.equal(
    publicTextPlacement([{ left: 65, top: 60, width: 20, height: 20 }]),
    "left",
  );
  assert.equal(
    publicTextPlacement([
      { left: 5, top: 60, width: 20, height: 20 },
      { left: 70, top: 5, width: 25, height: 25 },
    ]),
    "left",
  );
});

test("public route is additive to the legacy and lab routes", () => {
  assert.equal(LEGACY_APP_PATH, "/");
  assert.equal(DISCOVERY_LAB_PATH, "/discovery-lab");
  assert.equal(PUBLIC_DISCOVERY_PATH, "/see");
});
