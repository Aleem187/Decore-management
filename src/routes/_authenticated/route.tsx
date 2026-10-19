import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Hotel,
  CalendarHeart,
  Receipt,
  Wallet,
  Truck,
  Users,
  UserCog,
  LogOut,
  Menu,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ACCOUNTANT_PAGES, displayName, setViewAs, useMe, type Role } from "@/lib/auth";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

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
  { to: "/users", label: "Users", icon: UserCog, admin: true },
  { to: "/team", label: "Team & Audit", icon: Users, admin: true },
] as const;

type Me = NonNullable<ReturnType<typeof useMe>["data"]>;

// Same content in the fixed desktop sidebar and the mobile/tablet drawer.
function SidebarBody({
  me,
  onNavigate,
  onSignOut,
}: {
  me: Me | null | undefined;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <div className="py-5 pl-6 pr-5">
        <div className="font-display text-2xl font-semibold">Décor Studio</div>
        <div className="text-xs uppercase tracking-widest text-sidebar-primary">
          {me?.role ?? "…"}
        </div>
        {me?.realRole === "admin" && (
          <label className="mt-3 block text-xs text-sidebar-foreground/70">
            View as
            <select
              value={me.role ?? "admin"}
              onChange={(e) =>
                setViewAs(e.target.value === "admin" ? null : (e.target.value as Role))
              }
              className="mt-1 block w-full rounded-md border border-sidebar-border bg-sidebar-accent px-2 py-1.5 text-sm text-sidebar-foreground"
            >
              <option value="admin">Admin</option>
              <option value="accountant">Accountant</option>
            </select>
          </label>
        )}
      </div>
      <nav className="flex flex-col gap-1 px-4">
        {nav
          .filter((n) => !("admin" in n) || me?.role === "admin")
          .map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              className="flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
      </nav>
      <div className="mt-auto border-t border-sidebar-border py-4 pl-6 pr-4">
        <div className="truncate text-sm">{me ? displayName(me) : ""}</div>
        <div className="truncate text-xs opacity-60">{me?.email}</div>
        <button
          onClick={onSignOut}
          className="mt-3 flex items-center gap-2 text-sm text-sidebar-primary"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </>
  );
}

function Shell() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { pathname } = useLocation();
  const role = me?.role;
  useEffect(() => {
    if (role === "accountant" && !ACCOUNTANT_PAGES.some((p) => pathname.startsWith(p))) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [role, pathname, navigate]);
  useEffect(() => setMenuOpen(false), [pathname]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Phones and tablets: top bar with a hamburger that opens the drawer */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="-ml-1 rounded-md p-2 hover:bg-sidebar-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-display text-xl font-semibold">Décor Studio</span>
        <span className="ml-auto text-xs uppercase tracking-widest text-sidebar-primary">
          {me?.role ?? "…"}
        </span>
      </header>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[85vw] flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Main menu</SheetTitle>
          <SheetDescription className="sr-only">Navigate between pages</SheetDescription>
          <SidebarBody me={me} onNavigate={() => setMenuOpen(false)} onSignOut={signOut} />
        </SheetContent>
      </Sheet>

      {/* Desktop: fixed sidebar */}
      <aside className="hidden flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <SidebarBody me={me} onSignOut={signOut} />
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
