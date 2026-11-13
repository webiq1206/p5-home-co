"use client";

/**
 * Archive and delete as two small icons: in the corner of a project card on
 * the list, and at the bottom right of an open project. Delete asks first,
 * because it also removes the estimate from QuickBooks.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { api } from "./client";

type Props = {
  id: number;
  name: string;
  archived: boolean;
  /** Employees only; scopes-only accounts can archive but not delete. */
  canDelete: boolean;
  /** "card" sits in a list card's corner; "page" sits at the end of an open project. */
  placement: "card" | "page";
};

const ArchiveIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </svg>
);
const RestoreIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

export default function ProjectActions({ id, name, archived, canDelete, placement }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const archive = async () => {
    setBusy("archive");
    setError(null);
    try {
      await api(`/api/scopes/${id}`, { method: "PATCH", json: { archived: !archived } });
      if (placement === "page") router.push(archived ? "/scopes" : "/scopes?archived=1");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await api(`/api/scopes/${id}`, { method: "DELETE", json: { confirm: "DELETE" } });
      dialog.current?.close();
      if (placement === "page") router.push("/scopes");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`sc-acts sc-acts-${placement}`}>
      <button type="button" className="sc-act" disabled={!!busy} onClick={archive} aria-label={`${archived ? "Restore" : "Archive"} ${name}`} title={archived ? "Restore to active projects" : "Archive"}>
        {archived ? <RestoreIcon /> : <ArchiveIcon />}
      </button>
      {canDelete && (
        <button type="button" className="sc-act sc-act-danger" disabled={!!busy} onClick={() => { setError(null); setAsking(true); dialog.current?.showModal(); }} aria-label={`Delete ${name}`} title="Delete">
          <TrashIcon />
        </button>
      )}
      {error && !asking && <p className="sc-act-error" role="alert">{error}</p>}
      {canDelete && (
        <dialog ref={dialog} className="sc-dialog" onClose={() => setAsking(false)} aria-labelledby={`sc-del-${id}`}>
          <h2 id={`sc-del-${id}`} className="sc-h2">Delete this project?</h2>
          <p><b>{name}</b></p>
          <p className="sc-small">
            This also removes its estimate, attached files and project from QuickBooks. The customer is never touched. An invoiced job cannot be deleted. This cannot be undone.
          </p>
          {error && <p className="sc-act-error" role="alert">{error}</p>}
          <div className="sc-dialog-row">
            <button type="button" className="sc-btn" disabled={busy === "delete"} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="button" className="sc-btn sc-btn-danger" disabled={busy === "delete"} onClick={remove}>{busy === "delete" ? "Deleting..." : "Delete"}</button>
          </div>
        </dialog>
      )}
    </div>
  );
}
