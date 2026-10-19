import { useSyncExternalStore } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "accountant";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const [{ data: roles }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      supabase.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle(),
    ]);
    const list = (roles ?? []).map((r) => r.role as Role);
    const role: Role | null = list.includes("admin") ? "admin" : list[0] ?? null;
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

export const ACCOUNTANT_PAGES = ["/dashboard", "/invoices", "/expenses", "/vendors"] as const;

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
