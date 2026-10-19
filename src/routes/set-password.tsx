import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/set-password")({
  head: () => ({ meta: [{ title: "Set your password — Décor Studio" }] }),
  component: SetPassword,
});

// Landing page of the invitation e-mail. supabase-js turns the link's token into a
// session; the invited person then chooses a password.
function SetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady("yes");
    });
    supabase.auth.getUser().then(({ data }) => setReady(data.user ? "yes" : "no"));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password saved");
    nav({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-4xl font-semibold">Set your password</h1>
        {ready === "no" && <p className="text-sm text-destructive">This invitation link is invalid or has expired. Ask the owner to send a new one.</p>}
        {ready === "checking" && <p className="text-sm text-muted-foreground">Checking your invitation…</p>}
        {ready === "yes" && (
          <>
            <div className="space-y-1">
              <Label>New password</Label>
              <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Confirm password</Label>
              <Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>Save password</Button>
          </>
        )}
      </form>
    </div>
  );
}
