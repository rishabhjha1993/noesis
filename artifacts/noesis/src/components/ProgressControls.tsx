import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ProgressControlsProps {
  stepIndex: number;
  totalSteps: number;
  setStepIndex: (index: number) => void;
}

export function ProgressControls({ stepIndex, totalSteps, setStepIndex }: ProgressControlsProps) {
  
  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };

  const handleNext = () => {
    if (stepIndex < totalSteps) {
      setStepIndex(stepIndex + 1);
    }
  };

  const isPrevDisabled = stepIndex <= 0;
  const isNextDisabled = stepIndex >= totalSteps;

  return (
    <div className="flex items-center justify-between w-full">
      <button
        onClick={handlePrev}
        disabled={isPrevDisabled}
        className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="w-5 h-5" />
        Previous
      </button>

      <div className="font-mono text-sm tracking-widest text-muted-foreground font-medium">
        {stepIndex < totalSteps ? (
          <>
            <span className="text-foreground">{stepIndex + 1}</span> OF {totalSteps}
          </>
        ) : (
          <span>END</span>
        )}
      </div>

      <button
        onClick={handleNext}
        disabled={isNextDisabled}
        className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
      >
        Next
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
