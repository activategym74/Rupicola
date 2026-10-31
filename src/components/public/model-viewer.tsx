"use client";
import { useEffect, useState } from "react";

/** Visor 3D (GLB/glTF) con rotación, zoom y ángulos. Si no hay modelo, la foto. */
export function Product3D({ src, poster, alt }: { src: string | null; poster: string | null; alt: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (src) import("@google/model-viewer").then(() => setReady(true)); }, [src]);
  if (!src) return poster ? <img src={poster} alt={alt} className="h-full w-full object-cover" /> : null;
  if (!ready) return poster ? <img src={poster} alt={alt} className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-sand-50" />;
  return (
    // @ts-expect-error elemento web personalizado
    <model-viewer src={src} poster={poster ?? undefined} alt={alt} camera-controls touch-action="pan-y" auto-rotate shadow-intensity="1"
      exposure="1.05" ar ar-modes="webxr scene-viewer quick-look" style={{ width: "100%", height: "100%", background: "#F7F5F0" }} />
  );
}
