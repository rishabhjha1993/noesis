import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  ImagePlus,
  RotateCcw,
} from "lucide-react";
import {
  getDiscoveryStatus,
  startDiscovery,
} from "@workspace/api-client-react";
import {
  publicTextPlacement,
  toPublicDiscovery,
  type PublicDiscoveryItem,
  type PublicDiscoveryRegion,
  type PublicDiscoveryViewModel,
} from "../lib/toPublicDiscovery";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

type PublicStatus =
  "idle" | "uploading" | "analyzing" | "ready" | "zero" | "error";

type ReadyMode = "sequence" | "overview";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.readAsDataURL(file);
  });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, summary, [data-public-controls]"))
  );
}

function formatPosition(index: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, "0")} / ${String(total).padStart(width, "0")}`;
}

function discoveryCount(count: number): string {
  return `${count} ${count === 1 ? "thing" : "things"} you may have missed`;
}

function uniqueRegions(
  discoveries: PublicDiscoveryItem[],
): PublicDiscoveryRegion[] {
  const seen = new Set<string>();
  return discoveries.flatMap((discovery) =>
    discovery.regions.flatMap((region) => {
      const key = [region.left, region.top, region.width, region.height].join(
        ":",
      );
      if (seen.has(key)) return [];
      seen.add(key);
      return [region];
    }),
  );
}

function FocusMask({
  regions,
  overview,
}: {
  regions: PublicDiscoveryRegion[];
  overview: boolean;
}) {
  const maskId = `public-focus-${useId().replace(/:/g, "")}`;
  if (regions.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <filter
          id={`${maskId}-soft`}
          x="-15%"
          y="-15%"
          width="130%"
          height="130%"
        >
          <feGaussianBlur stdDeviation="0.65" />
        </filter>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="white" />
          {regions.map((region, index) => (
            <rect
              key={index}
              x={region.left}
              y={region.top}
              width={region.width}
              height={region.height}
              rx="0.7"
              fill="black"
              filter={`url(#${maskId}-soft)`}
            />
          ))}
        </mask>
      </defs>
      <rect
        width="100"
        height="100"
        fill="black"
        opacity={overview ? 0.14 : 0.46}
        mask={`url(#${maskId})`}
      />
      {regions.map((region, index) => (
        <rect
          key={index}
          x={region.left}
          y={region.top}
          width={region.width}
          height={region.height}
          rx="0.7"
          fill="none"
          stroke="rgba(255,255,255,0.68)"
          strokeWidth={overview ? 0.12 : 0.2}
          vectorEffect="non-scaling-stroke"
          opacity={overview ? 0.42 : 0.82}
        />
      ))}
    </svg>
  );
}

