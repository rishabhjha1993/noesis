import { useEffect, useState } from 'react';

const MESSAGES = [
  "Reading the visual...",
  "Finding the important parts...",
  "Building your walkthrough..."
];

export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    // Total delay ~3s. 3 messages, so ~1s each.
    const interval = setInterval(() => {
      setMsgIndex(prev => {
        if (prev < MESSAGES.length - 1) return prev + 1;
        return prev;
      });
    }, 1000);

    const timeout = setTimeout(() => {
      onComplete();
    }, 3200);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-screen bg-background">
      <div className="w-12 h-12 border-4 border-muted border-t-primary rounded-full animate-spin mb-10"></div>
      <div className="h-8 relative overflow-hidden flex items-center justify-center w-full max-w-sm">
        {MESSAGES.map((msg, i) => (
          <p
            key={i}
            className={`absolute font-mono text-lg transition-all duration-500 text-foreground
              ${i === msgIndex ? 'opacity-100 translate-y-0' : i < msgIndex ? 'opacity-0 -translate-y-4' : 'opacity-0 translate-y-4'}
            `}
          >
            {msg}
          </p>
        ))}
      </div>
    </div>
  );
}
