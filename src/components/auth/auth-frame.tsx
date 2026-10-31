import { Logo } from "@/components/brand/logo";

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-burgundy lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -right-40 -bottom-40 h-[520px] w-[520px] rounded-full border-[60px] border-sand/10" />
        <Logo size={56} tone="light" tagline />
        <div className="relative max-w-md">
          <p className="font-display text-4xl leading-tight text-ivory">Todo RUPÍCOLA en un solo lugar.</p>
          <p className="mt-3 text-sand/90">Cocina, bar, cafetería, tienda y domicilios conectados en tiempo real, desde el local o desde casa.</p>
        </div>
        <p className="text-xs text-sand/60">© {new Date().getFullYear()} RUPÍCOLA</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 lg:hidden"><Logo size={48} tagline /></div>
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-charcoal/60">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
