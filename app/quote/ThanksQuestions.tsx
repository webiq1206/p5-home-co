"use client";

import { useEffect, useRef, useState } from "react";

import { track } from "../analytics";

/**
 * Two optional questions after a sent request.
 *
 * The quote form has no field for optional answers and the lead is already
 * saved by the time this renders, so each answer goes to GA4 through the
 * existing track() wrapper as one `quote_feedback` event. Fixed choices only:
 * free text could carry personal details into analytics.
 */
const QUESTIONS = [
  {
    id: "heard_from",
    prompt: "How did you hear about us?",
    options: [
      ["search", "A search engine"],
      ["ai_assistant", "An AI assistant"],
      ["company_site", "One of our company websites"],
      ["referral", "A friend, neighbor or agent"],
      ["social", "Social media"],
      ["other", "Somewhere else"],
    ],
  },
  {
    id: "almost_stopped",
    prompt: "What almost stopped you from reaching out?",
    options: [
      ["which_company", "Not sure which company fits"],
      ["price", "Worried about the price"],
      ["timing", "Not sure about timing"],
      ["talk_first", "Wanted to talk to someone first"],
      ["form", "The form"],
      ["nothing", "Nothing, it was easy"],
    ],
  },
] as const;

const DONE_KEY = "p5.quote-feedback-done";

export default function ThanksQuestions() {
  const [index, setIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [answeredBefore, setAnsweredBefore] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // A refresh after answering should not ask again in the same session.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from sessionStorage after hydration
      if (sessionStorage.getItem(DONE_KEY) === "1") setAnsweredBefore(true);
    } catch {
      /* private mode */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [index]);

  if (!hydrated || answeredBefore) return null;

  const done = index >= QUESTIONS.length;
  const question = done ? null : QUESTIONS[index];

  function advance(answer?: string) {
    if (question && answer) track("quote_feedback", { question: question.id, answer });
    moved.current = true;
    const next = index + 1;
    if (next >= QUESTIONS.length) {
      try {
        sessionStorage.setItem(DONE_KEY, "1");
      } catch {
        /* private mode */
      }
    }
    setIndex(next);
  }

  return (
    <section className="quote-thanks-questions" aria-labelledby="thanks-questions-heading">
      {question ? (
        <fieldset>
          <legend>
            <span className="quote-thanks-optional">
              Optional · Question {index + 1} of {QUESTIONS.length}
            </span>
            <h2 id="thanks-questions-heading" ref={headingRef} tabIndex={-1}>
              {question.prompt}
            </h2>
          </legend>
          <div className="quote-thanks-choices">
            {question.options.map(([value, label]) => (
              <button key={value} type="button" className="choice-card" onClick={() => advance(value)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="quote-thanks-skip" onClick={() => advance()}>
            Skip this question
          </button>
        </fieldset>
      ) : (
        <h2 id="thanks-questions-heading" ref={headingRef} tabIndex={-1} className="quote-thanks-done" role="status">
          Thank you. That helps us improve.
        </h2>
      )}
    </section>
  );
}
