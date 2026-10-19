import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/auth";

export type TeamMember = { id: string; name: string; email: string; role: Role };

/** Active team members (a profile with a role that is not disabled). Admin-only: profiles are not readable by accountants. */
export function useTeamMembers(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["team-members"],
    staleTime: 60_000,
    queryFn: async (): Promise<TeamMember[]> => {
      const [profiles, roles] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, disabled_at").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      const roleOf = new Map(roles.data.map((r) => [r.user_id, r.role as Role]));
      return profiles.data
        .filter((p) => !p.disabled_at && roleOf.has(p.id))
        .map((p) => ({
          id: p.id,
          name: p.full_name.trim() || p.email?.split("@")[0] || "Unnamed",
          email: p.email ?? "",
          role: roleOf.get(p.id) as Role,
        }));
    },
  });
}
