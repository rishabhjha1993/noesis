import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';

import { UploadScreen } from './components/UploadScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { ResultScreen } from './components/ResultScreen';
import { type NoesisScreen } from './lib/types';
import { mockAnalysis } from './lib/mockAnalysis';

const queryClient = new QueryClient();

function NoesisApp() {
  const [screen, setScreen] = useState<NoesisScreen>("upload");
  const [imageObjUrl, setImageObjUrl] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(-1);

  // Single owner for the object URL lifecycle: revokes the active URL on
  // replacement (new upload), reset (back to null), and unmount.
  useEffect(() => {
    if (!imageObjUrl) return;
    return () => URL.revokeObjectURL(imageObjUrl);
  }, [imageObjUrl]);

  const handleUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageObjUrl(url);
    setScreen("loading");
  };

  const handleLoadingComplete = () => {
    setScreen("result");
    setStepIndex(-1);
  };

  const handleReset = () => {
    setImageObjUrl(null);
    setScreen("upload");
    setStepIndex(-1);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground selection:bg-primary/20">
      {screen === "upload" && (
        <UploadScreen onUpload={handleUpload} />
      )}
      {screen === "loading" && (
        <LoadingScreen onComplete={handleLoadingComplete} />
      )}
      {screen === "result" && imageObjUrl && (
        <ResultScreen 
          imageUrl={imageObjUrl} 
          analysis={mockAnalysis}
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
