import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/no-access")({
  head: () => ({ meta: [{ title: "No access — Sarim Events Planner" }] }),
  component: NoAccess,
});

function NoAccess() {
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-4xl font-semibold">No access</h1>
        <p className="text-muted-foreground">
          Your account is not set up for this workspace, or it has been disabled. Ask the owner to invite you or re-enable your account.
        </p>
        <Button
          onClick={async () => {
            await supabase.auth.signOut();
            nav({ to: "/auth", replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
