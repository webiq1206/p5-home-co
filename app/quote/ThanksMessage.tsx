"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

function acceptedSnapshot(): boolean {
  try {
    return sessionStorage.getItem("p5.quote-accepted") === "1";
  } catch {
    return false;
  }
}

export default function ThanksMessage() {
  const accepted = useSyncExternalStore(subscribe, acceptedSnapshot, () => false);

  if (!accepted) {
    return (
      <>
        <p className="quote-eyebrow">Request a quote</p>
        <h1>Ready to tell us about your project?</h1>
        <p className="quote-lead">
          Use our <Link href="/quote">quote request form</Link>, or call (208) 477-1169 to speak with the team.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="quote-eyebrow">Request received</p>
      <h1>Thank you. Your request is with the right team.</h1>
      <p className="quote-lead">
        We have your project details. Your request has been routed to the P5 company whose craft
        matches the work, and a specialist will follow up during business hours.
      </p>
      <h2>What happens next</h2>
      <ol className="quote-thanks-steps">
        <li>A specialist from the right company reviews what you sent.</li>
        <li>They call or email you to fill in the gaps and, where it helps, arrange a site visit.</li>
        <li>You receive a written scope setting out what is included, what is not, and the cost.</li>
      </ol>
      <p className="quote-thanks-urgent">
        Need it sooner, or remembered something important? <a href="tel:+12084771169">Call (208) 477-1169</a>{" "}
        or email <a href="mailto:hello@p5homeco.com">hello@p5homeco.com</a> and reference your name.
      </p>
    </>
  );
}