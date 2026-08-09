import { type NoesisRegion } from '../lib/types';

interface HotspotProps {
  region: NoesisRegion;
  state: 'idle' | 'current' | 'related';
  onClick: () => void;
}

export function Hotspot({ region, state, onClick }: HotspotProps) {
  const { x, y, width, height, sequence_order } = region;
  
  // Strict percentage positioning ensures perfect alignment on window resize
  const style = {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };

  let boxClasses = "absolute transition-all duration-500 ease-in-out cursor-pointer rounded-sm box-border ";
  let markerClasses = "absolute -top-3 -left-3 w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm font-bold shadow-md transition-all duration-500 z-10 border border-transparent ";
  
  switch (state) {
    case 'current':
      boxClasses += "border-[3px] border-primary bg-primary/10 z-20 shadow-sm";
      markerClasses += "bg-primary text-primary-foreground scale-110";
      break;
    case 'related':
      boxClasses += "border-[2px] border-dashed border-primary/50 bg-primary/5 z-10";
      markerClasses += "bg-primary/90 text-primary-foreground scale-95 opacity-90";
      break;
    case 'idle':
    default:
      boxClasses += "border border-foreground/30 bg-foreground/5 hover:bg-foreground/10 hover:border-foreground/50 z-0";
      markerClasses += "bg-card text-foreground border-border scale-90 opacity-70";
      break;
  }

  return (
    <button
      type="button"
      aria-label={`Step ${sequence_order}: ${region.label}`}
      className={boxClasses}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className={markerClasses} aria-hidden="true">
        {sequence_order}
      </span>
    </button>
  );
}
