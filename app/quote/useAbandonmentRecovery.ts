"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ExitMethod = "navigation" | "exit_intent" | "inactivity" | "exit_control";

export interface AbandonmentTriggerOptions {
  /** The visitor has made meaningful progress and has not submitted. */
  armed: boolean;
  /** Seconds of no interaction before the prompt offers help. */
  inactivitySeconds?: number;
  /** Desktop exit intent (pointer leaves through the top edge). */
  exitIntent?: boolean;
  /** Ignore clicks inside these selectors (the wizard's own controls). */
  ignoreWithin?: string[];
}

const SESSION_FLAG = "p5_recovery_prompted";

function alreadyPrompted(): boolean {
  try { return window.sessionStorage.getItem(SESSION_FLAG) === "1"; } catch { return false; }
}
function rememberPrompted(): void {
  try { window.sessionStorage.setItem(SESSION_FLAG, "1"); } catch { /* ignore */ }
}

/**
 * Detects the moments a visitor is about to leave an incomplete estimator:
 * an in-site link click, desktop exit intent, or extended inactivity. It never
 * fires more than once per browser session and never on tab close (browsers do
 * not allow a custom prompt there; the server-side sweep covers that case).
 */
export function useAbandonmentRecovery({ armed, inactivitySeconds = 90, exitIntent = true, ignoreWithin = [] }: AbandonmentTriggerOptions) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ExitMethod | null>(null);
  const pendingHref = useRef<string | null>(null);
  const firedRef = useRef(false);
  const armedRef = useRef(armed);
  useEffect(() => { armedRef.current = armed; }, [armed]);

  const fire = useCallback((why: ExitMethod, href?: string) => {
    if (firedRef.current || !armedRef.current || alreadyPrompted()) return false;
    firedRef.current = true;
    rememberPrompted();
    pendingHref.current = href ?? null;
    setMethod(why);
    setOpen(true);
    return true;
  }, []);

  // 1. In-site navigation: a click on a same-origin link outside the wizard.
  useEffect(() => {
    if (!armed) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (ignoreWithin.some((sel) => anchor.closest(sel))) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || /^(tel|sms|mailto|javascript):/i.test(href)) return;
      if (anchor.target && anchor.target !== "_self") return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      if (fire("navigation", url.href)) event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [armed, fire, ignoreWithin]);

  // 2. Desktop exit intent: pointer leaves through the top of the viewport.
  useEffect(() => {
    if (!armed || !exitIntent) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    let seen = 0;
    const onLeave = (event: MouseEvent) => {
      if (event.clientY > 8) return;
      // Ignore the very first seconds so a stray move does not fire it.
      if (Date.now() - seen < 1500) return;
      fire("exit_intent");
    };
    seen = Date.now();
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => document.documentElement.removeEventListener("mouseleave", onLeave);
  }, [armed, exitIntent, fire]);

  // 3. Inactivity: no pointer, key, scroll or touch for a while.
  useEffect(() => {
    if (!armed || !inactivitySeconds) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState === "visible") fire("inactivity"); }, inactivitySeconds * 1000);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [armed, inactivitySeconds, fire]);

  /** Manual trigger for an in-page exit control (close, leave, back-to-site). */
  const triggerFromControl = useCallback((href?: string) => fire("exit_control", href), [fire]);

  /** Close the prompt and, if a navigation was intercepted, continue it. */
  const proceed = useCallback(() => {
    setOpen(false);
    const href = pendingHref.current;
    pendingHref.current = null;
    if (href) window.location.assign(href);
  }, []);

  /** Close the prompt and stay in the flow. */
  const stay = useCallback(() => {
    setOpen(false);
    pendingHref.current = null;
  }, []);

  return { open, method, proceed, stay, triggerFromControl };
}
