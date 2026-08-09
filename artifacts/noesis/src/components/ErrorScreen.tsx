import { AlertTriangle, RotateCcw, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorScreenProps {
  message: string | null;
  imageUrl: string | null;
  onRetry: () => void;
  onStartOver: () => void;
}

// Shown when the analysis request fails. The uploaded image is retained so
// the user can retry without re-uploading; the mock data is never substituted.
export function ErrorScreen({ message, imageUrl, onRetry, onStartOver }: ErrorScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-screen bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-sm p-8 md:p-10 text-center">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Your uploaded visual"
            className="mx-auto mb-6 max-h-40 rounded-md border border-border object-contain"
          />
        )}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="font-serif text-2xl mb-3 text-foreground">
          The analysis didn't complete
        </h2>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          {message ?? "Something went wrong while reading your visual."}{" "}
          Your image is still here — you can simply try again.
        </p>
        <div className="flex flex-col gap-3">
          <Button onClick={onRetry} className="w-full gap-2">
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
          <Button onClick={onStartOver} variant="outline" className="w-full gap-2">
            <ImagePlus className="h-4 w-4" />
            Choose a different image
          </Button>
        </div>
      </div>
    </div>
  );
}
