import { VisualCanvas } from './VisualCanvas';
import { WalkthroughPanel } from './WalkthroughPanel';
import { ProgressControls } from './ProgressControls';
import { type NoesisAnalysis } from '../lib/types';

interface ResultScreenProps {
  imageUrl: string;
  analysis: NoesisAnalysis;
  stepIndex: number;
  setStepIndex: (index: number) => void;
  onReset: () => void;
}

export function ResultScreen({ imageUrl, analysis, stepIndex, setStepIndex, onReset }: ResultScreenProps) {
  const totalSteps = analysis.regions.length;

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden w-full max-w-[1800px] mx-auto bg-background shadow-2xl">
      {/* LEFT: Canvas */}
      <div className="w-full lg:w-[62%] p-4 lg:p-6 flex flex-col items-center justify-center bg-muted/20 border-b lg:border-b-0 lg:border-r border-border min-h-[40vh] lg:min-h-0 lg:h-full sticky top-0 z-10 lg:static">
        <VisualCanvas 
          imageUrl={imageUrl} 
          analysis={analysis}
          stepIndex={stepIndex}
          setStepIndex={setStepIndex}
        />
      </div>

      {/* RIGHT: Panel */}
      <div className="w-full lg:w-[38%] flex flex-col lg:h-full lg:min-h-0 bg-card relative z-20 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] lg:shadow-none">
        <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8 lg:p-8 xl:p-10">
          <WalkthroughPanel 
            analysis={analysis} 
            stepIndex={stepIndex} 
            setStepIndex={setStepIndex}
            onReset={onReset}
          />
        </div>
        
        {stepIndex >= 0 && (
          <div className="border-t border-border p-4 lg:px-8 bg-card shrink-0">
            <ProgressControls 
              stepIndex={stepIndex} 
              totalSteps={totalSteps} 
              setStepIndex={setStepIndex} 
            />
          </div>
        )}
      </div>
    </div>
  );
}
