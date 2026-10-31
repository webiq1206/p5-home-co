"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { track } from "../analytics";
import { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS } from "../publicIdentity";
import ThanksQuestions from "./ThanksQuestions";
import TrackedPhoneLink from "./TrackedPhoneLink";
import { QUOTE_ACCEPTED_KEY, QUOTE_RECEIPT_KEY, parseQuoteReceipt } from "./thanksState";

function subscribe(): () => void {
  return () => {};
}

function acceptedSnapshot(): boolean {
  try {
    return sessionStorage.getItem(QUOTE_ACCEPTED_KEY) === "1";
  } catch {
    return false;
  }
}

function receiptSnapshot(): string | null {
  try {
    return sessionStorage.getItem(QUOTE_RECEIPT_KEY);
  } catch {
    return null;
  }
}

export default function ThanksMessage() {
  const accepted = useSyncExternalStore(subscribe, acceptedSnapshot, () => false);
  const receipt = parseQuoteReceipt(useSyncExternalStore(subscribe, receiptSnapshot, () => null));

  if (!accepted) {
    return (
      <>
        <p className="quote-eyebrow">Request a quote</p>
        <h1>Ready to tell us about your project?</h1>
        <p className="quote-lead">
          Use our <Link href="/quote">quote request form</Link>, or{" "}
          <TrackedPhoneLink location="quote_thanks_direct">call (208) 477-1169</TrackedPhoneLink> to speak with the team.
        </p>
      </>
    );
  }

  const team = receipt?.team ?? "the right P5 company";

  return (
    <>
      <p className="quote-eyebrow">Request received</p>
      <h1>Thank you. Your request is in.</h1>

      <div className="quote-thanks-grid">
        <section className="quote-thanks-panel" aria-labelledby="thanks-received">
          <h2 id="thanks-received">What we received</h2>
          {receipt ? (
            <dl className="quote-thanks-receipt">
              <div>
                <dt>Project</dt>
                <dd>{receipt.project}</dd>
              </div>
              <div>
                <dt>Team</dt>
                <dd>{receipt.team}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>
                  {receipt.files === 0
                    ? "None attached"
                    : receipt.filesAttached
                      ? `${receipt.files} attached`
                      : "These did not attach. Call or text and we will take them another way."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="quote-lead">Your project details and how to reach you.</p>
          )}
        </section>

        <section className="quote-thanks-panel" aria-labelledby="thanks-next">
          <h2 id="thanks-next">Who replies and when</h2>
          <p className="quote-lead">
            A specialist from {team} replies within one business day with questions or a time to visit. You get a
            written scope before any price.
          </p>
          <p className="quote-thanks-urgent">
            Need it sooner, or remembered something?{" "}
            <TrackedPhoneLink location="quote_thanks_accepted">Call {PUBLIC_PHONE_DISPLAY}</TrackedPhoneLink> or{" "}
            <a href={PUBLIC_PHONE_SMS} onClick={() => track("text_click", { location: "quote_thanks" })}>
              text {PUBLIC_PHONE_DISPLAY}
            </a>
            .
          </p>
        </section>
      </div>

      <ThanksQuestions />
    </>
  );
}
