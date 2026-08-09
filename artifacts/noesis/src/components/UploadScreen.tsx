import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';

export function UploadScreen({ onUpload }: { onUpload: (file: File) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateAndSetFile = (file: File) => {
    if (!file.type.match(/image\/(png|jpg|jpeg|webp)/)) {
      setError("Please upload a valid image file (PNG, JPG, WebP).");
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-screen">
      <div className="max-w-xl w-full flex flex-col items-center">
        <h1 className="text-4xl md:text-5xl font-mono tracking-widest text-primary mb-3 font-bold">NOESIS</h1>
        <p className="text-muted-foreground text-lg mb-10 font-light tracking-wide text-center">
          Understand complex visuals, step by step.
        </p>

        {!selectedFile ? (
          <div
            className={`w-full p-12 border-2 border-dashed rounded-xl transition-all duration-300 flex flex-col items-center justify-center text-center
              ${isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
              <UploadCloud className="text-primary/70 h-8 w-8" />
            </div>
            <h3 className="text-xl font-medium mb-2 font-serif">Upload your diagram</h3>
            <p className="text-muted-foreground mb-8 max-w-sm">
              Drag and drop an image here, or click to browse. We support PNG, JPG, and WebP.
            </p>
            
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden" 
              accept="image/png, image/jpeg, image/jpg, image/webp"
              onChange={handleFileChange}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-card text-foreground border border-border px-8 py-3 rounded-md font-medium tracking-wide hover:bg-muted transition-colors shadow-sm"
            >
              Choose File
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center animate-in fade-in duration-500">
            <div className="relative w-full aspect-[4/3] mb-8 bg-card rounded-xl overflow-hidden border border-border shadow-sm p-4">
              {previewUrl && (
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="w-full h-full object-contain"
                />
              )}
              <button 
                onClick={() => setSelectedFile(null)}
                className="absolute top-4 right-4 h-8 w-8 bg-background/80 backdrop-blur rounded-full flex items-center justify-center hover:bg-background transition-colors border border-border shadow-sm text-muted-foreground hover:text-foreground"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button 
              onClick={() => onUpload(selectedFile)}
              className="bg-primary text-primary-foreground px-10 py-4 rounded-lg font-medium text-lg tracking-wide hover:bg-primary/90 transition-colors shadow-md w-full md:w-auto"
            >
              X-Ray this visual
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 text-accent bg-accent/10 px-4 py-3 rounded-md w-full text-center border border-accent/20 animate-in fade-in slide-in-from-top-2">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
