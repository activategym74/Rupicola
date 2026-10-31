"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChefHat, Wine, Coffee, Flame } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { useRouter } from "next/navigation";

const ICON: Record<string, React.ReactNode> = { kitchen: <ChefHat size={36} />, bar: <Wine size={36} />, cafe: <Coffee size={36} /> };

export default function StationsPage() {
  const { businessId, can } = useApp();
  const router = useRouter();
  const [stations, setStations] = useState<{ id: string; code: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!businessId) return;
    supabaseBrowser().from("stations").select("id, code, name").eq("business_id", businessId).eq("active", true).order("name")
      .then(({ data }: { data: { id: string; code: string; name: string }[] | null }) => {
        const mine = (data ?? []).filter((s) => can(`kds.${s.code}`));
        if (mine.length === 1) router.replace(`/cocina/${mine[0].code}`);
        setStations(mine);
      });
  }, [businessId, can, router]);
  if (!stations) return <PageLoader />;
  return (
    <div>
      <PageHeader title="Estaciones de preparación" subtitle="Seleccione la pantalla de su estación" />
      <div className="grid gap-4 sm:grid-cols-3">
        {stations.map((s) => (
          <Link key={s.id} href={`/cocina/${s.code}`} className="card flex flex-col items-center gap-3 p-8 text-burgundy transition hover:-translate-y-1 hover:shadow-md">
            {ICON[s.code] ?? <Flame size={36} />}<span className="font-display text-2xl text-charcoal">{s.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
