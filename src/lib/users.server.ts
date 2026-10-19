import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertAdmin, type AuthedContext } from "@/lib/admin-guard.server";
import type { Role } from "@/lib/auth";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role | null;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

/** Number of other admins who are active (not disabled) besides `exceptId`. */
async function otherActiveAdmins(exceptId: string) {
  const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").neq("user_id", exceptId);
  const ids = (roles ?? []).map((r) => r.user_id);
  if (ids.length === 0) return 0;
  const { count } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).in("id", ids).is("disabled_at", null);
  return count ?? 0;
}

export async function listUsers(ctx: AuthedContext): Promise<UserRow[]> {
  await assertAdmin(ctx);
  const [profiles, roles, authUsers] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, email, created_at, disabled_at").order("created_at"),
    supabaseAdmin.from("user_roles").select("user_id, role"),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  const lastSignIn = new Map((authUsers.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const roleOf = new Map((roles.data ?? []).map((r) => [r.user_id, r.role as Role]));
  return (profiles.data ?? []).map((p) => ({
    id: p.id,
    email: p.email ?? "",
    name: p.full_name,
    role: roleOf.get(p.id) ?? null,
    disabled: !!p.disabled_at,
    createdAt: p.created_at,
    lastSignInAt: lastSignIn.get(p.id) ?? null,
  }));
}

export async function inviteUser(ctx: AuthedContext, input: { email: string; fullName: string; role: Role }) {
  await assertAdmin(ctx);
  const origin = new URL(getRequest().url).origin;
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.fullName },
    redirectTo: `${origin}/set-password`,
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not send the invitation");
  const { error: roleError } = await supabaseAdmin.from("user_roles").upsert({ user_id: data.user.id, role: input.role }, { onConflict: "user_id" });
  if (roleError) throw new Error(roleError.message);
  return { id: data.user.id };
}

export async function setUserDisabled(ctx: AuthedContext, input: { userId: string; disabled: boolean }) {
  const me = await assertAdmin(ctx);
  if (input.userId === me) throw new Error("You cannot disable your own account");
  if (input.disabled) {
    const { data: target } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", input.userId).maybeSingle();
    if (target?.role === "admin" && (await otherActiveAdmins(input.userId)) === 0) {
      throw new Error("You cannot disable the last active admin");
    }
  }
  // Ban first so the user cannot refresh their session, then flag the profile so RLS stops honouring their role at once.
  const ban = await supabaseAdmin.auth.admin.updateUserById(input.userId, { ban_duration: input.disabled ? "876000h" : "none" });
  if (ban.error) throw new Error(ban.error.message);
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ disabled_at: input.disabled ? new Date().toISOString() : null })
    .eq("id", input.userId);
  if (error) throw new Error(error.message);
}

export async function setUserRole(ctx: AuthedContext, input: { userId: string; role: Role }) {
  const me = await assertAdmin(ctx);
  if (input.userId === me) throw new Error("You cannot change your own role");
  if (input.role !== "admin") {
    const { data: target } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", input.userId).maybeSingle();
    if (target?.role === "admin" && (await otherActiveAdmins(input.userId)) === 0) {
      throw new Error("You cannot demote the last active admin");
    }
  }
  const { error } = await supabaseAdmin.from("user_roles").upsert({ user_id: input.userId, role: input.role }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
