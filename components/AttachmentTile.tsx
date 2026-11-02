"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";

/**
 * "Add photos, plans or files (optional)": one friendly tile instead of the
 * browser's raw "Choose files" control. The family uses the same look and
 * behaviour on every site.
 *
 * Tapping the tile opens the native picker (camera, photo library and files on
 * a phone); on a desktop files can also be dropped on it. Chosen files show as
 * chips with a preview or a PDF mark, the size, and a 44px remove button. A
 * file that is too large or of the wrong type is named in a plain message and
 * left out; it never blocks the rest of the form.
 *
 * The tile only collects files. The form decides when to send them (after the
 * lead is saved), so an upload can never delay or endanger the request.
 */

export const ATTACHMENT_ACCEPT = "image/*,application/pdf,.heic,.heif";
export const ATTACHMENT_MAX_FILES = 10;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export type PickedFile = { key: string; file: File };

let nextKey = 0;

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    name.endsWith(".pdf") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Browsers cannot draw HEIC, so those get the photo mark instead of a preview. */
function canPreview(file: File): boolean {
  return /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(file.type);
}

/** Add `incoming` to `current`, returning the new list and a message for anything left out. */
export function addFiles(current: readonly PickedFile[], incoming: readonly File[]): { files: PickedFile[]; message: string | null } {
  const files = [...current];
  const tooLarge: string[] = [];
  const wrongType: string[] = [];
  let overCount = false;
  for (const file of incoming) {
    if (file.size === 0) continue;
    if (!isAccepted(file)) {
      wrongType.push(file.name);
      continue;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      tooLarge.push(file.name);
      continue;
    }
    if (files.some((entry) => entry.file.name === file.name && entry.file.size === file.size)) continue;
    if (files.length >= ATTACHMENT_MAX_FILES) {
      overCount = true;
      continue;
    }
    nextKey += 1;
    files.push({ key: `f${nextKey}`, file });
  }
  const notes = [
    tooLarge.length ? `${tooLarge.join(", ")} ${tooLarge.length === 1 ? "is" : "are"} over 20 MB, so ${tooLarge.length === 1 ? "it was" : "they were"} not added.` : "",
    wrongType.length ? `${wrongType.join(", ")} ${wrongType.length === 1 ? "is not a photo or PDF" : "are not photos or PDFs"}, so ${wrongType.length === 1 ? "it was" : "they were"} not added.` : "",
    overCount ? `Up to ${ATTACHMENT_MAX_FILES} files can be added here. Text any others to us.` : "",
  ].filter(Boolean);
  return { files, message: notes.length ? notes.join(" ") : null };
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileMark({ pdf }: { pdf: boolean }) {
  return (
    <span className="attach-chip-mark" aria-hidden="true">
      <svg focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {pdf ? (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </>
        ) : (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m21 16-5-5-8 8" />
          </>
        )}
      </svg>
      {pdf ? <b>PDF</b> : null}
    </span>
  );
}

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!canPreview(file)) return;
    const objectUrl = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the object URL exists only after mount and is revoked on cleanup
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
  return url ? <img className="attach-chip-thumb" src={url} alt="" width={44} height={44} /> : <FileMark pdf={isPdf(file)} />;
}

export function AttachmentTile({
  files,
  onChange,
  label = "Add photos, plans or files",
  disabled = false,
  status,
  name,
}: {
  /** Set only where a form without JavaScript should post the files itself. */
  name?: string;
  files: readonly PickedFile[];
  onChange: (files: PickedFile[]) => void;
  label?: string;
  disabled?: boolean;
  /** Optional per-file note, for example "Sending" or "Did not upload". */
  status?: (key: string) => string | null;
}) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function take(incoming: readonly File[]) {
    const result = addFiles(files, incoming);
    setMessage(result.message);
    onChange(result.files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    take([...(event.dataTransfer?.files ?? [])]);
  }

  return (
    <div className="attach" data-dragging={dragging ? "" : undefined}>
      <input
        ref={inputRef}
        id={`${uid}-input`}
        className="attach-input"
        name={name}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        disabled={disabled}
        aria-describedby={`${uid}-hint${message ? ` ${uid}-message` : ""}`}
        onChange={(event) => {
          take([...(event.target.files ?? [])]);
          // The same file can be chosen again after it is removed.
          event.target.value = "";
        }}
      />
      <label
        htmlFor={`${uid}-input`}
        className="attach-tile"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <PaperclipIcon />
        <span className="attach-tile-text">
          <span className="attach-tile-label">
            {label} <span className="quote-form-optional">(optional)</span>
          </span>
          <small id={`${uid}-hint`}>Photos, PDFs or drawings. Up to 10 files, 20 MB each.</small>
        </span>
      </label>
      <p id={`${uid}-message`} className="attach-message" aria-live="polite">
        {message ?? ""}
      </p>
      {files.length > 0 && (
        <ul className="attach-chips" aria-label="Files to send">
          {files.map(({ key, file }) => {
            const note = status?.(key) ?? null;
            return (
              <li key={key} className="attach-chip" data-state={note ? "note" : undefined}>
                <Preview file={file} />
                <span className="attach-chip-text">
                  <span className="attach-chip-name">{file.name}</span>
                  <small>{note ?? formatBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  className="attach-chip-remove"
                  aria-label={`Remove ${file.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setMessage(null);
                    onChange(files.filter((entry) => entry.key !== key));
                    inputRef.current?.focus();
                  }}
                >
                  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
