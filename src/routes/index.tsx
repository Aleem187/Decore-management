import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sparkles, Hotel, Receipt, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Décor Studio — Hotel Decoration Event Manager" },
      { name: "description", content: "Run hotel decor events, invoices, expenses and vendor ledgers in one place." },
      { property: "og:title", content: "Décor Studio — Hotel Decoration Event Manager" },
      { property: "og:description", content: "Run hotel decor events, invoices, expenses and vendor ledgers in one place." },
    ],
  }),
  component: Index,
});

function Index() {
  const features = [
    { icon: Hotel, t: "Hotels & venues", d: "Halls, contacts and decor guidelines per hotel." },
    { icon: Sparkles, t: "Events", d: "Track every booking from upcoming to paid." },
    { icon: Receipt, t: "Books & invoices", d: "Invoices, expenses and vendor ledgers in PKR." },
    { icon: BarChart3, t: "Profit insight", d: "See revenue, costs and margin per hotel." },
  ];
  return (
    <div className="min-h-screen bg-hero text-primary-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl font-semibold">Décor Studio</span>
        <Button asChild variant="secondary"><Link to="/auth">Sign in</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-16">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Events · Finance · Team</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight md:text-7xl">
          The back office for your decoration business.
        </h1>
        <p className="mt-6 max-w-xl text-lg opacity-80">
          One calm workspace for the owner and the accountant — every hotel, every event, every rupee.
        </p>
        <Button asChild size="lg" variant="secondary" className="mt-10"><Link to="/auth">Open workspace</Link></Button>
        <div className="mt-20 grid gap-4 md:grid-cols-4">
          {features.map((f) => (
            <div key={f.t} className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-5">
              <f.icon className="h-5 w-5 text-gold" />
              <h3 className="mt-3 text-xl font-semibold">{f.t}</h3>
              <p className="mt-1 text-sm opacity-75">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
