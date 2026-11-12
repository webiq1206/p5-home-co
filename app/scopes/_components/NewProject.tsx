"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { projectTitle } from "../../lib/scopes/naming.ts";
import AddressField from "./AddressField.tsx";
import { api, SERVICES } from "./client.ts";

/** Start a project with as little as an address; everything else can come from the recording. */
export default function NewProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [service, setService] = useState("remodel");

  // The name is always built the same way, so it is shown, not typed.
  const name = projectTitle({ lastName, address, service });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/scopes", { method: "POST", json: { address, firstName, lastName, service } });
      router.push(`/scopes/${id}?tab=record`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="sc-btn sc-btn-primary sc-new-btn" onClick={() => setOpen(true)}>
        New project
      </button>
    );
  }
  return (
    <form
      className="sc-card sc-new"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="sc-h2">New project</h2>
      <p className="sc-muted">Only what you know now. The recording fills in the rest.</p>
      <AddressField label="Project address" value={address} onChange={setAddress} autoFocus hint="Start typing and pick the address from the list." />
      <div className="sc-two">
        <label className="sc-field">
          <span>Client first name</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
        </label>
        <label className="sc-field">
          <span>Client last name</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <label className="sc-field">
        <span>Type of work</span>
        <select value={service} onChange={(e) => setService(e.target.value)}>
          {SERVICES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>
      <p className="sc-name-preview">
        Project name
        <b>{name}</b>
      </p>
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
