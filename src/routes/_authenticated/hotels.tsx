import { requireRole, useMe } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { CrudPage } from "@/components/CrudPage";

export const Route = createFileRoute("/_authenticated/hotels")({
  head: () => ({ meta: [{ title: "Hotels — Décor Studio" }, { name: "description", content: "Hotel and venue directory." }, { property: "og:title", content: "Hotels — Décor Studio" }, { property: "og:description", content: "Hotel and venue directory." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: () => {
    const { data: me } = useMe();
    return (
      <CrudPage table="hotels" title="Hotels" subtitle="Venues, halls and decor guidelines" orderBy="created_at"
        select="*, events(count)" canWrite={me?.role === "admin"}
        columns={[
          { key: "name", label: "Hotel", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "hall_name", label: "Hall / Banquet" },
          { key: "contact_person", label: "Contact", render: (r) => <>{r.contact_person ?? "—"}<div className="text-xs text-muted-foreground">{r.contact_phone}</div></> },
          { key: "events", label: "Events", render: (r) => r.events?.[0]?.count ?? 0 },
          { key: "guidelines", label: "Guidelines", className: "max-w-xs truncate" },
        ]}
        fields={[
          { key: "name", label: "Hotel name", required: true },
          { key: "address", label: "Address" },
          { key: "hall_name", label: "Hall / Banquet name" },
          { key: "contact_person", label: "Contact person" },
          { key: "contact_phone", label: "Contact phone" },
          { key: "guidelines", label: "Decor constraints / guidelines", type: "textarea" },
        ]}
      />
    );
  },
});
