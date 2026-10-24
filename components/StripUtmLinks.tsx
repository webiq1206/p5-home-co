"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { internalHref, selfCanonical } from "@/lib/canonicalUrl";

/**
 * Campaign parameters stay on the address bar so analytics can read the
 * landing URL. They are removed from same-origin links and from the
 * self-canonical so those URLs are not crawled as extra copies of a page.
 */
export default function StripUtmLinks() {
  const pathname = usePathname();
  useEffect(() => {
    const current = window.location.href;
    const onHome = window.location.pathname === "/";
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      const raw = anchor.getAttribute("href");
      if (!raw) return;
      // Hash jumps inside the estimator and quote flow are left unchanged so a
      // campaign query is not dropped by a reload. Homepage section links are
      // root-absolute and do not inherit utm_ from /?utm_...
      const hashOnly = raw.startsWith("#");
      if (!/[?&]utm_/i.test(raw) && !(onHome && hashOnly)) return;
      const next = internalHref(raw, current);
      if (next !== raw) anchor.setAttribute("href", next);
    });
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const href = canonical?.getAttribute("href");
    if (canonical && href) {
      const cleaned = selfCanonical(href);
      if (cleaned !== href) canonical.setAttribute("href", cleaned);
    }
  }, [pathname]);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (window.location.pathname !== "/" || !/[?&]utm_/i.test(window.location.search)) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/#"]') : null;
      if (!anchor) return;
      const id = (anchor.getAttribute("href") || "").slice(2);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      const url = new URL(window.location.href);
      for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
      url.hash = id;
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
      target.scrollIntoView();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);
  return null;
}
