import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { analyzeImage, getAnalysisStatus } from '@workspace/api-client-react';

import { UploadScreen } from './components/UploadScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { ResultScreen } from './components/ResultScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { type NoesisAnalysis, type NoesisScreen } from './lib/types';

const queryClient = new QueryClient();

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image file"));
    reader.readAsDataURL(file);
  });
}

function NoesisApp() {
  const [screen, setScreen] = useState<NoesisScreen>("upload");
  const [imageObjUrl, setImageObjUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<NoesisAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(-1);
  // Monotonic request identity: only the latest analysis request may update
  // the screen — stale completions (retry/double-click races) are ignored.
  const analysisRequestSeq = useRef(0);
  // Id of the currently running (non-superseded) analysis, or null.
  const runningRequestId = useRef<number | null>(null);

  // Single owner for the object URL lifecycle: revokes the active URL on
  // replacement (new upload), reset (back to null), and unmount.
  useEffect(() => {
    if (!imageObjUrl) return;
    return () => URL.revokeObjectURL(imageObjUrl);
  }, [imageObjUrl]);

  // The analysis takes about 2 minutes server-side (two model passes), which
  // exceeds proxy limits on a single long request — so the backend returns a
  // job id and the client polls for the result.
  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS = 6 * 60 * 1000;

  const runAnalysis = async (file: File) => {
    // Guard double submission: block only while an active, non-superseded
    // run exists (a reset supersedes the run and unblocks immediately).
    if (
      runningRequestId.current !== null &&
      runningRequestId.current === analysisRequestSeq.current
    ) {
      return;
    }
    const requestId = ++analysisRequestSeq.current;
    runningRequestId.current = requestId;
    setScreen("loading");
    setAnalyzeError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { analysis_id } = await analyzeImage({ image_data_url: dataUrl });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (requestId !== analysisRequestSeq.current) return; // superseded
        const status = await getAnalysisStatus(analysis_id);
        if (requestId !== analysisRequestSeq.current) return; // superseded
        if (status.status === "done" && status.analysis) {
          setAnalysis(status.analysis);
          setStepIndex(-1);
          setScreen("result");
          return;
        }
        if (status.status === "error") {
          throw new Error(
            status.error ?? "The analysis failed to complete.",
          );
        }
        if (Date.now() > deadline) {
          throw new Error("The analysis timed out. Please try again.");
        }
      }
    } catch (err) {
      if (requestId !== analysisRequestSeq.current) return; // superseded
      setAnalyzeError(
        err instanceof Error ? err.message : "The analysis failed to complete.",
      );
      setScreen("error");
    } finally {
      if (runningRequestId.current === requestId) {
        runningRequestId.current = null;
      }
    }
  };

  const handleUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageObjUrl(url);
    setImageFile(file);
    setAnalysis(null);
    void runAnalysis(file);
  };

  const handleRetry = () => {
    if (imageFile) {
      void runAnalysis(imageFile);
    }
  };

  const handleReset = () => {
    analysisRequestSeq.current += 1; // invalidate any in-flight analysis
    setImageObjUrl(null);
    setImageFile(null);
    setAnalysis(null);
    setAnalyzeError(null);
    setScreen("upload");
    setStepIndex(-1);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground selection:bg-primary/20">
      {screen === "upload" && (
        <UploadScreen onUpload={handleUpload} />
      )}
      {screen === "loading" && (
        <LoadingScreen />
      )}
      {screen === "error" && (
        <ErrorScreen
          message={analyzeError}
          imageUrl={imageObjUrl}
          onRetry={handleRetry}
          onStartOver={handleReset}
        />
      )}
      {screen === "result" && imageObjUrl && analysis && (
        <ResultScreen 
          imageUrl={imageObjUrl} 
          analysis={analysis}
          stepIndex={stepIndex}
          setStepIndex={setStepIndex}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={NoesisApp} />
              <Route>
                <div className="flex h-screen items-center justify-center bg-background text-foreground">
                  404 - Not Found
                </div>
              </Route>
            </Switch>
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
