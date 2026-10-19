import { useSyncExternalStore } from "react";
import { redirect } from "@tanstack/react-router";
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "accountant";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const [{ data: roles }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      supabase.from("profiles").select("full_name, disabled_at").eq("id", u.user.id).maybeSingle(),
    ]);
    const list = (roles ?? []).map((r) => r.role as Role);
    // A disabled account has no role, whatever user_roles says.
    const role: Role | null = profile?.disabled_at ? null : list.includes("admin") ? "admin" : list[0] ?? null;
    return { id: u.user.id, email: u.user.email ?? "", name: profile?.full_name ?? "", role };
  },
});

// "View as" override so admins can preview the accountant experience.
// UI-only: database access is still enforced by the real role via RLS.
const VIEW_KEY = "view-as-role";
const listeners = new Set<() => void>();

export function getViewAs(): Role | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "admin" || v === "accountant" ? v : null;
  } catch {
    return null;
  }
}

export function setViewAs(role: Role | null) {
  try {
    if (role) localStorage.setItem(VIEW_KEY, role);
    else localStorage.removeItem(VIEW_KEY);
  } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

type Me = NonNullable<Awaited<ReturnType<NonNullable<typeof meQuery.queryFn>>>>;

/** Applies the override only when the signed-in user is really an admin. */
export function effectiveRole(realRole: Role | null): Role | null {
  return realRole === "admin" ? getViewAs() ?? "admin" : realRole;
}

export const ACCOUNTANT_PAGES = ["/dashboard", "/clients", "/invoices", "/expenses", "/vendors"] as const;

/** Accountants may open their pages and a single event page (without cost or profit), never the events list or reports. */
export function accountantMayVisit(pathname: string): boolean {
  return ACCOUNTANT_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || /^\/events\/[^/]+\/?$/.test(pathname);
}

export function useMe() {
  const q = useQuery(meQuery);
  const view = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getViewAs,
    () => null,
  );
  const data: (Me & { realRole: Role | null }) | null | undefined = q.data
    ? { ...q.data, realRole: q.data.role, role: q.data.role === "admin" ? view ?? "admin" : q.data.role }
    : (q.data as null | undefined);
  return { ...q, data };
}

/**
 * Route guard for beforeLoad. Asks the Auth server who the user is (getUser, not
 * getSession) and reloads the role every time, so a demoted or disabled user is
 * stopped on the next navigation. The database policies are the real enforcement.
 */
export async function requireRole(queryClient: QueryClient, allowed: readonly Role[]) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw redirect({ to: "/auth" });
  const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  const role = effectiveRole(me?.role ?? null);
  // No role (never invited, or disabled): nothing to show, and /dashboard would loop back here.
  if (!role) throw redirect({ to: "/no-access" });
  if (!allowed.includes(role)) throw redirect({ to: "/dashboard" });
}

/** Profile name, else the part of the e-mail before "@", else "there". */
export function displayName(me: { name?: string | null; email?: string | null } | null | undefined): string {
  return me?.name?.trim() || me?.email?.split("@")[0]?.trim() || "there";
}
