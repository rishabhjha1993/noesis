import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { useAnalyzeImage } from '@workspace/api-client-react';

import { UploadScreen } from './components/UploadScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { ResultScreen } from './components/ResultScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { type NoesisAnalysis, type NoesisScreen } from './lib/types';

const queryClient = new QueryClient();

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';
const ALLOWED_MEDIA_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/webp']);

function normalizeMediaType(type: string): ImageMediaType {
  if (type === 'image/jpg') return 'image/jpeg';
  return ALLOWED_MEDIA_TYPES.has(type) ? (type as ImageMediaType) : 'image/png';
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function NoesisApp() {
  const [screen, setScreen] = useState<NoesisScreen>("upload");
  const [imageObjUrl, setImageObjUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<NoesisAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(-1);
  const analyze = useAnalyzeImage();
  // Monotonic request identity: only the latest analysis request may update
  // the screen — stale completions (retry/double-click races) are ignored.
  const analysisRequestSeq = useRef(0);

  // Single owner for the object URL lifecycle: revokes the active URL on
  // replacement (new upload), reset (back to null), and unmount.
  useEffect(() => {
    if (!imageObjUrl) return;
    return () => URL.revokeObjectURL(imageObjUrl);
  }, [imageObjUrl]);

  const runAnalysis = async (file: File) => {
    if (analyze.isPending) return; // guard double submission
    const requestId = ++analysisRequestSeq.current;
    setScreen("loading");
    setAnalyzeError(null);
    try {
      const image = await fileToBase64(file);
      const result = await analyze.mutateAsync({
        data: { image, mediaType: normalizeMediaType(file.type) },
      });
      if (requestId !== analysisRequestSeq.current) return; // superseded
      setAnalysis(result);
      setStepIndex(-1);
      setScreen("result");
    } catch (err) {
      if (requestId !== analysisRequestSeq.current) return; // superseded
      setAnalyzeError(
        err instanceof Error ? err.message : "The analysis failed to complete.",
      );
      setScreen("error");
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
