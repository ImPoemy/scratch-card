
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface ScratchCardProps {
  width: number;
  height: number;
  prize: number;
  onReveal: () => void;
  isRevealedInitial: boolean;
}

const ScratchCard: React.FC<ScratchCardProps> = ({ width, height, prize, onReveal, isRevealedInitial }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScratching, setIsScratching] = useState(false);
  const [revealed, setRevealed] = useState(isRevealedInitial);

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (isRevealedInitial) {
        // If already revealed (played today), clear canvas immediately
        ctx.clearRect(0, 0, width, height);
        return;
    }

    // Draw the scratch cover
    ctx.fillStyle = '#CCCCCC'; // Silver color
    ctx.fillRect(0, 0, width, height);
    
    // Add some texture/text to the cover
    ctx.fillStyle = '#888888';
    ctx.font = 'bold 30px sans-serif'; // Increased font size
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('刮開領獎', width / 2, height / 2);
    
    // Add "Confetti" pattern on silver
    for(let i=0; i<30; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#AAAAAA' : '#DDDDDD';
        ctx.beginPath();
        ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 5 + 2, 0, Math.PI*2);
        ctx.fill();
    }

  }, [width, height, isRevealedInitial]);

  const calculateRevealPercentage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    // This is computationally expensive, so we don't do it every frame
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    let transparentPixels = 0;
    
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) { // Alpha channel check
        transparentPixels++;
      }
    }

    return (transparentPixels / (pixels.length / 4)) * 100;
  }, [width, height]);

  const handleScratch = (clientX: number, clientY: number) => {
    if (revealed) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Check progress rarely to save performance, maybe on mouse up strictly? 
    // Or just throttle manually. Let's do it on end.
  };

  const startScratching = () => setIsScratching(true);
  
  const stopScratching = () => {
    setIsScratching(false);
    if (!revealed) {
        const percent = calculateRevealPercentage();
        if (percent > 40) { // Auto reveal after 40%
            setRevealed(true);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) {
                ctx.clearRect(0, 0, width, height);
            }
            onReveal();
        }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isScratching) return;
    handleScratch(e.clientX, e.clientY);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isScratching) return;
    const touch = e.touches[0];
    handleScratch(touch.clientX, touch.clientY);
  };

  return (
    <div 
        ref={containerRef}
        className="relative bg-white rounded-xl overflow-hidden shadow-2xl border-4 border-yellow-500"
        style={{ width, height }}
    >
      {/* Underlying Prize */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-red-100 to-yellow-100 z-0">
         <h3 className="text-2xl font-serif text-red-800 mb-2">恭喜獲得</h3>
         <div className="text-5xl font-black text-red-600 drop-shadow-md">
            ${prize}
         </div>
         <p className="text-base text-yellow-700 mt-2 font-serif">龍馬精神 大吉大利</p>
      </div>

      {/* Scratch Layer */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="absolute inset-0 z-10 touch-none cursor-crosshair"
        onMouseDown={startScratching}
        onMouseUp={stopScratching}
        onMouseLeave={stopScratching}
        onMouseMove={onMouseMove}
        onTouchStart={startScratching}
        onTouchEnd={stopScratching}
        onTouchMove={onTouchMove}
      />
    </div>
  );
};

export default ScratchCard;
