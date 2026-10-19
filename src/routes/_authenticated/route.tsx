import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Hotel, CalendarHeart, Receipt, Wallet, Truck, Users, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { ACCOUNTANT_PAGES, setViewAs, useMe, type Role } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Shell,
});

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarHeart, admin: true },
  { to: "/hotels", label: "Hotels", icon: Hotel, admin: true },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/vendors", label: "Vendors", icon: Truck },
  { to: "/team", label: "Team & Audit", icon: Users, admin: true },
] as const;

function Shell() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { pathname } = useLocation();
  const role = me?.role;
  useEffect(() => {
    if (role === "accountant" && !ACCOUNTANT_PAGES.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [role, pathname, navigate]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 flex flex-col">
        <div className="px-5 py-5">
          <div className="font-display text-2xl font-semibold">Décor Studio</div>
          <div className="text-xs uppercase tracking-widest text-sidebar-primary">{me?.role ?? "…"}</div>
          {me?.realRole === "admin" && (
            <label className="mt-3 block text-xs text-sidebar-foreground/70">
              View as
              <select
                value={me.role ?? "admin"}
                onChange={(e) => setViewAs(e.target.value === "admin" ? null : (e.target.value as Role))}
                className="mt-1 block w-full rounded-md border border-sidebar-border bg-sidebar-accent px-2 py-1.5 text-sm text-sidebar-foreground"
              >
                <option value="admin">Admin</option>
                <option value="accountant">Accountant</option>
              </select>
            </label>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 md:flex-col md:overflow-visible">
          {nav.filter((n) => !("admin" in n) || me?.role === "admin").map((n) => (
            <Link key={n.to} to={n.to}
              className="flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}>
              <n.icon className="h-4 w-4" />{n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-sidebar-border p-4 md:block">
          <div className="truncate text-sm">{me?.name}</div>
          <div className="truncate text-xs opacity-60">{me?.email}</div>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-sidebar-primary"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
        <button onClick={signOut} className="m-3 flex items-center gap-2 text-sm text-sidebar-primary md:hidden"><LogOut className="h-4 w-4" />Sign out</button>
      </aside>
      <main className="flex-1 p-4 md:p-8"><Outlet /></main>
    </div>
  );
}
