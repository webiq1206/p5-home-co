"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Listing = {
  active: { version: string; digest: string; generation: number; activatedAt: string; action: string; reason: string } | null;
  releases: { version: string; digest: string; stagedAt: string; sourceRevision: string; approved: boolean; lines: number }[];
  history: { generation: number; version: string; action: string; previousVersion: string | null; reason: string; verificationReference: string; activatedAt: string; by: string | null }[];
  pricing: { version: string; digest: string; source: string };
  liveWorkbook: boolean;
};
type Preview = {
  ok: boolean; revision: string; digest?: string; unchanged?: boolean; issues?: string[]; error?: string;
  diff?: { lines: number; rateChangeCount: number; rateChanges: { code: string; item: string; unit: string; before: number[]; after: number[]; premiumBefore: number; premiumAfter: number }[]; ruleChanges: { rule: string; before: string; after: string }[] };
};

const TIERS = ["Essential", "Signature", "Premium", "Luxury"];
const short = (digest: string) => digest.slice(0, 12);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const amount = (n: number, unit: string) => unit.startsWith("%") ? `${Math.round(n * 10000) / 100}%` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = { display: "block", width: "100%", maxWidth: 560, minHeight: 44, fontSize: 16, padding: 10, boxSizing: "border-box" as const, margin: "4px 0 12px" };

