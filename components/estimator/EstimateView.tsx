"use client";

/**
 * The customer's estimate. Total first, detail on demand.
 *
 * Renders CustomerEstimate and nothing else: that type has no field for a
 * cost, a margin or a cost code, so none can appear here.
 */

import type { CustomerEstimate } from "@/app/lib/estimator/types";
import styles from "./GuidedEstimator.module.css";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const quantity = (n: number, unit: string) => (unit === "EA" || unit === "LS" ? (n === 1 ? "" : `${n} x`) : `${n.toLocaleString("en-US")} ${unit.toLowerCase()}`);

export default function EstimateView({
  estimate,
  phoneDisplay,
  phoneTel,
  fresh = false,
}: {
  estimate: CustomerEstimate;
  phoneDisplay: string;
  phoneTel: string;
  /** True right after submitting, false when opened from the saved link. */
  fresh?: boolean;
}) {
  const held = estimate.total === null;
  return (
    <article className={styles.result} aria-labelledby="ge-result-title">
      <p className={styles.kicker}>{estimate.brandName}</p>
      <h2 id="ge-result-title" className={styles.title} tabIndex={-1}>
        {estimate.projectName}
      </h2>
      {estimate.address ? <p className={styles.address}>{estimate.address}</p> : null}

      <div className={styles.totalCard}>
        {held ? (
          <>
            <p className={styles.totalLabel}>Your estimate needs a quick review</p>
            <p className={styles.help}>The combination you chose is one our team prices by hand, so we can give you a number we stand behind. We have your details and will be in touch shortly.</p>
          </>
        ) : (
          <>
            <p className={styles.totalLabel}>{estimate.classLabel}</p>
            <p className={styles.total}>{wholeMoney(estimate.total!)}</p>
            <p className={styles.fine}>{estimate.classStatement}</p>
          </>
        )}
      </div>

      <section className={styles.block} aria-label="What you selected">
        <h3 className={styles.blockTitle}>What you selected</h3>
        <ul className={styles.tags}>
          {estimate.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {!held && estimate.phases.length ? (
        <section className={styles.block} aria-label="What is included">
          <h3 className={styles.blockTitle}>What is included</h3>
          {estimate.phases.map((phase) => (
            <div key={phase.name} className={styles.phase}>
              <div className={styles.phaseHead}>
                <span>{phase.name}</span>
                <span>{money(phase.subtotal)}</span>
              </div>
              {phase.divisions.map((division) => (
                <details key={division.name} className={styles.division}>
                  <summary>
                    <span>{division.name}</span>
                    <span>{money(division.subtotal)}</span>
                  </summary>
                  <ul className={styles.items}>
                    {division.items.map((item, i) => (
                      <li key={`${item.text}-${i}`}>
                        <span>
                          {item.text}
                          {quantity(item.quantity, item.unit) ? <em className={styles.qty}> {quantity(item.quantity, item.unit)}</em> : null}
                          {item.allowance ? <em className={styles.allowance}> Allowance</em> : null}
                        </span>
                        <span>{money(item.price)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ))}
          <div className={styles.grand}>
            <span>Total</span>
            <span>{money(estimate.total!)}</span>
          </div>
        </section>
      ) : null}

      <details className={styles.fold}>
        <summary>What this is based on</summary>
        <ul className={styles.bullets}>
          {estimate.assumptions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
      <details className={styles.fold}>
        <summary>What is not included</summary>
        <ul className={styles.bullets}>
          {estimate.exclusions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>

      <section className={styles.block} aria-label="What happens next">
        <h3 className={styles.blockTitle}>What happens next</h3>
        <ol className={styles.steps}>
          {estimate.nextSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <a className={styles.primary} href={phoneTel}>
          Call {phoneDisplay}
        </a>
        {fresh ? <p className={styles.fine}>We also emailed you a link to this estimate.</p> : null}
      </section>
    </article>
  );
}
