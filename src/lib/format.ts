const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export const money = (n: number | string | null | undefined) => cop.format(Number(n ?? 0));
export const num = (n: number | string | null | undefined, d = 0) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: d }).format(Number(n ?? 0));
export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";
export const time = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—";
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
export const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
};
export function minutesSince(s: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(s).getTime()) / 60000));
}
/** Mensaje legible desde un error de Supabase/PostgREST */
export function errMsg(e: unknown): string {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message ?? String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión con el servidor. Verifique su internet.";
  return m;
}
