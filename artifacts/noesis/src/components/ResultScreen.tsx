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
    <div className="flex-1 flex flex-col lg:flex-row min-h-[100dvh] w-full max-w-[1800px] mx-auto bg-background shadow-2xl">
      {/* LEFT: Canvas */}
      <div className="w-full lg:w-[55%] xl:w-[60%] p-4 lg:p-8 flex flex-col items-center justify-center bg-muted/20 border-b lg:border-b-0 lg:border-r border-border min-h-[40vh] lg:min-h-screen sticky top-0 z-10 lg:static">
        <VisualCanvas 
          imageUrl={imageUrl} 
          analysis={analysis}
          stepIndex={stepIndex}
          setStepIndex={setStepIndex}
        />
      </div>

      {/* RIGHT: Panel */}
      <div className="w-full lg:w-[45%] xl:w-[40%] flex flex-col lg:h-[100dvh] bg-card relative z-20 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] lg:shadow-none">
        <div className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-12">
          <WalkthroughPanel 
            analysis={analysis} 
            stepIndex={stepIndex} 
            setStepIndex={setStepIndex}
            onReset={onReset}
          />
        </div>
        
        {stepIndex >= 0 && (
          <div className="border-t border-border p-6 lg:px-10 bg-card shrink-0">
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
