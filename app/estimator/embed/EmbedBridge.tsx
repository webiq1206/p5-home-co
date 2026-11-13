"use client";

import { useEffect } from "react";

/**
 * Tells the framing page how tall the estimator is, so the frame can grow
 * with it and the page scrolls as one. Sends a number and nothing else.
 */
export default function EmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    document.documentElement.dataset.estimatorEmbed = "true";
    const post = () => window.parent.postMessage({ type: "p5-estimator-height", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(document.body);
    post();
    return () => observer.disconnect();
  }, []);
  return null;
}
