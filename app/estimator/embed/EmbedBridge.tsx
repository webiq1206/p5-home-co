"use client";

import { useEffect } from "react";

/**
 * Tells the framing page how tall the estimator's content is, so the frame is
 * exactly that tall and the page scrolls as one. It measures the content, not
 * the window: the window is the frame, which is only ever as tall as the last
 * number sent, so measuring it could grow but never shrink.
 *
 * "p5-estimator-ready" asks the framing page how much room it has
 * (GuidedEstimator listens for the answer). Nothing else is sent.
 */
export default function EmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    document.documentElement.dataset.estimatorEmbed = "true";
    const content = document.getElementById("main-content") ?? document.body;
    let last = 0;
    const post = () => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: "p5-estimator-height", height }, "*");
    };
    const observer = new ResizeObserver(post);
    observer.observe(content);
    window.parent.postMessage({ type: "p5-estimator-ready" }, "*");
    post();
    return () => observer.disconnect();
  }, []);
  return null;
}
