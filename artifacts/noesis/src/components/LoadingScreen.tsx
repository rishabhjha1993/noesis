import { useEffect, useState } from 'react';

const MESSAGES = [
  "Reading the visual...",
  "Finding the important parts...",
  "Building your walkthrough..."
];

// Purely presentational: the parent (App) drives the transition to the
// result screen when the real analysis request completes.
export function LoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => (prev + 1) % MESSAGES.length);
    }, 2200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-screen bg-background">
      <div className="w-12 h-12 border-4 border-muted border-t-primary rounded-full animate-spin mb-10"></div>
      <div className="h-8 relative overflow-hidden flex items-center justify-center w-full max-w-sm">
        {MESSAGES.map((msg, i) => (
          <p
            key={i}
            className={`absolute font-mono text-lg transition-all duration-500 text-foreground
              ${i === msgIndex ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
            `}
          >
            {msg}
          </p>
        ))}
      </div>
    </div>
  );
}
