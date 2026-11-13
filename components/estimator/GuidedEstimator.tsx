"use client";

/**
 * The guided estimator, as the customer uses it.
 *
 * One decision per screen. A card tap answers and moves on, so a standard
 * project is a handful of taps and a four-field contact form. Nothing here
 * knows a price: the selections are posted to the server, which prices them
 * and returns the customer's view (see app/lib/estimator/submit.ts).
 *
 * The same component serves every brand. A brand is the `brand` prop and the
 * two accent colors it sets as CSS variables.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BrandConfig } from "@/app/lib/estimator/brands";
import { FLOWS, TRADES } from "@/app/lib/estimator/flows";
import {
  TIER_LABELS,
  isVisible,
  resolveAnswers,
  type Answers,
  type CustomerEstimate,
  type ProjectFlow,
  type PropertyFacts,
  type Question,
  type Tier,
} from "@/app/lib/estimator/types";
import EstimateView from "./EstimateView";
import styles from "./GuidedEstimator.module.css";

type Step =
  | { kind: "trade" }
  | { kind: "project" }
  | { kind: "address" }
  | { kind: "question"; question: Question }
  | { kind: "finish" }
  | { kind: "contact" };

type Suggestion = { placeId: string; street: string; rest: string };

const TIERS: Tier[] = ["builder", "mid", "high", "luxury"];

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Attribution the page was opened with. Click ids and campaign tags only, never a person. */
function readAttribution(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "landing_page", "referrer"]) {
      const value = params.get(key);
      if (value) out[key] = value.slice(0, 300);
    }
    if (!out.landing_page) out.landing_page = window.location.pathname;
    if (!out.referrer && document.referrer) out.referrer = document.referrer.slice(0, 300);
  } catch {
    // Attribution is optional.
  }
  return out;
}

/** Start the clock at the customer's first tap, for the completion-time measure. */
function markStart(startedAt: { current: number | null }) {
  if (startedAt.current === null) startedAt.current = Date.now();
}

