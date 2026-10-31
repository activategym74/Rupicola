import { SYMBOL_PATH } from "./symbol-path";
import clsx from "clsx";

/** Marca RUPÍCOLA: círculo borgoña con el símbolo en beige arena (vector fiel al original). */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} role="img" aria-label="RUPÍCOLA">
      <circle cx="256" cy="256" r="256" fill="#791522" />
      <path fill="#D7C5A2" transform="translate(256 256) scale(1.0667) translate(-256 -256)" d={SYMBOL_PATH} />
    </svg>
  );
}

export function Logo({ size = 40, tone = "dark", className, tagline }: { size?: number; tone?: "dark" | "light"; className?: string; tagline?: boolean }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <LogoMark size={size} />
      <div className="leading-none">
        <div className={clsx("font-display font-semibold tracking-[0.18em]", tone === "light" ? "text-ivory" : "text-charcoal")}
          style={{ fontSize: size * 0.5 }}>RUPÍCOLA</div>
        {tagline && <div className={clsx("mt-1 text-[10px] tracking-[0.3em] uppercase", tone === "light" ? "text-sand" : "text-burgundy/80")}>
          Cocina · Bar · Café · Tienda</div>}
      </div>
    </div>
  );
}
