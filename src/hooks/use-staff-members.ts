import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StaffMember = {
  id: string;
  name: string;
  job_title: string;
  phone: string | null;
  cnic: string | null;
  salary_type: string;
  rate: number;
  joining_date: string | null;
  active: boolean;
  notes: string | null;
};

/** All live staff members (deleted ones are hidden by the database). */
export function useStaffMembers() {
  return useQuery({
    queryKey: ["staff", "all"],
    staleTime: 30_000,
    queryFn: async (): Promise<StaffMember[]> => {
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, job_title, phone, cnic, salary_type, rate, joining_date, active, notes")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}