function Cards({
  options,
  selected,
  onPick,
  label,
  images,
}: {
  options: { id: string; label: string; hint?: string; image?: string }[];
  selected: string | undefined;
  onPick: (id: string) => void;
  label: string;
  images: Set<string>;
}) {
  return (
    <div
      className={styles.cards}
      role="radiogroup"
      aria-label={label}
      data-count={options.length}
      // Up to three options stack as full-width photo tiles, four make a 2 x 2 grid, and five
      // or more become compact rows with a thumbnail, so every screen fits without scrolling.
      data-layout={options.length <= 3 ? "stack" : options.length === 4 ? "grid" : "rows"}
      style={
        {
          "--ge-count": options.length,
          "--ge-rows": options.length === 4 ? 2 : options.length,
          "--ge-rows-wide": Math.ceil(options.length / 2),
        } as React.CSSProperties
      }
    >
      {options.map((option) => {
        const src = option.image && images.has(option.image) ? `/estimator/img/${option.image}.webp` : null;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            className={styles.card}
            data-selected={selected === option.id || undefined}
            data-photo={src ? "yes" : undefined}
            onClick={() => onPick(option.id)}
          >
            {/* Small, fixed-size option photos served as static WebP: the image optimizer adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src ? <img className={styles.cardImage} src={src} alt="" loading="lazy" decoding="async" width={480} height={360} /> : null}
            <span className={styles.cardText}>
              <span className={styles.cardLabel}>{option.label}</span>
              {option.hint ? <span className={styles.cardHint}>{option.hint}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function GuidedEstimator({
  brand,
  images,
  initialProject,
  embedded = false,
}: {
  brand: Pick<BrandConfig, "id" | "name" | "accent" | "accentInk" | "phoneDisplay" | "phoneTel" | "heading" | "intro" | "projects">;
  /** Image names that exist under /estimator/img. A card without one is a text card. */
  images: string[];
  initialProject?: string | null;
  embedded?: boolean;
}) {
  const flows = useMemo(() => brand.projects.map((id) => FLOWS.find((f) => f.id === id)).filter((f): f is ProjectFlow => Boolean(f)), [brand.projects]);
  const preset = flows.find((f) => f.id === initialProject) ?? (flows.length === 1 ? flows[0] : null);
  const trades = useMemo(() => TRADES.filter((t) => flows.some((f) => f.group === t.id)), [flows]);
  const [trade, setTrade] = useState<string | null>(preset ? preset.group : trades.length === 1 ? trades[0].id : null);
  const [flow, setFlow] = useState<ProjectFlow | null>(preset);
  const [taskGroup, setTaskGroup] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [tier, setTier] = useState<Tier>("mid");
  const [address, setAddress] = useState("");
  const [property, setProperty] = useState<PropertyFacts | null>(null);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [estimate, setEstimate] = useState<CustomerEstimate | null>(null);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "", marketingConsent: false, company_website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");
  const startedAt = useRef<number | null>(null);
  const session = useRef("");
  const clientKey = useRef("");
  const attribution = useRef<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const imageSet = useMemo(() => new Set(images), [images]);
  const shell = useRef<HTMLDivElement>(null);

  // A question screen is exactly as tall as the viewport below wherever the
  // estimator starts (under the site header, or at the top of an embed), so
  // nothing for the step is below the fold.
  useEffect(() => {
    const fit = () => {
      const node = shell.current;
      if (!node) return;
      const top = Math.max(0, node.getBoundingClientRect().top + window.scrollY);
      node.style.setProperty("--ge-height", `${Math.max(480, window.innerHeight - top)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [estimate]);

  const report = useCallback(
    (name: string, extra: { step?: string; project?: string | null } = {}) => {
      const project = extra.project ?? flow?.id ?? null;
      const payload = { session: session.current, brand: brand.id, project, name, step: extra.step ?? null, attribution: attribution.current };
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        if (!navigator.sendBeacon?.("/api/estimator/event", blob)) void fetch("/api/estimator/event", { method: "POST", body: JSON.stringify(payload), keepalive: true });
      } catch {
        // Analytics never interrupts the customer.
      }
      // Advertising and analytics tags get the event name and project only.
      const event = { type: "p5-estimator", name: `estimator_${name}`, brand: brand.id, project };
      try {
        (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.("event", event.name, { estimator_brand: brand.id, estimator_project: project ?? "" });
        if (embedded && window.parent !== window) window.parent.postMessage(event, "*");
      } catch {
        // Same.
      }
    },
    [brand.id, embedded, flow],
  );

  useEffect(() => {
    session.current = randomKey();
    clientKey.current = randomKey();
    attribution.current = readAttribution();
    report("started");
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = useMemo(() => (flow ? resolveAnswers(flow, answers) : {}), [flow, answers]);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [];
    if (!preset) {
      if (trades.length > 1) list.push({ kind: "trade" });
      // A trade with one project goes straight to that project's questions.
      if (trade && flows.filter((f) => f.group === trade).length > 1) list.push({ kind: "project" });
    }
    if (!flow) return list;
    list.push({ kind: "address" });
    for (const question of flow.questions) if (isVisible(question, resolved)) list.push({ kind: "question", question });
    if (flow.usesFinish) list.push({ kind: "finish" });
    list.push({ kind: "contact" });
    return list;
  }, [flow, flows, preset, resolved, trade, trades.length]);

  const step = steps[Math.min(index, steps.length - 1)];
  const stepName = step.kind === "question" ? step.question.id : step.kind;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (embedded) {
      try {
        window.parent.postMessage({ type: "p5-estimator-step" }, "*");
      } catch {
        // Not framed.
      }
    }
    if (flow) report("step_viewed", { step: stepName });
    // Report each screen once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, flow?.id, Boolean(estimate)]);

  const touch = () => markStart(startedAt);
  const go = (next: number) => {
    setDirection(next > index ? "forward" : "back");
    setIndex(Math.max(0, next));
  };
  const forward = () => go(index + 1);
  const back = () => {
    if (index === 0) return;
    const previous = steps[index - 1].kind;
    if (previous === "project" || previous === "trade") {
      setFlow(null);
      setAnswers({});
    }
    if (previous === "trade") setTrade(null);
    go(index - 1);
  };

  const chooseProject = (picked: ProjectFlow) => {
    touch();
    setFlow(picked);
    setAnswers({});
    setTaskGroup(null);
    report("project_selected", { project: picked.id });
    forward();
  };

  const chooseTrade = (id: string) => {
    touch();
    setTrade(id);
    const inTrade = flows.filter((f) => f.group === id);
    if (inTrade.length === 1) return chooseProject(inTrade[0]);
    setFlow(null);
    forward();
  };

  const answer = (id: string, value: Answers[string], advance: boolean) => {
    touch();
    setAnswers((current) => ({ ...current, [id]: value }));
    if (advance) forward();
  };

  // ------------------------------------------------------------- address
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const picked = useRef("");
  useEffect(() => {
    const query = address.trim();
    if (step.kind !== "address" || query.length < 4 || query === picked.current) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/estimator/address?q=${encodeURIComponent(query)}&session=${session.current}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((json: { suggestions?: Suggestion[] }) => setSuggestions((json.suggestions ?? []).slice(0, 5)))
        .catch(() => undefined);
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, step.kind]);

  const pickSuggestion = async (s: Suggestion) => {
    touch();
    setSuggestions([]);
    setLookingUp(true);
    let full = `${s.street}, ${s.rest}`;
    try {
      const json = (await (await fetch(`/api/estimator/address?placeId=${encodeURIComponent(s.placeId)}&session=${session.current}`)).json()) as { address?: string | null };
      if (json.address) full = json.address;
    } catch {
      // The suggestion text is a usable address on its own.
    }
    picked.current = full;
    setAddress(full);
    report("address_selected");
    try {
      const json = (await (await fetch(`/api/estimator/property?address=${encodeURIComponent(full)}`)).json()) as { property?: PropertyFacts | null };
      setProperty(json.property ?? null);
      if (!json.property) forward();
    } catch {
      setProperty(null);
      forward();
    } finally {
      setLookingUp(false);
    }
  };

  const confirmProperty = (correct: boolean) => {
    if (!property) return forward();
    if (correct) {
      setProperty({ ...property, confirmed: true });
      report("property_confirmed");
      // A confirmed living area answers the question that asks for it.
      const target = flow?.questions.find((q) => q.kind === "number" && q.prefill === "homeSqft");
      if (target && target.kind === "number" && property.livingSqft) {
        const fitted = Math.min(target.max, Math.max(target.min, Math.round(property.livingSqft / target.step) * target.step));
        setAnswers((current) => ({ ...current, [target.id]: fitted }));
      }
    } else {
      // The customer said the record is wrong, so none of it is used.
      setProperty(null);
    }
    forward();
  };

  // ------------------------------------------------------------- submit
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!flow || sending) return;
    const found: Record<string, string> = {};
    if (!contact.firstName.trim()) found.firstName = "Enter your first name.";
    if (!contact.lastName.trim()) found.lastName = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email.trim())) found.email = "Enter a valid email address.";
    if (contact.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) found.phone = "Enter a 10-digit phone number.";
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`ge-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSending(true);
    setFailure("");
    report("contact_submitted");
    try {
      const response = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brand: brand.id,
          project: flow.id,
          tier,
          answers: resolved,
          address: address.trim() || null,
          property,
          contact: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone, marketingConsent: contact.marketingConsent },
          company_website: contact.company_website,
          clientKey: clientKey.current,
          attribution: attribution.current,
          elapsedMs: startedAt.current ? Date.now() - startedAt.current : null,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; estimate?: CustomerEstimate; error?: string; errors?: { field: string; message: string }[] };
      if (json.ok && json.estimate) {
        setEstimate(json.estimate);
        report("completed");
        window.scrollTo?.({ top: 0 });
      } else if (json.errors?.length) {
        setErrors(Object.fromEntries(json.errors.map((e) => [e.field, e.message])));
      } else {
        setFailure(json.error ?? `We could not prepare your estimate just now. Please call ${brand.phoneDisplay}.`);
      }
    } catch {
      setFailure(`We could not reach the server. Check your connection and try again, or call ${brand.phoneDisplay}.`);
    } finally {
      setSending(false);
    }
  };

  const style = { "--ge-accent": brand.accent, "--ge-accent-ink": brand.accentInk } as React.CSSProperties;

  if (estimate) {
    return (
      <div className={styles.shell} style={style} data-embedded={embedded || undefined}>
        <EstimateView estimate={estimate} phoneDisplay={brand.phoneDisplay} phoneTel={brand.phoneTel} fresh />
      </div>
    );
  }

  const progress = steps.length > 1 ? Math.round((index / (steps.length - 1)) * 100) : 0;
  let title = "";
  let help: string | undefined;
  let body: React.ReactNode = null;
  let primary: React.ReactNode = null;

  if (step.kind === "trade") {
    title = "What kind of project?";
    body = <Cards options={trades} selected={trade ?? undefined} onPick={chooseTrade} label="Kind of project" images={imageSet} />;
  } else if (step.kind === "project") {
    title = "Which project?";
    body = (
      <Cards
        options={flows.filter((f) => f.group === trade).map((f) => ({ id: f.id, label: f.title, hint: f.blurb, image: f.image }))}
        selected={flow?.id}
        onPick={(id) => chooseProject(flows.find((f) => f.id === id)!)}
        label="Project"
        images={imageSet}
      />
    );
  } else if (step.kind === "address") {
    const facts = property
      ? [
          property.livingSqft ? `about ${property.livingSqft.toLocaleString("en-US")} sq ft` : null,
          property.yearBuilt ? `built in ${property.yearBuilt}` : null,
          property.stories ? `${property.stories} ${property.stories === 1 ? "story" : "stories"}` : null,
        ].filter(Boolean)
      : [];
    if (property && facts.length) {
      title = "We found your home";
      help = `Public records show ${facts.join(", ")}. Is that right?`;
      body = (
        <div className={styles.confirm}>
          <p className={styles.address}>{address}</p>
          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={() => confirmProperty(true)}>
              Yes, that is right
            </button>
            <button type="button" className={styles.secondary} onClick={() => confirmProperty(false)}>
              No, that is off
            </button>
          </div>
          <p className={styles.fine}>From {property.source}. We confirm everything in person before any work.</p>
        </div>
      );
    } else {
      title = "Where is the project?";
      help = "Start typing your address.";
      body = (
        <div className={styles.field}>
          <label htmlFor="ge-address" className={styles.label}>
            Property address
          </label>
          <input
            id="ge-address"
            className={styles.input}
            value={address}
            onChange={(e) => {
              touch();
              setAddress(e.target.value);
            }}
            autoComplete="street-address"
            inputMode="text"
            enterKeyHint="next"
            placeholder="123 Main St, Boise"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                forward();
              }
            }}
          />
          {suggestions.length ? (
            <ul className={styles.suggestions} aria-label="Address suggestions">
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button type="button" className={styles.suggestion} onClick={() => void pickSuggestion(s)}>
                    <strong>{s.street}</strong> <span>{s.rest}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {lookingUp ? (
            <p className={styles.fine} role="status">
              Looking up your home...
            </p>
          ) : null}
        </div>
      );
      primary = (
        <button type="button" className={styles.primary} onClick={forward}>
          {address.trim() ? "Continue" : "Skip for now"}
        </button>
      );
    }
  } else if (step.kind === "question") {
    const q = step.question;
    title = q.prompt;
    help = q.help;
    if (q.kind === "choice") {
      body = <Cards options={q.options} selected={answers[q.id] as string | undefined} onPick={(id) => answer(q.id, id, true)} label={q.prompt} images={imageSet} />;
    } else if (q.kind === "number") {
      const value = Number(resolved[q.id] ?? q.default);
      const set = (n: number) => answer(q.id, Math.min(q.max, Math.max(q.min, n)), false);
      body = (
        <div className={styles.number}>
          {q.presets ? (
            <div className={styles.chips} role="group" aria-label="Common sizes">
              {q.presets.map((p) => (
                <button key={p} type="button" className={styles.chip} data-selected={value === p || undefined} aria-pressed={value === p} onClick={() => set(p)}>
                  {p.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.stepper}>
            <button type="button" className={styles.stepButton} aria-label={`Less ${q.unit}`} onClick={() => set(value - q.step)} disabled={value <= q.min}>
              &minus;
            </button>
            <label className={styles.stepValue}>
              <span className={styles.srOnly}>
                {q.prompt} ({q.unit})
              </span>
              <input
                className={styles.stepInput}
                type="number"
                inputMode="numeric"
                min={q.min}
                max={q.max}
                step={q.step}
                value={value}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) answer(q.id, n, false);
                }}
              />
              <span className={styles.stepUnit}>{q.unit}</span>
            </label>
            <button type="button" className={styles.stepButton} aria-label={`More ${q.unit}`} onClick={() => set(value + q.step)} disabled={value >= q.max}>
              +
            </button>
          </div>
        </div>
      );
      primary = (
        <button type="button" className={styles.primary} onClick={forward}>
          Continue
        </button>
      );
    } else {
      const counts = (answers[q.id] ?? {}) as Record<string, number>;
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      const setCount = (id: string, n: number, max: number) => {
        const next = { ...counts, [id]: Math.min(max, Math.max(0, n)) };
        if (!next[id]) delete next[id];
        answer(q.id, next, false);
      };
      const groups = [...new Set(q.options.map((o) => o.group))];
      const open = taskGroup && groups.includes(taskGroup) ? taskGroup : groups[0];
      const inGroup = (group: string) => q.options.filter((o) => o.group === group).reduce((sum, o) => sum + (counts[o.id] ?? 0), 0);
      // One group of jobs on screen at a time, so the list never needs scrolling.
      body = (
        <div className={styles.tasks}>
          <div className={styles.tabs} role="tablist" aria-label="Kinds of job">
            {groups.map((group) => (
              <button key={group} type="button" role="tab" aria-selected={group === open} className={styles.tab} data-selected={group === open || undefined} onClick={() => setTaskGroup(group)}>
                {group}
                {inGroup(group) ? <span className={styles.badge}>{inGroup(group)}</span> : null}
              </button>
            ))}
          </div>
          <ul className={styles.taskList} role="tabpanel" aria-label={open}>
            {q.options
              .filter((o) => o.group === open)
              .map((o) => {
                const n = counts[o.id] ?? 0;
                return (
                  <li key={o.id} className={styles.task} data-selected={n > 0 || undefined}>
                    <button type="button" className={styles.taskMain} aria-pressed={n > 0} onClick={() => setCount(o.id, n > 0 ? 0 : 1, o.max)}>
                      <span className={styles.cardLabel}>{o.label}</span>
                      {o.hint ? <span className={styles.cardHint}>{o.hint}</span> : null}
                    </button>
                    {n > 0 && o.max > 1 ? (
                      <span className={styles.taskCount}>
                        <button type="button" className={styles.countButton} aria-label={`One fewer: ${o.label}`} onClick={() => setCount(o.id, n - 1, o.max)}>
                          &minus;
                        </button>
                        <span aria-live="polite">{n}</span>
                        <button type="button" className={styles.countButton} aria-label={`One more: ${o.label}`} onClick={() => setCount(o.id, n + 1, o.max)} disabled={n >= o.max}>
                          +
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </div>
      );
      primary = (
        <button type="button" className={styles.primary} onClick={forward} disabled={total === 0}>
          {total === 0 ? "Choose at least one" : `Continue with ${total} ${total === 1 ? "item" : "items"}`}
        </button>
      );
    }
  } else if (step.kind === "finish") {
    title = "What level of finish?";
    help = "This sets the quality of the materials and fixtures in your estimate.";
    body = (
      <Cards
        options={TIERS.map((t) => ({ id: t, label: TIER_LABELS[t].label, hint: TIER_LABELS[t].hint, image: `finish-${t}` }))}
        selected={tier}
        onPick={(id) => {
          touch();
          setTier(id as Tier);
          forward();
        }}
        label="Finish level"
        images={imageSet}
      />
    );
  } else {
    title = "Your estimate is ready";
    help = "Tell us where to send your official copy and you will see it right away.";
    const field = (id: "firstName" | "lastName" | "email" | "phone", label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <div className={styles.field}>
        <label htmlFor={`ge-${id}`} className={styles.label}>
          {label}
        </label>
        <input
          id={`ge-${id}`}
          className={styles.input}
          value={contact[id]}
          onChange={(e) => setContact((c) => ({ ...c, [id]: e.target.value }))}
          aria-invalid={Boolean(errors[id]) || undefined}
          aria-describedby={errors[id] ? `ge-${id}-error` : undefined}
          required
          {...props}
        />
        {errors[id] ? (
          <p id={`ge-${id}-error`} className={styles.error}>
            {errors[id]}
          </p>
        ) : null}
      </div>
    );
    body = (
      <form id="ge-contact" className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.two}>
          {field("firstName", "First name", { autoComplete: "given-name", autoCapitalize: "words", enterKeyHint: "next" })}
          {field("lastName", "Last name", { autoComplete: "family-name", autoCapitalize: "words", enterKeyHint: "next" })}
        </div>
        {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email", autoCapitalize: "none", enterKeyHint: "next" })}
        {field("phone", "Mobile phone", { type: "tel", autoComplete: "tel", inputMode: "tel", enterKeyHint: "done" })}
        <div className={styles.hp} aria-hidden="true">
          <label>
            Company website
            <input tabIndex={-1} autoComplete="off" value={contact.company_website} onChange={(e) => setContact((c) => ({ ...c, company_website: e.target.value }))} />
          </label>
        </div>
        <label className={styles.consent}>
          <input type="checkbox" checked={contact.marketingConsent} onChange={(e) => setContact((c) => ({ ...c, marketingConsent: e.target.checked }))} />
          <span>Optional: send me occasional tips and offers from {brand.name}. You can unsubscribe any time.</span>
        </label>
        {failure ? (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        ) : null}
        <p className={styles.fine}>
          We use your details to prepare and send your estimate and to follow up about this project. See our{" "}
          <a href="https://p5homeco.com/legal/privacy" target="_blank" rel="noopener">
            privacy policy
          </a>
          .
        </p>
      </form>
    );
    primary = (
      <button type="submit" form="ge-contact" className={styles.primary} disabled={sending}>
        {sending ? "Preparing your estimate..." : "Show my estimate"}
      </button>
    );
  }

  return (
    <div ref={shell} className={styles.shell} style={style} data-embedded={embedded || undefined} data-fit="true">
      <div className={styles.top}>
        <button type="button" className={styles.back} onClick={back} disabled={index === 0} aria-label="Back to the previous question">
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <div className={styles.progress} role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.count} aria-hidden="true">
          {flow ? `${index + 1} of ${steps.length}` : ""}
        </span>
      </div>
      <div key={`${flow?.id ?? "start"}-${stepName}-${property ? "p" : ""}`} className={styles.screen} data-direction={direction}>
        <h2 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        {help ? <p className={styles.help}>{help}</p> : null}
        {body}
      </div>
      {primary ? <div className={styles.dock}>{primary}</div> : null}
    </div>
  );
}
