"use client";

import type { ReactNode } from "react";

import { track } from "../analytics";

export default function TrackedPhoneLink({
  children,
  className,
  location,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  location: string;
  ariaLabel?: string;
}) {
  return (
    <a
      className={className}
      href="tel:+12084771169"
      aria-label={ariaLabel}
      onClick={() => track("phone_click", { location })}
    >
      {children}
    </a>
  );
}
