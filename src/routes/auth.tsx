import { BRAND_LOGO, BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Sarim Events Planner" },
      { name: "description", content: "Sign in to your Sarim Events Planner workspace." },
      { property: "og:title", content: "Sign in — Sarim Events Planner" },
      { property: "og:description", content: "Sign in to your Sarim Events Planner workspace." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      nav({ to: "/dashboard" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden bg-hero p-12 text-primary-foreground md:flex md:flex-col md:justify-end">
        <img src={BRAND_LOGO} alt={BRAND_NAME} className="mb-6 h-40 w-40 self-start rounded-full" />
        <h2 className="text-gradient-gold text-5xl font-semibold">{BRAND_NAME}</h2>
        <p className="mt-2 font-display text-xl italic text-gold">{BRAND_TAGLINE}</p>
        <p className="mt-3 max-w-sm opacity-80">Access is by invitation only. Ask the owner to invite you.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h1 className="text-4xl font-semibold">Welcome back</h1>
          <div className="space-y-1"><Label>Email</Label><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label>Password</Label><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button type="submit" className="w-full" disabled={busy}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}
