import {
  LayoutDashboard, ShoppingCart, LayoutGrid, ChefHat, Bike, Package, Boxes, Truck, Users, Wallet,
  Receipt, BarChart3, ShieldCheck, UserCog, Settings, Navigation,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; perm: string | string[] };
export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Operación", items: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
    { href: "/pos", label: "Punto de venta", icon: ShoppingCart, perm: "pos.sell" },
    { href: "/mesas", label: "Mesas", icon: LayoutGrid, perm: "tables.view" },
    { href: "/cocina", label: "Cocina · Bar · Café", icon: ChefHat, perm: ["kds.kitchen", "kds.bar", "kds.cafe"] },
    { href: "/domicilios", label: "Domicilios", icon: Bike, perm: "delivery.manage" },
    { href: "/domiciliario", label: "Mis entregas", icon: Navigation, perm: "delivery.courier" },
  ]},
  { section: "Negocio", items: [
    { href: "/catalogo", label: "Catálogo", icon: Package, perm: "catalog.manage" },
    { href: "/inventario", label: "Inventario", icon: Boxes, perm: "inventory.view" },
    { href: "/compras", label: "Compras y proveedores", icon: Truck, perm: "purchases.manage" },
    { href: "/clientes", label: "Clientes", icon: Users, perm: "customers.view" },
  ]},
  { section: "Finanzas", items: [
    { href: "/caja", label: "Caja", icon: Wallet, perm: ["cash.view", "cash.open"] },
    { href: "/gastos", label: "Gastos", icon: Receipt, perm: "expenses.manage" },
    { href: "/reportes", label: "Reportes", icon: BarChart3, perm: "reports.view" },
  ]},
  { section: "Administración", items: [
    { href: "/auditoria", label: "Auditoría", icon: ShieldCheck, perm: "audit.view" },
    { href: "/usuarios", label: "Usuarios y roles", icon: UserCog, perm: "users.manage" },
    { href: "/configuracion", label: "Configuración", icon: Settings, perm: "settings.manage" },
  ]},
];
