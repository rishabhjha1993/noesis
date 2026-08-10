import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import {
  getDiscoveryStatus,
  startDiscovery,
  type Discovery,
  type DiscoveryRunResult,
} from "@workspace/api-client-react";
import { serializeDiscoveryEvalPayload } from "../lib/discoveryEval";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image file"));
    reader.readAsDataURL(file);
  });
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(4)}`;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function DiscoveryImage({
  imageUrl,
  result,
  discovery,
}: {
  imageUrl: string;
  result: DiscoveryRunResult;
  discovery: Discovery | null;
}) {
  const activeRegionIds = new Set(discovery?.region_ids ?? []);
  return (
    <div className="flex min-h-[42vh] items-center justify-center rounded-xl border border-border bg-card p-3 lg:min-h-0 lg:h-full">
      <div className="relative inline-block max-h-full max-w-full">
        <img
          src={imageUrl}
          alt="Visual being evaluated"
          className="block max-h-[72vh] max-w-full rounded-sm"
        />
        {result.regions.map((region) => {
          const active = activeRegionIds.has(region.id);
          return (
            <div
              key={region.id}
              aria-label={`Region ${region.id}: ${region.description}`}
              className={`pointer-events-none absolute border-2 transition-all ${
                active
                  ? "border-amber-400 bg-amber-300/20 opacity-100 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
                  : "border-slate-400/30 bg-transparent opacity-30"
              }`}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DiscoveryCard({
  discovery,
  active,
  onSelect,
}: {
  discovery: Discovery;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-background hover:border-primary/50"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-serif text-lg font-semibold">{discovery.title}</h3>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {discovery.type}
        </span>
      </div>
      <p className="text-sm leading-6 text-foreground">{discovery.discovery}</p>
    </button>
  );
}

export function DiscoveryLab() {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"upload" | "loading" | "done" | "error">(
    "upload",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoveryRunResult | null>(null);
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selectedDiscovery = result?.discoveries[selectedIndex] ?? null;
  const selectedCandidateIds = useMemo(
    () =>
      selectedDiscovery
        ? (result?.inspection.discovery_candidates[selectedDiscovery.id] ?? [])
        : [],
    [result, selectedDiscovery],
  );
  const selectedCandidates = result?.inspection.stage1.candidates.filter(
    (candidate) => selectedCandidateIds.includes(candidate.id),
  );

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (!next) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(next.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (next.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 12 MB.");
      return;
    }
    requestSequence.current += 1;
    setFile(next);
    setResult(null);
    setDiscoveryId(null);
    setCacheHit(false);
    setCopyStatus("idle");
    setSelectedIndex(0);
    setError(null);
    setStatus("upload");
  };

  const run = async () => {
    if (!file) return;
    const requestId = ++requestSequence.current;
    setStatus("loading");
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const discoveryId = await startDiscovery(dataUrl);
      setDiscoveryId(discoveryId);
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (requestId !== requestSequence.current) return;
        const job = await getDiscoveryStatus(discoveryId);
        if (job.status === "done") {
          setResult(job.result);
          setCacheHit(job.cache_hit);
          setSelectedIndex(0);
          setStatus("done");
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Discovery failed.");
        }
        if (Date.now() > deadline) {
          throw new Error("Discovery timed out. Please try again.");
        }
      }
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "Discovery failed.");
      setStatus("error");
    }
  };

  const reset = () => {
    requestSequence.current += 1;
    setFile(null);
    setResult(null);
    setDiscoveryId(null);
    setCacheHit(false);
    setCopyStatus("idle");
    setSelectedIndex(0);
    setError(null);
    setStatus("upload");
  };

  const copyFullEvalJson = async () => {
    if (!result || !discoveryId) return;
    try {
      const serialized = serializeDiscoveryEvalPayload({
        result,
        discoveryId,
        cacheHit,
      });
      JSON.parse(serialized);
      await navigator.clipboard.writeText(serialized);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  if (status === "done" && result && imageUrl) {
    return (
      <main className="min-h-[100dvh] bg-background text-foreground">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4 lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <FlaskConical className="h-4 w-4" /> Discovery Engine V1
            </div>
            <h1 className="mt-1 font-serif text-2xl">Human evaluation lab</h1>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            <RotateCcw className="h-4 w-4" /> New visual
          </button>
        </header>

        <div className="grid min-h-[calc(100dvh-81px)] gap-0 lg:grid-cols-[58%_42%]">
          <section className="border-b border-border bg-muted/20 p-4 lg:border-b-0 lg:border-r lg:p-6">
            <DiscoveryImage
              imageUrl={imageUrl}
              result={result}
              discovery={selectedDiscovery}
            />
          </section>
          <section className="space-y-5 overflow-y-auto p-5 lg:max-h-[calc(100dvh-81px)] lg:p-7">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted p-2">
                <strong className="block text-lg">
                  {result.metrics.stage1_candidates}
                </strong>
                candidates
              </div>
              <div className="rounded-md bg-muted p-2">
                <strong className="block text-lg">
                  {result.metrics.research_gate_passed}
                </strong>
                researched
              </div>
              <div className="rounded-md bg-muted p-2">
                <strong className="block text-lg">
                  {result.metrics.final_discoveries}
                </strong>
                discoveries
              </div>
            </div>

            {result.discoveries.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="font-serif text-xl">
                  No discovery cleared the bar
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  V1 returned zero rather than padding the result with generic
                  findings.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {result.discoveries.map((discovery, index) => (
                  <DiscoveryCard
                    key={discovery.id}
                    discovery={discovery}
                    active={index === selectedIndex}
                    onSelect={() => setSelectedIndex(index)}
                  />
                ))}
              </div>
            )}

            {selectedDiscovery && (
              <article className="space-y-5 rounded-xl border border-border bg-card p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Visual trigger
                  </p>
                  <p className="mt-1 leading-7">
                    {selectedDiscovery.visual_trigger}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Discovery
                  </p>
                  <p className="mt-1 font-serif text-xl leading-8">
                    {selectedDiscovery.discovery}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Why it matters
                  </p>
                  <p className="mt-1 leading-7">
                    {selectedDiscovery.why_it_matters}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Explanation
                  </p>
                  <p className="mt-1 leading-7">
                    {selectedDiscovery.explanation}
                  </p>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Look back at the image
                  </p>
                  <p className="mt-1 leading-7">
                    {selectedDiscovery.reinterpretation}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {selectedDiscovery.provenance}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    confidence {Math.round(selectedDiscovery.confidence * 100)}%
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    regions {selectedDiscovery.region_ids.join(", ")}
                  </span>
                </div>
                {selectedDiscovery.sources.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Sources
                    </p>
                    <ul className="mt-2 space-y-2">
                      {selectedDiscovery.sources.map((source) => (
                        <li key={source.url}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
                          >
                            {source.title} <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            )}

            <details className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Developer / eval inspection
              </summary>
              <div className="mt-4 space-y-4 text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void copyFullEvalJson()}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {copyStatus === "copied" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Copy full eval JSON
                  </button>
                  <span className="text-xs" aria-live="polite">
                    {copyStatus === "copied" && "Copied"}
                    {copyStatus === "error" &&
                      "Could not copy. Check clipboard permissions."}
                  </span>
                </div>
                <p>{result.inspection.stage1.image_summary}</p>
                <div className="rounded-md border border-border bg-background p-3">
                  <p>
                    <strong className="text-foreground">
                      Identity verification:
                    </strong>{" "}
                    {result.metrics.stage2.identity_verification.status}
                  </p>
                  <p>
                    <strong className="text-foreground">
                      Candidate calls using verified identity:
                    </strong>{" "}
                    {
                      result.metrics.stage2
                        .candidate_calls_using_verified_identity
                    }
                  </p>
                </div>
                {(selectedCandidates ?? []).map((candidate) => {
                  const research = result.inspection.research_results.find(
                    (item) => item.candidate_id === candidate.id,
                  );
                  return (
                    <div
                      key={candidate.id}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <p>
                        <strong className="text-foreground">Candidate:</strong>{" "}
                        {candidate.id}
                      </p>
                      <p>
                        <strong className="text-foreground">Trigger:</strong>{" "}
                        {candidate.visual_trigger}
                      </p>
                      <p>
                        <strong className="text-foreground">Question:</strong>{" "}
                        {candidate.investigation_question}
                      </p>
                      <p>
                        <strong className="text-foreground">
                          Research ran:
                        </strong>{" "}
                        {research ? "yes" : "no"}
                      </p>
                      <p>
                        <strong className="text-foreground">
                          Research status:
                        </strong>{" "}
                        {research?.status ?? "not requested"}
                      </p>
                      <p>
                        <strong className="text-foreground">Regions:</strong>{" "}
                        {candidate.region_ids.join(", ")}
                      </p>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-2">
                  <span>
                    Total latency: {seconds(result.metrics.total_latency_ms)}
                  </span>
                  <span>
                    Total cost: {money(result.metrics.total_cost_usd)}
                  </span>
                  <span>
                    Stage 1: {result.metrics.stage1.usage.model} /{" "}
                    {result.metrics.stage1.usage.reasoning_effort}
                  </span>
                  <span>
                    Stage 2: {result.metrics.stage2.model} /{" "}
                    {result.metrics.stage2.reasoning_effort}
                  </span>
                  <span>
                    Stage 3: {result.metrics.stage3.usage.model} /{" "}
                    {result.metrics.stage3.usage.reasoning_effort}
                  </span>
                  <span>Version: {result.version}</span>
                  <span>Cache: {cacheHit ? "hit" : "miss"}</span>
                </div>
              </div>
            </details>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
            <FlaskConical className="h-4 w-4" /> Experimental · V1
          </div>
          <h1 className="font-serif text-4xl">Noesis Discovery Lab</h1>
          <p className="mt-3 text-muted-foreground">
            See → question → selectively research → discover → return to the
            image.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Selected visual"
              className="mx-auto max-h-[48vh] rounded-md object-contain"
            />
          ) : (
            <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-border p-12 text-center hover:border-primary/50">
              <UploadCloud className="mb-4 h-10 w-10 text-primary/70" />
              <span className="font-medium">Choose a visual</span>
              <span className="mt-2 text-sm text-muted-foreground">
                PNG, JPEG, or WebP up to 12 MB
              </span>
              <input
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp"
                onChange={chooseFile}
              />
            </label>
          )}

          {file && status !== "loading" && (
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Run Discovery V1
              </button>
              <label className="cursor-pointer rounded-md border border-border px-6 py-3 font-medium hover:bg-muted">
                Choose another
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={chooseFile}
                />
              </label>
            </div>
          )}

          {status === "loading" && (
            <div className="mt-6 text-center" aria-live="polite">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="font-medium">Looking closely at this image…</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Grounding visible evidence, selectively researching, then
                ranking discoveries.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
