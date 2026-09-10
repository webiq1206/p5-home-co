"use client";

import { useEffect, useState } from "react";
import TrackedPhoneLink from "./TrackedPhoneLink";

export default function QuoteCallBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const panel = document.querySelector(".quote-form-panel");
    if (!panel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "0px 0px 80px 0px" },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  if (!visible) return null;
  return (
    <TrackedPhoneLink
      className="quote-callbar"
      location="quote_mobile_bar"
      ariaLabel="Call P5 Home Co on 2 0 8, 4 7 7, 1 1 6 9"
    >
      <span>Call (208) 477-1169</span>
      <small>Free quote · no obligation</small>
    </TrackedPhoneLink>
  );
}
