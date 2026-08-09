import { type NoesisAnalysis } from '../lib/types';
import { ArrowRight, Info, BookOpen, Layers, Lightbulb, RotateCcw } from 'lucide-react';

interface WalkthroughPanelProps {
  analysis: NoesisAnalysis;
  stepIndex: number;
  setStepIndex: (index: number) => void;
  onReset: () => void;
}

export function WalkthroughPanel({ analysis, stepIndex, setStepIndex, onReset }: WalkthroughPanelProps) {
  
  if (stepIndex === -1) {
    return (
      <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="flex items-center gap-3 text-muted-foreground mb-4 font-mono text-xs uppercase tracking-widest font-medium">
          <Layers className="w-4 h-4 text-primary" />
          <span>{analysis.image_type}</span>
        </div>
        
        <h2 className="text-3xl xl:text-4xl font-semibold text-foreground mb-6 leading-tight font-serif tracking-tight">
          {analysis.title}
        </h2>
        
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info className="w-4 h-4" /> The Core Question
            </h3>
            <p className="text-lg text-foreground/90 font-medium leading-relaxed">
              {analysis.central_question}
            </p>
          </div>
          
          <div className="bg-muted/40 p-5 rounded-xl border border-border/50">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
              Overview
            </h3>
            <p className="text-base text-foreground/80 leading-relaxed">
              {analysis.overall_summary}
            </p>
          </div>
          
          <div className="bg-primary/5 border-l-4 border-primary p-5 rounded-r-xl">
            <h3 className="text-xs font-mono text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" /> Big Takeaway
            </h3>
            <p className="text-base text-primary/90 font-medium leading-relaxed">
              {analysis.big_takeaway}
            </p>
          </div>
        </div>
        
        <div className="mt-7 flex flex-col gap-2">
          <button 
            onClick={() => setStepIndex(0)}
            className="w-full bg-primary text-primary-foreground py-3.5 rounded-lg font-medium text-base tracking-wide hover:bg-primary/90 transition-all flex items-center justify-center gap-3 shadow-md group"
          >
            Start Walkthrough
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
          
          <button 
            onClick={onReset}
            className="w-full text-muted-foreground hover:text-foreground py-3 font-medium transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Upload different image
          </button>
        </div>
      </div>
    );
  }
  
  if (stepIndex === analysis.regions.length) {
    return (
      <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500 justify-center">
        <div className="bg-primary/5 border border-primary/20 p-8 md:p-12 rounded-2xl text-center shadow-sm">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lightbulb className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl md:text-3xl font-serif font-semibold mb-6">Conclusion</h2>
          <p className="text-xl text-foreground/90 font-medium leading-relaxed mb-10">
            {analysis.big_takeaway}
          </p>
          
          <div className="flex flex-col gap-3 max-w-sm mx-auto w-full">
            <button 
              onClick={() => setStepIndex(-1)}
              className="w-full bg-primary text-primary-foreground px-6 py-4 rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-sm"
            >
              Back to Overview
            </button>
            <button 
              onClick={onReset}
              className="w-full text-muted-foreground hover:text-foreground px-6 py-4 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Upload different image
            </button>
          </div>
        </div>
      </div>
    );
  }

  const region = analysis.regions[stepIndex];
  const hasRelated = region.related_region_ids && region.related_region_ids.length > 0;

  return (
    <div key={region.id} className="flex flex-col h-full animate-in slide-in-from-right-2 fade-in duration-300">
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <span className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-mono font-bold text-lg shadow-sm shrink-0">
            {region.sequence_order}
          </span>
          <h2 className="text-2xl xl:text-3xl font-serif font-semibold text-foreground tracking-tight leading-tight">
            {region.label}
          </h2>
        </div>
        
        <p className="text-lg text-foreground/90 leading-relaxed font-medium">
          {region.explanation}
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-muted/30 p-5 rounded-xl border border-border/50">
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
            Why it matters
          </h3>
          <p className="text-base text-foreground/80 leading-relaxed">
            {region.why_it_matters}
          </p>
        </div>

        {hasRelated && region.relationship_explanation && (
          <div className="bg-primary/5 p-5 rounded-xl border border-primary/20">
            <h3 className="text-xs font-mono text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Connections
            </h3>
            <p className="text-base text-foreground/80 leading-relaxed">
              {region.relationship_explanation}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
