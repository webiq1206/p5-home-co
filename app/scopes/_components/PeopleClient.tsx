"use client";

import { useState } from "react";

import type { ScopePerson } from "../../lib/scopes/people.ts";
import { api } from "./client.ts";

export default function PeopleClient({ initial }: { initial: ScopePerson[] }) {
  const [people, setPeople] = useState(initial);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ people: ScopePerson[] }>("/api/scopes/people", { method: "POST", json: body });
      setPeople(res.people);
      setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        className="sc-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send({ action: "add", email, name }, `${name} can now sign in at p5homeco.com/scopes with ${email}.`)) {
            setEmail("");
            setName("");
          }
        }}
      >
        <h2 className="sc-h2">Give someone access</h2>
        <p className="sc-muted">Use the Google account email they will sign in with (a Gmail address works).</p>
        <div className="sc-two">
          <label className="sc-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
          </label>
          <label className="sc-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </label>
        </div>
        <button type="submit" className="sc-btn sc-btn-primary" disabled={busy}>
          {busy ? "Saving..." : "Add access"}
        </button>
      </form>

      {notice && <p className="sc-alert sc-alert-good" role="status">{notice}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}

      <section className="sc-card">
        <h2 className="sc-h2">Scopes-only access ({people.filter((p) => p.active).length} active)</h2>
        {people.length === 0 && <p className="sc-muted">Nobody yet.</p>}
        <ul className="sc-candidates">
          {people.map((p) => (
            <li key={p.id}>
              <span>
                <b>{p.fullName}</b> <span className="sc-muted sc-small">{p.email}</span>{" "}
                <span className={`sc-pill ${p.active ? "sc-pill-ready" : ""}`}>{p.active ? "Active" : "Access removed"}</span>
              </span>
              <button
                type="button"
                className="sc-btn sc-btn-small"
                disabled={busy}
                onClick={() => void send({ action: "set-active", id: p.id, active: !p.active }, p.active ? `${p.fullName} can no longer sign in.` : `${p.fullName} can sign in again.`)}
              >
                {p.active ? "Remove access" : "Restore access"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
