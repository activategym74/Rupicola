"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { UserPlus, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dateTime, errMsg } from "@/lib/format";
import { PageHeader, PageLoader } from "@/components/ui/bits";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Member = { id: string; full_name: string; phone: string | null; active: boolean; role_id: string; last_seen_at: string | null; created_at: string; user_id: string };
type Role = { id: string; code: string; name: string; is_system: boolean; role_permissions: { permission: string }[] };
type Perm = { code: string; module: string; description: string };

export default function UsersPage() {
  const sb = supabaseBrowser();
  const toast = useToast();
  const { businessId, current } = useApp();
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [invite, setInvite] = useState(false);
  const [editM, setEditM] = useState<Member | null>(null);
  const [editR, setEditR] = useState<Role | "new" | null>(null);

  const load = useCallback(async () => {
    const [m, r, p] = await Promise.all([
      sb.from("members").select("*").eq("business_id", businessId).order("full_name"),
      sb.from("roles").select("id, code, name, is_system, role_permissions(permission)").eq("business_id", businessId).order("name"),
      sb.from("permissions").select("*").order("module"),
    ]);
    setMembers((m.data ?? []) as Member[]); setRoles((r.data ?? []) as Role[]); setPerms(((p.data ?? []) as Perm[]).filter((x) => x.code !== "*"));
  }, [sb, businessId]);
  useEffect(() => { if (businessId) load(); }, [businessId, load]);
  if (!members) return <PageLoader />;
  const modules = [...new Set(perms.map((p) => p.module))];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Usuarios y roles" subtitle="Cada usuario ve solo los módulos y acciones autorizados"
        actions={tab === "users" ? <button className="btn-primary" onClick={() => setInvite(true)}><UserPlus size={16} /> Invitar usuario</button> : <button className="btn-primary" onClick={() => setEditR("new")}><Plus size={16} /> Rol personalizado</button>} />
      <div className="mb-4 flex gap-2">{([["users", "Usuarios"], ["roles", "Roles y permisos"]] as const).map(([k, l]) =>
        <button key={k} onClick={() => setTab(k)} className={clsx("chip border !px-3 !py-1.5", tab === k ? "border-burgundy bg-burgundy text-white" : "border-stone-line bg-white")}>{l}</button>)}</div>
      {tab === "users" ? (
        <div className="card overflow-x-auto"><table className="table-base">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Teléfono</th><th>Última actividad</th><th>Estado</th><th></th></tr></thead>
          <tbody>{members.map((m) => <tr key={m.id}><td className="font-medium">{m.full_name}{m.id === current?.member.id && <span className="ml-1 text-xs text-charcoal/50">(usted)</span>}</td>
            <td>{roles.find((r) => r.id === m.role_id)?.name}</td><td>{m.phone}</td><td>{dateTime(m.last_seen_at)}</td>
            <td>{m.active ? <span className="chip bg-emerald-50 text-emerald-800">Activo</span> : <span className="chip bg-red-50 text-red-700">Inactivo</span>}</td>
            <td><button className="btn-ghost !p-1.5" onClick={() => setEditM(m)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roles.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-center justify-between"><div className="font-medium">{r.name}</div>{r.code !== "admin" && <button className="btn-ghost !p-1.5" onClick={() => setEditR(r)}><Pencil size={16} /></button>}</div>
            <div className="mt-1 text-xs text-charcoal/50">{r.is_system ? "Rol inicial" : "Personalizado"} · {members.filter((m) => m.role_id === r.id).length} usuarios</div>
            <div className="mt-2 flex flex-wrap gap-1">{r.code === "admin" ? <span className="chip bg-burgundy text-white"><ShieldCheck size={12} /> Acceso total</span> :
              r.role_permissions.map((p) => <span key={p.permission} className="chip bg-sand-50 !text-[10px]">{perms.find((x) => x.code === p.permission)?.description ?? p.permission}</span>)}</div>
          </div>))}</div>
      )}

      {invite && (
        <Modal open onClose={() => setInvite(false)} title="Invitar usuario" footer={<button form="inv" className="btn-primary">Enviar invitación</button>}>
          <form id="inv" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            const r = await fetch("/api/users/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: businessId, ...f }) });
            const j = await r.json();
            if (!r.ok) toast("error", j.error); else { toast("success", "Invitación enviada por correo"); setInvite(false); load(); }
          }}>
            <div><label className="label">Nombre completo</label><input name="full_name" required className="input" /></div>
            <div><label className="label">Correo</label><input name="email" type="email" required className="input" /></div>
            <div><label className="label">Teléfono</label><input name="phone" className="input" /></div>
            <div><label className="label">Rol</label><select name="role_id" className="input">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <p className="text-xs text-charcoal/50">El usuario recibirá un correo para crear su contraseña.</p>
          </form>
        </Modal>
      )}
      {editM && (
        <Modal open onClose={() => setEditM(null)} title={editM.full_name} footer={<button form="em" className="btn-primary">Guardar</button>}>
          <form id="em" className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const { error } = await sb.from("members").update({ full_name: f.get("name"), phone: f.get("phone") || null, role_id: f.get("role"), active: f.get("active") === "on" }).eq("id", editM.id);
            if (error) toast("error", errMsg(error)); else { toast("success", "Usuario actualizado"); setEditM(null); load(); }
          }}>
            <div><label className="label">Nombre</label><input name="name" defaultValue={editM.full_name} className="input" /></div>
            <div><label className="label">Teléfono</label><input name="phone" defaultValue={editM.phone ?? ""} className="input" /></div>
            <div><label className="label">Rol</label><select name="role" defaultValue={editM.role_id} className="input" disabled={editM.id === current?.member.id}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={editM.active} disabled={editM.id === current?.member.id} /> Activo (desactivar cierra su acceso de inmediato)</label>
          </form>
        </Modal>
      )}
      {editR && (
        <Modal open wide onClose={() => setEditR(null)} title={editR === "new" ? "Nuevo rol" : `Rol: ${editR.name}`} footer={<button form="er" className="btn-primary">Guardar</button>}>
          <form id="er" onSubmit={async (e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const chosen = perms.filter((p) => f.get(p.code) === "on").map((p) => p.code);
            let id = editR === "new" ? null : editR.id;
            const name = String(f.get("name")).trim();
            if (!id) {
              const { data, error } = await sb.from("roles").insert({ business_id: businessId, name, code: "custom-" + Date.now().toString(36) }).select("id").single();
              if (error) return toast("error", errMsg(error)); id = data.id;
            } else await sb.from("roles").update({ name }).eq("id", id);
            await sb.from("role_permissions").delete().eq("role_id", id);
            if (chosen.length) { const { error } = await sb.from("role_permissions").insert(chosen.map((p) => ({ role_id: id, permission: p }))); if (error) return toast("error", errMsg(error)); }
            toast("success", "Rol guardado"); setEditR(null); load();
          }}>
            <div className="mb-4"><label className="label">Nombre del rol</label><input name="name" required defaultValue={editR === "new" ? "" : editR.name} className="input" /></div>
            <div className="grid gap-4 sm:grid-cols-2">{modules.map((m) => (
              <div key={m}><div className="label">{m}</div>{perms.filter((p) => p.module === m).map((p) => (
                <label key={p.code} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name={p.code} defaultChecked={editR !== "new" && editR.role_permissions.some((x) => x.permission === p.code)} /> {p.description}</label>))}</div>))}</div>
          </form>
        </Modal>
      )}
    </div>
  );
}