export default function PricingReleases() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/pricing-release", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Pricing releases could not be loaded.");
    setListing(body);
  }, []);
  useEffect(() => {
    let live = true;
    fetch("/api/admin/pricing-release", { cache: "no-store" })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (!live) return; if (ok) setListing(body); else setMessage(body.error || "Pricing releases could not be loaded."); })
      .catch(error => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, []);

  async function send(fields: Record<string, string>, withFile: boolean) {
    let init: RequestInit;
    if (withFile && file) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set("workbook", file);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) };
    }
    const response = await fetch("/api/admin/pricing-release", init);
    return { status: response.status, body: await response.json() };
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setMessage("");
    try { await work(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(""); }
  }

  const doPreview = () => run("preview", async () => {
    const { body } = await send({ action: "preview" }, true);
    if (body.error && !body.issues) throw new Error(body.error);
    setPreview(body);
  });

  const doStage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const version = String(new FormData(event.currentTarget).get("version") || "").trim();
    return run("stage", async () => {
      const { status, body } = await send({ action: "stage", version, expectedDigest: preview?.digest || "" }, true);
      if (status !== 200) { if (body.digest || body.issues) setPreview(body); throw new Error(body.error || "The version was not staged."); }
      setMessage(`Staged ${body.staged.version}. It is not live until it is published below.`);
      setPreview(null); await load();
    });
  };

  const doPromote = (action: "publish" | "rollback", version: string, digest: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const confirmText = action === "publish" ? `Publish ${version}? New estimates on all five sites will be priced from it.` : `Restore ${version}? New estimates on all five sites will be priced from it again.`;
    if (!window.confirm(confirmText)) return;
    return run(`${action}:${version}`, async () => {
      const { status, body } = await send({
        action, version, expectedDigest: digest, expectedGeneration: String(listing?.active?.generation ?? 0),
        reason: String(data.get("reason") || ""), verificationReference: String(data.get("verification") || ""),
      }, false);
      if (status !== 200) throw new Error(body.error || "The release pointer did not move.");
      setMessage(`${body.version} is now the active release (generation ${body.generation}).`);
      await load();
    });
  };

  if (!listing) return <p role="status">{message || "Loading pricing releases."}</p>;
  const activeVersion = listing.active?.version ?? null;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1080 }}>
      {message && <p role="status" className="lead-card lead-card-warn">{message}</p>}

      <section className="lead-card" aria-labelledby="pr-active">
        <h2 id="pr-active" className="lead-name">Release in force</h2>
        {listing.active ? (
          <p>
            <b>{listing.active.version}</b> (digest {short(listing.active.digest)}), {listing.active.action === "rollback" ? "restored" : "published"} {when(listing.active.activatedAt)}.
            {" "}{listing.active.reason}
          </p>
        ) : (
          <p>
            No release has been published yet. Every site prices from the cost book and bid rules compiled into the current build:
            {" "}<b>{listing.pricing.version}</b> (digest {short(listing.pricing.digest)}).
          </p>
        )}
        {listing.active && listing.pricing.digest !== listing.active.digest && (
          <p className="lead-why lead-why-critical">
            This server is still pricing from {listing.pricing.version} ({listing.pricing.source}). The published release could not be verified here. No price moved; check the server log.
          </p>
        )}
      </section>

      <section className="lead-card" aria-labelledby="pr-preview">
        <h2 id="pr-preview" className="lead-name">Preview the workbook</h2>
        <p>
          {listing.liveWorkbook
            ? "The live P5 Cost Book is connected. Preview reads it as it is now. You can also upload a downloaded copy."
            : "Download the P5 Cost Book as Microsoft Excel (.xlsx) and choose it here. A preview changes nothing."}
        </p>
        <label>Workbook file (.xlsx){listing.liveWorkbook ? ", optional" : ""}
          <input type="file" accept=".xlsx" style={field} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} />
        </label>
        <button type="button" onClick={doPreview} disabled={Boolean(busy) || (!listing.liveWorkbook && !file)}>
          {busy === "preview" ? "Reading the workbook" : "Preview changes"}
        </button>

        {preview && !preview.ok && (
          <div role="alert">
            <h3>This workbook cannot be published yet</h3>
            <p>The release in force stays live. Fix these in the workbook and preview again:</p>
            <ul>{(preview.issues ?? []).map(issue => <li key={issue}>{issue}</li>)}</ul>
          </div>
        )}
        {preview?.ok && preview.diff && (
          <div>
            <h3>{preview.unchanged ? "No changes" : `${preview.diff.rateChangeCount} rate change${preview.diff.rateChangeCount === 1 ? "" : "s"}, ${preview.diff.ruleChanges.length} rule change${preview.diff.ruleChanges.length === 1 ? "" : "s"}`}</h3>
            <p>{preview.diff.lines} catalog lines checked. Candidate digest {short(preview.digest || "")}.</p>
            {preview.diff.ruleChanges.length > 0 && (
              <table><thead><tr><th scope="col">Rule</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
                <tbody>{preview.diff.ruleChanges.map(change => <tr key={change.rule}><td>{change.rule}</td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table>
            )}
            {preview.diff.rateChanges.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table><thead><tr><th scope="col">Code</th><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">Tier</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
                  <tbody>{preview.diff.rateChanges.flatMap(change => [
                    ...TIERS.flatMap((tier, i) => change.before[i] === change.after[i] ? [] : [
                      <tr key={`${change.code}:${tier}`}><td>{change.code}</td><td>{change.item}</td><td>{change.unit}</td><td>{tier}</td><td>{amount(change.before[i], change.unit)}</td><td>{amount(change.after[i], change.unit)}</td></tr>]),
                    ...(change.premiumBefore === change.premiumAfter ? [] : [
                      <tr key={`${change.code}:premium`}><td>{change.code}</td><td>{change.item}</td><td>{change.unit}</td><td>Remodel adjustment</td><td>{Math.round(change.premiumBefore * 100)}%</td><td>{Math.round(change.premiumAfter * 100)}%</td></tr>]),
                  ])}</tbody></table>
                {preview.diff.rateChangeCount > preview.diff.rateChanges.length && <p>Showing the first {preview.diff.rateChanges.length} changed lines.</p>}
              </div>
            )}
            {!preview.unchanged && (
              <form onSubmit={doStage}>
                <label>Version name for this release
                  <input name="version" required pattern="[A-Z0-9][A-Z0-9._-]{2,79}" placeholder="P5-BID-2026-12-01" style={field} />
                </label>
                <button type="submit" disabled={Boolean(busy)}>{busy === "stage" ? "Staging" : "Stage this version"}</button>
                <p>Staging stores the candidate exactly as previewed. It does not change any price.</p>
              </form>
            )}
          </div>
        )}
      </section>

      <section className="lead-card" aria-labelledby="pr-versions">
        <h2 id="pr-versions" className="lead-name">Versions</h2>
        {listing.releases.length === 0 && <p>No version has been staged.</p>}
        {listing.releases.map(release => {
          const isActive = release.version === activeVersion;
          const action = release.approved ? "rollback" : "publish";
          return (
            <article key={release.version} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
              <h3>{release.version}{isActive ? " (in force)" : release.approved ? " (approved earlier)" : " (staged, not live)"}</h3>
              <p>Digest {short(release.digest)}. {release.lines} lines. Staged {when(release.stagedAt)}. Workbook {release.sourceRevision.slice(0, 19)}.</p>
              {!isActive && (
                <form onSubmit={doPromote(action, release.version, release.digest)}>
                  <label>Reason
                    <input name="reason" required minLength={8} maxLength={1000} style={field} placeholder={action === "publish" ? "What changed and who approved it" : "Why the earlier release is being restored"} />
                  </label>
                  <label>What you checked before {action === "publish" ? "publishing" : "restoring"}
                    <input name="verification" required minLength={3} maxLength={500} style={field} placeholder="For example: previewed 12 rate changes with Nick, test estimate reviewed" />
                  </label>
                  <button type="submit" disabled={Boolean(busy)}>
                    {busy === `${action}:${release.version}` ? "Working" : action === "publish" ? "Publish this version" : "Restore this version"}
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </section>

      <section className="lead-card" aria-labelledby="pr-history">
        <h2 id="pr-history" className="lead-name">Audit history</h2>
        {listing.history.length === 0 ? <p>Nothing has been published.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Version</th><th scope="col">Replaced</th><th scope="col">By</th><th scope="col">Reason</th><th scope="col">Checked</th></tr></thead>
              <tbody>{listing.history.map(row => (
                <tr key={row.generation}><td>{when(row.activatedAt)}</td><td>{row.action === "rollback" ? "Restored" : "Published"}</td><td>{row.version}</td><td>{row.previousVersion ?? "Compiled baseline"}</td><td>{row.by ?? ""}</td><td>{row.reason}</td><td>{row.verificationReference}</td></tr>
              ))}</tbody></table>
          </div>
        )}
      </section>
    </div>
  );
}
