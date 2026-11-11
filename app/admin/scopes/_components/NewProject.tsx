"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, SERVICES } from "./client.ts";

/** Start a project with as little as an address; everything else can come from the recording. */
export default function NewProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/admin/scopes", {
        method: "POST",
        json: Object.fromEntries(form.entries()),
      });
      router.push(`/admin/scopes/${id}?tab=record`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="sc-btn sc-btn-primary" onClick={() => setOpen(true)}>
        New project
      </button>
    );
  }
  return (
    <form className="sc-card sc-new" action={submit}>
      <h2 className="sc-h2">New project</h2>
      <p className="sc-muted">Only what you know now. The recording fills in the rest.</p>
      <label className="sc-field">
        <span>Project address</span>
        <input name="address" autoComplete="street-address" />
      </label>
      <div className="sc-two">
        <label className="sc-field">
          <span>Client first name</span>
          <input name="firstName" autoComplete="off" />
        </label>
        <label className="sc-field">
          <span>Client last name</span>
          <input name="lastName" autoComplete="off" />
        </label>
      </div>
      <label className="sc-field">
        <span>Project name (optional)</span>
        <input name="title" placeholder="e.g. Kitchen and pantry remodel" />
      </label>
      <label className="sc-field">
        <span>Type of work</span>
        <select name="service" defaultValue="remodel">
          {SERVICES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
      <div className="sc-actions">
        <button className="sc-btn sc-btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create and open"}
        </button>
        <button className="sc-btn" type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