function DiscoveryCopy({
  discovery,
  expanded,
  sourcesOpen,
  onToggleExpanded,
  onToggleSources,
  showHoldHint,
}: {
  discovery: PublicDiscoveryItem;
  expanded: boolean;
  sourcesOpen: boolean;
  onToggleExpanded: () => void;
  onToggleSources: () => void;
  showHoldHint: boolean;
}) {
  return (
    <article>
      <h1 className="font-serif text-[clamp(1.5rem,2.5vw,2.05rem)] font-normal leading-[1.04] tracking-[-0.025em] text-stone-50">
        {discovery.title}
      </h1>
      <p className="mt-2.5 max-w-[62ch] text-sm leading-5 text-stone-100/90">
        {discovery.lede}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs tracking-wide text-stone-300">
        {discovery.detail.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
            className="underline decoration-stone-500 underline-offset-4 transition-colors hover:text-white"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
        {discovery.sources.length > 0 && (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={onToggleSources}
            className="underline decoration-stone-500 underline-offset-4 transition-colors hover:text-white"
          >
            {sourcesOpen ? "hide sources" : "sources"}
          </button>
        )}
        {showHoldHint && (
          <span className="text-stone-400">hold image, touch, or space</span>
        )}
      </div>

      {expanded && (
        <div className="mt-4 max-h-[38vh] space-y-3 overflow-y-auto border-l border-white/20 pl-4 text-sm leading-6 text-stone-200">
          {discovery.detail.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}

      {sourcesOpen && (
        <ul className="mt-4 flex max-h-32 flex-col gap-2 overflow-y-auto border-l border-white/20 pl-4 text-xs text-stone-300">
          {discovery.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 underline decoration-stone-600 underline-offset-4 hover:text-white"
              >
                {source.displayDomain}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SequenceControls({
  index,
  total,
  onPrevious,
  onNext,
}: {
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5 text-stone-200">
      <button
        type="button"
        aria-label="Previous discovery"
        disabled={index === 0}
        onClick={onPrevious}
        className="p-2 transition-opacity hover:text-white disabled:opacity-20"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="font-mono text-[11px] tracking-[0.18em] text-stone-300">
        {formatPosition(index, total)}
      </span>
      <button
        type="button"
        aria-label={
          index === total - 1 ? "Open discovery overview" : "Next discovery"
        }
        onClick={onNext}
        className="p-2 transition-colors hover:text-white"
      >
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

function OverviewList({
  discoveries,
  onFocus,
  onSelect,
}: {
  discoveries: PublicDiscoveryItem[];
  onFocus: (index: number | null) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <section>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
        Overview
      </p>
      <ol className="space-y-1">
        {discoveries.map((discovery, index) => (
          <li key={discovery.id}>
            <button
              type="button"
              onMouseEnter={() => onFocus(index)}
              onMouseLeave={() => onFocus(null)}
              onFocus={() => onFocus(index)}
              onBlur={() => onFocus(null)}
              onClick={() => onSelect(index)}
              className="group flex w-full items-baseline gap-3 py-1.5 text-left"
            >
              <span className="font-mono text-[10px] text-stone-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="font-serif text-lg leading-tight text-stone-200 transition-colors group-hover:text-white group-focus:text-white sm:text-xl">
                {discovery.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IdleView({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const acceptFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (next) onFile(next);
  };
  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const next = event.dataTransfer.files?.[0];
    if (next) onFile(next);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0b0c0c] px-6 py-12 text-stone-100">
      <div className="w-full max-w-3xl text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-stone-500">
          Noesis
        </p>
        <h1 className="mx-auto mt-6 max-w-2xl font-serif text-[clamp(2.6rem,7vw,5.8rem)] font-light leading-[0.94] tracking-[-0.04em]">
          See what you would have missed
        </h1>
        <label
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFile}
          className={`mx-auto mt-12 flex min-h-44 max-w-xl cursor-pointer flex-col items-center justify-center border px-8 py-10 transition-colors ${
            dragging
              ? "border-stone-300 bg-white/5"
              : "border-stone-700 hover:border-stone-500"
          }`}
        >
          <ImagePlus className="h-6 w-6 text-stone-400" aria-hidden="true" />
          <span className="mt-4 text-sm text-stone-200">
            Choose an image or drop it here
          </span>
          <span className="mt-2 text-xs text-stone-500">
            PNG, JPEG, or WebP · 12 MB maximum
          </span>
          <input
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            onChange={acceptFile}
          />
        </label>
      </div>
    </main>
  );
}

function PendingView({
  imageUrl,
  status,
}: {
  imageUrl: string;
  status: "uploading" | "analyzing";
}) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#0b0c0c] p-3 text-stone-100 sm:p-6">
      <div className="public-progress absolute inset-x-0 top-0 h-px bg-stone-300/70" />
      <img
        src={imageUrl}
        alt="Your uploaded visual"
        className="block max-h-[calc(100dvh-5rem)] max-w-full object-contain"
      />
      <p className="absolute bottom-4 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
        {status === "uploading" ? "Preparing image" : "Looking closely"}
      </p>
    </main>
  );
}

function TerminalView({
  imageUrl,
  kind,
  onRetry,
  onReset,
}: {
  imageUrl: string | null;
  kind: "zero" | "error";
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <main className="min-h-[100dvh] bg-[#0b0c0c] px-4 py-6 text-stone-100 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl flex-col items-center justify-center gap-7">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Your uploaded visual"
            className="block max-h-[62dvh] max-w-full object-contain"
          />
        )}
        <div className="max-w-xl text-center">
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">
            {kind === "zero"
              ? "Nothing strong enough to show"
              : "We couldn’t complete this image"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-400">
            {kind === "zero"
              ? "Noesis did not find a sufficiently strong discovery in this visual."
              : "Please try once more or choose another image."}
          </p>
          <div className="mt-6 flex justify-center gap-5 text-sm">
            {kind === "error" && imageUrl && (
              <button
                type="button"
                onClick={onRetry}
                className="underline decoration-stone-600 underline-offset-4 hover:text-white"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onReset}
              className="underline decoration-stone-600 underline-offset-4 hover:text-white"
            >
              Choose another image
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ReadyView({
  imageUrl,
  result,
  onReset,
}: {
  imageUrl: string;
  result: PublicDiscoveryViewModel;
  onReset: () => void;
}) {
  const [mode, setMode] = useState<ReadyMode>("sequence");
  const [activeIndex, setActiveIndex] = useState(0);
  const [overviewFocus, setOverviewFocus] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [looking, setLooking] = useState(false);
  const [hasUsedHold, setHasUsedHold] = useState(false);

  const discovery = result.discoveries[activeIndex]!;
  const allRegions = useMemo(
    () => uniqueRegions(result.discoveries),
    [result.discoveries],
  );
  const focusedOverviewDiscovery =
    overviewFocus === null ? null : result.discoveries[overviewFocus];
  const visibleRegions =
    mode === "sequence"
      ? discovery.regions
      : (focusedOverviewDiscovery?.regions ?? allRegions);
  const placement = publicTextPlacement(discovery.regions);

  const beginLooking = () => {
    setLooking(true);
    setHasUsedHold(true);
  };
  const stopLooking = () => setLooking(false);
  const selectDiscovery = (index: number) => {
    setActiveIndex(index);
    setMode("sequence");
    setOverviewFocus(null);
    setExpanded(false);
    setSourcesOpen(false);
  };
  const next = () => {
    if (activeIndex >= result.discoveries.length - 1) {
      setMode("overview");
      setOverviewFocus(null);
      return;
    }
    selectDiscovery(activeIndex + 1);
  };
  const previous = () => {
    if (activeIndex > 0) selectDiscovery(activeIndex - 1);
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) beginLooking();
        return;
      }
      if (mode === "sequence" && event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      } else if (mode === "sequence" && event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setMode("overview");
        setOverviewFocus(null);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        stopLooking();
      }
    };
    const release = () => stopLooking();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
    };
  }, [activeIndex, mode, result.discoveries.length]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginLooking();
  };
  const pointerRelease = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopLooking();
  };

  const controlsClass = `transition-opacity duration-200 ${
    looking ? "pointer-events-none opacity-0" : "opacity-100"
  }`;

  const copy = (
    <DiscoveryCopy
      discovery={discovery}
      expanded={expanded}
      sourcesOpen={sourcesOpen}
      onToggleExpanded={() => setExpanded((value) => !value)}
      onToggleSources={() => setSourcesOpen((value) => !value)}
      showHoldHint={activeIndex === 0 && !hasUsedHold}
    />
  );

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#0b0c0c] text-stone-100 md:flex md:items-center md:justify-center md:p-5">
      <div className="w-full md:w-auto md:max-w-full">
        <div
          className="relative mx-auto w-fit max-w-full touch-none select-none"
          onPointerDown={pointerDown}
          onPointerUp={pointerRelease}
          onPointerCancel={pointerRelease}
          onContextMenu={(event) => event.preventDefault()}
        >
          <img
            src={imageUrl}
            alt="Visual with discovery focus"
            draggable={false}
            className="block max-h-[58dvh] max-w-full object-contain md:max-h-[calc(100dvh-2.5rem)] md:max-w-[calc(100vw-2.5rem)]"
          />
          <FocusMask
            regions={visibleRegions}
            overview={mode === "overview" && overviewFocus === null}
          />

          <div
            data-public-controls
            className={`absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-3 text-xs text-stone-200 sm:p-5 ${controlsClass}`}
          >
            <p className="bg-black/45 px-2 py-1 backdrop-blur-sm">
              {discoveryCount(result.discoveries.length)}
            </p>
            <button
              type="button"
              onClick={onReset}
              aria-label="Choose another image"
              className="bg-black/45 p-2 text-stone-300 backdrop-blur-sm transition-colors hover:text-white"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {mode === "sequence" ? (
            <div
              data-public-controls
              className={`absolute bottom-5 hidden max-w-[min(42rem,72%)] bg-black/72 p-3 backdrop-blur-md md:block ${
                placement === "right" ? "right-5" : "left-5"
              } ${controlsClass}`}
            >
              {copy}
              <div className="mt-3 border-t border-white/15 pt-1">
                <SequenceControls
                  index={activeIndex}
                  total={result.discoveries.length}
                  onPrevious={previous}
                  onNext={next}
                />
              </div>
            </div>
          ) : (
            <div
              data-public-controls
              className={`absolute bottom-5 left-5 right-5 hidden max-h-[64%] overflow-y-auto bg-black/76 p-5 backdrop-blur-md md:block lg:right-auto lg:max-w-xl ${controlsClass}`}
            >
              <OverviewList
                discoveries={result.discoveries}
                onFocus={setOverviewFocus}
                onSelect={selectDiscovery}
              />
            </div>
          )}
        </div>

        <div
          data-public-controls
          className={`px-5 py-6 md:hidden ${controlsClass}`}
        >
          {mode === "sequence" ? (
            <>
              {copy}
              <div className="mt-5 border-t border-white/15 pt-2">
                <SequenceControls
                  index={activeIndex}
                  total={result.discoveries.length}
                  onPrevious={previous}
                  onNext={next}
                />
              </div>
            </>
          ) : (
            <OverviewList
              discoveries={result.discoveries}
              onFocus={setOverviewFocus}
              onSelect={selectDiscovery}
            />
          )}
        </div>
      </div>
    </main>
  );
}

export function PublicDiscovery() {
  const [status, setStatus] = useState<PublicStatus>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<PublicDiscoveryViewModel | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!imageUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    const fixture = params.get("fixture");
    const demoState = params.get("demo-state");
    if (fixture !== "asia" && demoState !== "zero" && demoState !== "error") {
      return;
    }
    let cancelled = false;
    void import("../dev/publicDemoFixture").then((module) => {
      if (cancelled) return;
      setImageUrl(module.PUBLIC_DEMO_FIXTURE.imageUrl);
      setFile(null);
      if (demoState === "zero") {
        setResult(null);
        setStatus("zero");
      } else if (demoState === "error") {
        setResult(null);
        setStatus("error");
      } else {
        const publicResult = toPublicDiscovery(
          module.PUBLIC_DEMO_FIXTURE.result,
        );
        setResult(publicResult);
        setStatus(publicResult.discoveries.length === 0 ? "zero" : "ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const analyze = async (nextFile: File) => {
    const requestId = ++requestSequence.current;
    setStatus("uploading");
    try {
      const dataUrl = await fileToDataUrl(nextFile);
      if (requestId !== requestSequence.current) return;
      setStatus("analyzing");
      const discoveryId = await startDiscovery(dataUrl, "v2-hybrid");
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (requestId !== requestSequence.current) return;
        const job = await getDiscoveryStatus(discoveryId);
        if (requestId !== requestSequence.current) return;
        if (job.status === "done") {
          const publicResult = toPublicDiscovery(job.result);
          setResult(publicResult);
          setStatus(publicResult.discoveries.length === 0 ? "zero" : "ready");
          return;
        }
        if (job.status === "error" || Date.now() > deadline) {
          setStatus("error");
          return;
        }
      }
    } catch {
      if (requestId === requestSequence.current) setStatus("error");
    }
  };

  const selectFile = (nextFile: File) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(nextFile.type)) {
      setImageUrl(null);
      setFile(null);
      setStatus("error");
      return;
    }
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setImageUrl(null);
      setFile(null);
      setStatus("error");
      return;
    }
    const url = URL.createObjectURL(nextFile);
    setImageUrl(url);
    setFile(nextFile);
    setResult(null);
    void analyze(nextFile);
  };

  const reset = () => {
    requestSequence.current += 1;
    setFile(null);
    setImageUrl(null);
    setResult(null);
    setStatus("idle");
  };

  if (status === "idle") return <IdleView onFile={selectFile} />;
  if ((status === "uploading" || status === "analyzing") && imageUrl) {
    return <PendingView imageUrl={imageUrl} status={status} />;
  }
  if (status === "ready" && imageUrl && result) {
    return <ReadyView imageUrl={imageUrl} result={result} onReset={reset} />;
  }
  if (status === "zero") {
    return (
      <TerminalView
        imageUrl={imageUrl}
        kind="zero"
        onRetry={() => undefined}
        onReset={reset}
      />
    );
  }
  return (
    <TerminalView
      imageUrl={imageUrl}
      kind="error"
      onRetry={() => {
        if (file) void analyze(file);
      }}
      onReset={reset}
    />
  );
}
