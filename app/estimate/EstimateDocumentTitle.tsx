"use client";

import { useEffect, useState } from "react";
import { ESTIMATOR_BRAND } from "@/lib/p5/brand";
import { INTAKE_COPY, publicProjectMode } from "@/lib/p5/intakePolicy";

/**
 * The estimator frame is a shared file and renders its own heading only after
 * the saved draft loads. This title is the same sentence, present in the first
 * HTML. It is removed once that frame paints its stage heading, so the page
 * keeps a single h1.
 */
export function EstimateDocumentTitle() {
  const [replaced, setReplaced] = useState(false);
  useEffect(() => {
    const root = document.querySelector("[data-p5-estimator]");
    if (!root) return;
    const sync = () => setReplaced(Boolean(root.querySelector("[data-stage-heading]")));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  if (replaced) return null;
  const heading = publicProjectMode(ESTIMATOR_BRAND.id, "") === "review"
    ? INTAKE_COPY.heading
    : "Let’s estimate your project";
  return <h1>{heading}</h1>;
}
