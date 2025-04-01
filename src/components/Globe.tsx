// components/Globe.tsx
"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";

export default function Globe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let phi = 4.7; // Initial rotation angle

    if (!canvasRef.current) return;

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2, // Higher resolution for sharper rendering
      width: 600 * 2, // Double for retina displays
      height: 600 * 2,
      phi: 0, // Starting rotation (longitude)
      theta: -0.3, // Tilt (latitude)
      dark: 1, // Dark mode (1 = fully dark base)
      diffuse: 1.2, // Diffuse lighting
      mapSamples: 25000, // Number of sample points for the map
      mapBrightness: 13, // Brightness of the map
      mapBaseBrightness: 0.05, // Base brightness of the map
      baseColor: [0.3, 0.3, 0.3], // Base color (dark gray)
      glowColor: [0.15, 0.15, 0.15], // Glow color (darker gray)
      markerColor: [100, 100, 100], // Marker color (not used here, but kept for future)
      markers: [], // No markers for now; add if needed later
      onRender: (state: { phi?: number }) => {
        // Update rotation on each frame
        state.phi = phi;
        phi += 0.002; // Adjust speed of rotation (slower than original 0.0002)
      },
    });

    // Cleanup function to destroy the globe when the component unmounts
    return () => {
      globe.destroy();
    };
  }, []);

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas
        ref={canvasRef}
        style={{
          width: 600, // Display size (half of internal resolution)
          height: 600,
          maxWidth: "100%", // Responsive scaling
          aspectRatio: "1", // Maintain square aspect ratio
        }}
        className="object-contain"
      />
    </div>
  );
}