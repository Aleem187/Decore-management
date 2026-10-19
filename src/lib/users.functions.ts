import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Thin wrappers: the server-only module is imported inside each handler so it never reaches the browser bundle.
// Every implementation starts with assertAdmin(), so a non-admin is rejected here regardless of the UI.

const roleSchema = z.enum(["admin", "accountant"]);

export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listUsers } = await import("@/lib/users.server");
    return listUsers(context);
  });

export const inviteUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().trim().email().max(254), fullName: z.string().trim().min(1).max(120), role: roleSchema }))
  .handler(async ({ context, data }) => {
    const { inviteUser } = await import("@/lib/users.server");
    return inviteUser(context, data);
  });

export const setUserDisabledFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid(), disabled: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { setUserDisabled } = await import("@/lib/users.server");
    return setUserDisabled(context, data);
  });

export const setUserRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid(), role: roleSchema }))
  .handler(async ({ context, data }) => {
    const { setUserRole } = await import("@/lib/users.server");
    return setUserRole(context, data);
  });
