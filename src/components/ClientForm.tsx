import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { validateClient, type ClientFormValues } from "@/lib/clients";
import { formatPkPhone, normalizePkPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ClientRecord = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

const toForm = (c?: ClientRecord | null): ClientFormValues => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  whatsapp: c?.whatsapp ?? "",
  email: c?.email ?? "",
  address: c?.address ?? "",
  notes: c?.notes ?? "",
});

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Add or edit a client. Validation (and phone clean-up to 92xxxxxxxxxx) happens before anything is sent. */
export function ClientForm({
  client,
  onDone,
}: {
  client?: ClientRecord | null;
  onDone: (saved?: { id: string }) => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<ClientFormValues>(() => toForm(client));
  const [errors, setErrors] = useState<Partial<Record<keyof ClientFormValues, string>>>({});
  const set =
    (k: keyof ClientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues({ ...values, [k]: e.target.value });

  const save = useMutation({
    mutationFn: async () => {
      const result = validateClient(values);
      if ("errors" in result) {
        setErrors(result.errors);
        throw new Error("Please fix the highlighted fields");
      }
      setErrors({});
      if (client) {
        const { error } = await supabase.from("clients").update(result.data).eq("id", client.id);
        if (error) throw error;
        return { id: client.id };
      }
      const { data, error } = await supabase
        .from("clients")
        .insert(result.data)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(client ? "Client updated" : "Client added");
      onDone(saved);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const phoneHint = (raw: string, fallback: string) => {
    const n = normalizePkPhone(raw);
    return raw.trim() && n ? `Will be saved as ${formatPkPhone(n)}` : fallback;
  };

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Name *" error={errors.name}>
        <Input
          value={values.name}
          onChange={set("name")}
          maxLength={120}
          autoFocus
          aria-invalid={!!errors.name}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Phone"
          error={errors.phone}
          hint={phoneHint(values.phone, "e.g. 0300 1234567")}
        >
          <Input
            inputMode="tel"
            value={values.phone}
            onChange={set("phone")}
            aria-invalid={!!errors.phone}
          />
        </Field>
        <Field
          label="WhatsApp"
          error={errors.whatsapp}
          hint={phoneHint(values.whatsapp, "Leave blank to use the phone number")}
        >
          <Input
            inputMode="tel"
            value={values.whatsapp}
            onChange={set("whatsapp")}
            aria-invalid={!!errors.whatsapp}
          />
        </Field>
      </div>
      <Field label="Email" error={errors.email}>
        <Input
          type="email"
          value={values.email}
          onChange={set("email")}
          maxLength={254}
          aria-invalid={!!errors.email}
        />
      </Field>
      <Field label="Address" error={errors.address}>
        <Textarea rows={2} value={values.address} onChange={set("address")} maxLength={500} />
      </Field>
      <Field label="Notes" error={errors.notes}>
        <Textarea rows={3} value={values.notes} onChange={set("notes")} maxLength={2000} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {client ? "Save changes" : "Add client"}
        </Button>
      </div>
    </form>
  );
}
