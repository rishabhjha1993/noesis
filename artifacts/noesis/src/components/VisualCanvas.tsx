import { type NoesisAnalysis } from '../lib/types';
import { Hotspot } from './Hotspot';

interface VisualCanvasProps {
  imageUrl: string;
  analysis: NoesisAnalysis;
  stepIndex: number;
  setStepIndex: (index: number) => void;
}

export function VisualCanvas({ imageUrl, analysis, stepIndex, setStepIndex }: VisualCanvasProps) {
  // Find current region and related ones
  const currentRegion = stepIndex >= 0 && stepIndex < analysis.regions.length 
    ? analysis.regions[stepIndex] 
    : null;
    
  const relatedRegionIds = currentRegion?.related_region_ids || [];

  return (
    <div className="relative w-full h-full min-h-0 flex items-center justify-center rounded-xl bg-card border border-border p-3 lg:p-4 shadow-sm overflow-hidden">
      {/* 
        CRITICAL: The container must be inline-block and shrink-wrap the image exactly,
        so that absolute percentage positioning for the hotspots aligns perfectly with the image contents.
        Do NOT use object-contain on the image; rely on natural browser layout scaling via max-w/max-h.
      */}
      <div className="relative inline-block max-w-full max-h-full transition-transform duration-500">
        <img 
          src={imageUrl} 
          alt="Analyzed visual" 
          className="max-w-full max-h-[78vh] lg:max-h-[calc(100dvh-4rem)] block rounded-sm"
          style={{ width: 'auto', height: 'auto' }}
        />
        
        {analysis.regions.map((region, idx) => {
          // Determine state
          let state: 'idle' | 'current' | 'related' | 'dimmed' = 'idle';
          
          if (stepIndex === -1 || stepIndex === analysis.regions.length) {
            state = 'idle';
          } else if (region.id === currentRegion?.id) {
            state = 'current';
          } else if (relatedRegionIds.includes(region.id)) {
            state = 'related';
          } else {
            state = 'dimmed';
          }

          return (
            <Hotspot 
              key={region.id}
              region={region}
              state={state}
              onClick={() => setStepIndex(idx)}
            />
          );
        })}
      </div>
    </div>
  );
}
