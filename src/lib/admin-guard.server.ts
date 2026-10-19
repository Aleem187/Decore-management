import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthedContext = { supabase: SupabaseClient<Database>; userId: string };

/**
 * Call at the top of every admin-only server function.
 * 1. Asks the Auth server to validate the bearer token (getUser).
 * 2. Asks the database, as that user, whether they currently hold the admin role
 *    (has_role also returns false for disabled accounts).
 */
export async function assertAdmin(ctx: AuthedContext): Promise<string> {
  const header = getRequest()?.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Unauthorized");

  const { data, error } = await ctx.supabase.auth.getUser(token);
  if (error || !data.user || data.user.id !== ctx.userId) throw new Error("Unauthorized");

  const { data: isAdmin, error: roleError } = await ctx.supabase.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  if (roleError || isAdmin !== true) throw new Error("Forbidden: admin access required");
  return data.user.id;
}
