"use client";

/**
 * Address box with suggestions as you type. Picking one fills the full postal
 * address (street, city, state, ZIP). It never blocks typing: if suggestions
 * are slow, unavailable or not set up, it is an ordinary text box and whatever
 * was typed is kept.
 */

import { useEffect, useId, useRef, useState } from "react";

type Suggestion = { placeId: string; street: string; rest: string };

function newSession(): string {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

export default function AddressField({
  label,
  value,
  onChange,
  name,
  required,
  hint,
  autoFocus,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  required?: boolean;
  hint?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [wantOpen, setOpen] = useState(false);
  // The exact text the current list was fetched for. A list is only shown for
  // the text on screen, so stale suggestions can never appear or be picked.
  const [resultFor, setResultFor] = useState<string | null>(null);
  const open = wantOpen && items.length > 0 && resultFor === value;
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef(newSession());
  const picked = useRef<string | null>(null); // the value a pick produced; do not search it again
  const unavailable = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    const text = value.trim();
    // Nothing to look up. Any earlier list is hidden because it belongs to a different value.
    if (!focused.current || unavailable.current || text.length < 3 || value === picked.current) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/scopes/address?q=${encodeURIComponent(text)}&session=${session.current}`, { signal: controller.signal, cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; configured?: boolean; suggestions?: Suggestion[] };
        if (controller.signal.aborted) return;
        if (body.configured === false) {
          unavailable.current = true; // not set up: stay a plain text box, quietly
          return;
        }
        const list = res.ok && body.ok !== false ? (body.suggestions ?? []) : [];
        setItems(list);
        setResultFor(value);
        setActive(-1);
        setOpen(focused.current);
        setStatus(list.length ? `${list.length} address suggestion${list.length === 1 ? "" : "s"}.` : "");
      } catch {
        // Aborted or offline: typing continues unaffected.
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  async function choose(item: Suggestion) {
    setOpen(false);
    setResultFor(null);
    const fallback = [item.street, item.rest].filter(Boolean).join(", ");
    setBusy(true);
    let full = fallback;
    try {
      const res = await fetch(`/api/scopes/address?placeId=${encodeURIComponent(item.placeId)}&session=${session.current}`, { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; address?: string | null };
      if (res.ok && body.ok !== false && body.address) full = body.address;
    } catch {
      // Keep the suggestion text; it is still a valid address without the ZIP.
    }
    picked.current = full;
    session.current = newSession(); // a pick ends Google's billing session
    onChange(full);
    setBusy(false);
    setStatus("Address filled in. You can still edit it.");
  }

  return (
    <div className="sc-field sc-address">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        required={required}
        autoFocus={autoFocus}
        // Browser and password-manager autofill would cover the suggestions.
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-describedby={`${id}-status`}
        aria-busy={busy}
        onFocus={() => {
          focused.current = true;
          if (items.length) setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          // Delay so a tap on a suggestion lands before the list closes.
          setTimeout(() => !focused.current && setOpen(false), 150);
        }}
        onChange={(e) => {
          picked.current = null;
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (a + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            void choose(items[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Address suggestions" className="sc-address-list">
          {items.map((item, i) => (
            <li
              key={item.placeId}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={active === i}
              className={active === i ? "sc-address-active" : undefined}
              // pointerdown, not click: it fires before the input loses focus on phones.
              onPointerDown={(e) => {
                e.preventDefault();
                void choose(item);
              }}
            >
              <b>{item.street}</b>
              {item.rest && <span>{item.rest}</span>}
            </li>
          ))}
        </ul>
      )}
      {hint && <small className="sc-muted">{hint}</small>}
      <span id={`${id}-status`} role="status" aria-live="polite" className="sc-visually-hidden">
        {busy ? "Filling in the address." : status}
      </span>
    </div>
  );
}
