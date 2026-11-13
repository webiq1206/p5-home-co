"use client";

/**
 * The customer's estimate: the range first, then how it breaks down, then
 * what it means.
 *
 * Renders CustomerEstimate and nothing else. That type has no field for a
 * cost, a margin or a cost code, so none can appear here.
 */

import type { CustomerEstimate } from "@/app/lib/estimator/types";
import styles from "./GuidedEstimator.module.css";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const quantity = (n: number, unit: string) => (unit === "EA" || unit === "LS" ? (n === 1 ? "" : `${n} x`) : `${n.toLocaleString("en-US")} ${unit.toLowerCase()}`);

/** Estimates saved before ranges were introduced keep the figure they were given. */
type LegacyEstimate = { total?: number | null };

function List({ items }: { items: string[] }) {
  return (
    <ul className={styles.bullets}>
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

function Fold({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className={styles.fold} open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export default function EstimateView({
  estimate,
  phoneDisplay,
  phoneTel,
  fresh = false,
  onCall,
}: {
  estimate: CustomerEstimate;
  phoneDisplay: string;
  phoneTel: string;
  /** True right after submitting, false when opened from the saved link. */
  fresh?: boolean;
  /** Called when the customer taps the call button, so the request to talk is counted. */
  onCall?: () => void;
}) {
  const date = new Date(estimate.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Boise" });
  const guide = estimate.guide;

  if (!guide) {
    const legacy = (estimate as unknown as LegacyEstimate).total;
    return (
      <article className={styles.result} aria-labelledby="ge-result-title">
        <p className={styles.kicker}>{estimate.brandName}</p>
        <h2 id="ge-result-title" className={styles.title} tabIndex={-1}>
          {estimate.projectName}
        </h2>
        {estimate.address ? <p className={styles.address}>{estimate.address}</p> : null}
        <div className={styles.totalCard}>
          <p className={styles.totalLabel}>{estimate.classLabel}</p>
          {typeof legacy === "number" ? <p className={styles.total}>{money(legacy)}</p> : null}
          <p className={styles.fine}>This estimate was prepared with an earlier version of our estimator. Call {phoneDisplay} and we will prepare an updated one.</p>
        </div>
      </article>
    );
  }

  const held = estimate.range === null;
  return (
    <article className={styles.result} aria-labelledby="ge-result-title">
      <header>
        <p className={styles.kicker}>{estimate.brandName}</p>
        <h2 id="ge-result-title" className={styles.title} tabIndex={-1}>
          {estimate.projectName}
        </h2>
        {estimate.address ? <p className={styles.address}>{estimate.address}</p> : null}
        <dl className={styles.meta}>
          <div>
            <dt>Estimate</dt>
            <dd>{estimate.estimateNumber}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{date}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{held ? "In review" : "Preliminary"}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.totalCard}>
        {held ? (
          <>
            <p className={styles.totalLabel}>Your estimate is in review</p>
            <p className={styles.help}>The combination you chose is one our team prices by hand, so the range we give you is one we stand behind. We have your details and will be in touch shortly.</p>
          </>
        ) : (
          <>
            <p className={styles.totalLabel}>{estimate.classLabel}</p>
            <p className={styles.total}>
              {money(estimate.range!.low)} <span className={styles.to}>to</span> {money(estimate.range!.high)}
            </p>
            <p className={styles.fine}>{estimate.classStatement}</p>
          </>
        )}
      </div>

      <section className={styles.block} aria-label="Project overview">
        <h3 className={styles.blockTitle}>Project overview</h3>
        <ul className={styles.tags}>
          {estimate.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {!held && estimate.divisions.length ? (
        <section className={styles.block} aria-label="Construction division breakdown">
          <h3 className={styles.blockTitle}>Construction division breakdown</h3>
          {estimate.divisionNote ? <p className={styles.para}>{estimate.divisionNote}</p> : null}
          {estimate.divisions.map((division) => (
            <details key={division.code} className={styles.division}>
              <summary>
                <span>
                  <span className={styles.divisionCode}>Division {division.code}</span>
                  <span className={styles.divisionName}>{division.name}</span>
                </span>
                <span>
                  {money(division.low)} to {money(division.high)}
                </span>
              </summary>
              <ul className={styles.items}>
                {division.items.map((item, i) => (
                  <li key={`${item.text}-${i}`}>
                    <span>
                      {item.text}
                      {quantity(item.quantity, item.unit) ? <em className={styles.qty}> {quantity(item.quantity, item.unit)}</em> : null}
                      {item.allowance ? <em className={styles.allowance}> Allowance</em> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <div className={styles.grand}>
            <span>Preliminary range</span>
            <span>
              {money(estimate.range!.low)} to {money(estimate.range!.high)}
            </span>
          </div>
        </section>
      ) : null}

      <section className={styles.block} aria-label="Understanding your estimate">
        <h3 className={styles.blockTitle}>Understanding your estimate</h3>
        <Fold title="Overview of your estimate" open>
          {guide.overview.map((s) => (
            <p key={s} className={styles.para}>
              {s}
            </p>
          ))}
        </Fold>
        {guide.included.length ? (
          <Fold title="What is included in your estimate?">
            {guide.included.map((group) => (
              <div key={group.division}>
                <p className={styles.subhead}>{group.division}</p>
                <List items={group.items} />
              </div>
            ))}
          </Fold>
        ) : null}
        {guide.outcome.length ? (
          <Fold title="What you are getting for your money">
            <List items={guide.outcome} />
          </Fold>
        ) : null}
        {guide.assumptions.length ? (
          <Fold title="Assumptions used in your estimate">
            <List items={guide.assumptions} />
          </Fold>
        ) : null}
        {guide.excluded.length || guide.undetermined.length ? (
          <Fold title="What is not included in your estimate?">
            {guide.excluded.length ? (
              <>
                <p className={styles.subhead}>Excluded</p>
                <List items={guide.excluded} />
              </>
            ) : null}
            {guide.undetermined.length ? (
              <>
                <p className={styles.subhead}>Not yet determined</p>
                <p className={styles.para}>These may or may not be needed. They are not in the range, and we cannot say until we have looked.</p>
                <List items={guide.undetermined} />
              </>
            ) : null}
          </Fold>
        ) : null}
        {guide.verification.length ? (
          <Fold title="Items requiring verification">
            <List items={guide.verification} />
          </Fold>
        ) : null}
        {guide.costDrivers.length ? (
          <Fold title="What could affect your final cost?">
            <List items={guide.costDrivers} />
          </Fold>
        ) : null}
        <Fold title="Preliminary estimate disclaimer">
          {guide.disclaimer.map((s) => (
            <p key={s} className={styles.para}>
              {s}
            </p>
          ))}
        </Fold>
      </section>

      <section className={styles.block} aria-label="Next steps">
        <h3 className={styles.blockTitle}>Next steps</h3>
        <ol className={styles.steps}>
          {estimate.nextSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <a className={styles.primary} href={phoneTel} onClick={onCall}>
          Call {phoneDisplay}
        </a>
        {fresh ? <p className={styles.fine}>We also emailed you a link to this estimate.</p> : null}
      </section>
    </article>
  );
}
