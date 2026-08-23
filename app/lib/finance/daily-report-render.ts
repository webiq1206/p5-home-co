/**
 * Render the daily financial report as email (HTML + plain text).
 *
 * Pure, so the wording and layout are testable. Design targets, from the
 * brief: readable on a phone in 30-60 seconds, worst news first, labels not
 * colors (the health words survive dark mode, printing, and screen
 * readers), and links back to the panel and QuickBooks rather than detail
 * dumped inline.
 */

import type { Message } from "../notifications/render.ts";
import type { DailyReport, ProjectCard, ReportChange } from "./daily-report.ts";

const QBO_HOME = "https://qbo.intuit.com/app/homepage";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  );
}

function moneyCents(n: number): string {
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function reportSubject(report: DailyReport): string {
  const date = prettyDate(report.coversDate).replace(/^[A-Za-z]+, /, "");
  const worst =
    report.attention.critical > 0
      ? `${report.attention.critical} critical`
      : report.attention.urgent > 0
        ? `${report.attention.urgent} urgent`
        : null;
  if (!report.qboConnected) return `P5 Daily Snapshot ${date} - QuickBooks not connected`;
  if (worst) return `P5 Daily Snapshot ${date} - ${worst} item${worst.startsWith("1 ") ? "" : "s"} need attention`;
  return `P5 Daily Snapshot ${date} - no significant issues`;
}

const HEALTH_STYLE: Record<ProjectCard["health"], { bg: string; fg: string }> = {
  "ON TRACK": { bg: "#e7efe3", fg: "#233029" },
  WATCH: { bg: "#f9e9dc", fg: "#8a4a1e" },
  "ACTION REQUIRED": { bg: "#f6dede", fg: "#9a2f2f" },
};

export function renderDailyReport(
  report: DailyReport,
  changes: ReportChange[],
  baseUrl: string,
): Message {
  const subject = reportSubject(report);
  const c = report.company;

  // ------------------------------------------------------------- plain text
  const lines: string[] = [];
  lines.push("P5 DAILY FINANCIAL SNAPSHOT");
  lines.push(prettyDate(report.coversDate));
  lines.push("");

  lines.push("NEEDS YOUR ATTENTION");
  if (report.attention.items.length === 0) {
    lines.push("No significant financial issues requiring attention.");
  } else {
    for (const item of report.attention.items.slice(0, 8)) {
      lines.push(
        `[${item.severity.toUpperCase()}] ${item.title}${item.amount !== null ? ` (${moneyCents(item.amount)})` : ""}`,
      );
    }
    const more =
      report.attention.critical + report.attention.urgent + report.attention.warning -
      Math.min(report.attention.items.length, 8);
    if (more > 0) lines.push(`...and ${more} more in the panel.`);
  }
  lines.push("");

  lines.push("COMPANY SNAPSHOT");
  if (!c) {
    lines.push(
      report.qboConnected
        ? "QuickBooks has not completed a sync yet; no figures available."
        : "QuickBooks is not connected; no figures available.",
    );
  } else {
    lines.push(`Cash total ${money(c.cash.total)} (operating ${money(c.cash.operating)}, tax reserve ${money(c.cash.taxReserve)}, op reserve ${money(c.cash.operatingReserve)}, undeposited ${money(c.cash.undeposited)})`);
    lines.push(`Safe Cash ${money(c.safeCash)}${c.safeCashProvisional ? " (provisional)" : ""}`);
    lines.push(`Receivables ${money(c.ar.total)} open (${c.ar.count}), overdue ${money(c.ar.overdue)} (${c.ar.overdueCount})`);
    lines.push(`Payables ${money(c.ap.total)} open (${c.ap.count}), due in 7 days ${money(c.ap.dueSoon)} (${c.ap.dueSoonCount})`);
    lines.push(`Invoiced today ${money(c.activity.today.invoiced)} | MTD ${money(c.activity.mtd.invoiced)} | YTD ${money(c.activity.ytd.invoiced)}`);
    lines.push(`Collected today ${money(c.activity.today.collected)} | MTD ${money(c.activity.mtd.collected)} | YTD ${money(c.activity.ytd.collected)}`);
    lines.push(`Bills entered today ${money(c.activity.today.billsEntered)} | MTD ${money(c.activity.mtd.billsEntered)} | YTD ${money(c.activity.ytd.billsEntered)}`);
  }
  lines.push("");

  lines.push("WHAT CHANGED SINCE YESTERDAY");
  if (changes.length === 0) lines.push("No meaningful changes.");
  else
    for (const ch of changes.slice(0, 12)) {
      lines.push(`- ${ch.text}${ch.amount !== null ? ` (${moneyCents(ch.amount)})` : ""}`);
    }
  lines.push("");

  lines.push("ACTIVE PROJECTS");
  if (report.projects.length === 0) lines.push("No active projects.");
  for (const p of report.projects) {
    lines.push(`${p.p5Id} ${p.name} [${p.health}] - ${p.division}`);
    lines.push(
      `  Contract ${money(p.contractValue)} | Budget ${money(p.currentBudget)} | Spent ${money(p.actualCost)} | Committed ${money(p.committed)} | Remaining ${p.remainingBudget === null ? "no budget set" : money(p.remainingBudget)}`,
    );
    lines.push(
      `  Collected ${money(p.paymentsReceived)} | Customer balance ${money(p.customerBalance)} | Open invoices ${money(p.outstandingInvoices)} | Open bills ${money(p.outstandingBills)}`,
    );
    lines.push(
      `  Projected margin ${p.projectedMarginPct === null ? "n/a" : p.projectedMarginPct.toFixed(1) + "%"} vs goal ${p.targetMarginPct}% - ${p.healthReasons.join("; ")}`,
    );
    for (const problem of p.problems) lines.push(`  ! ${problem}`);
  }
  lines.push("");

  if (report.upcoming.length) {
    lines.push("UPCOMING (14 DAYS)");
    for (const u of report.upcoming.slice(0, 10)) {
      lines.push(
        `${u.dueDate ?? "no date"}: ${u.kind === "bill" ? "Pay" : "Expect"} ${moneyCents(u.amount)}${u.counterparty ? ` - ${u.counterparty}` : ""}`,
      );
    }
    lines.push("");
  }

  if (report.limitations.length) {
    lines.push("DATA NOTES");
    for (const l of report.limitations) lines.push(`- ${l}`);
    lines.push("");
  }

  lines.push(`View in panel: ${baseUrl}/admin/finance/daily-report`);
  lines.push(`Needs Your Attention: ${baseUrl}/admin/finance`);
  lines.push(`QuickBooks: ${QBO_HOME}`);
  if (report.lastSyncAt) lines.push(`Data last synced ${report.lastSyncAt}`);

  const text = lines.join("\n");

  // ------------------------------------------------------------------- html
  const S = {
    section:
      "margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6c756e",
    card: "margin:0 0 14px;padding:14px;background:#fbfaf6;border:1px solid rgba(32,35,31,.15)",
    num: "font-variant-numeric:tabular-nums",
    row: "display:block;margin:0 0 4px;font-size:14px;color:#20231f",
    label: "color:#6c756e;font-size:12px",
  };

  const chip = (health: ProjectCard["health"]) => {
    const s = HEALTH_STYLE[health];
    return `<span style="display:inline-block;padding:3px 8px;background:${s.bg};color:${s.fg};font-size:11px;font-weight:700;letter-spacing:.06em">${health}</span>`;
  };

  const attentionHtml =
    report.attention.items.length === 0
      ? `<div style="${S.card};border-left:3px solid #4c6b51"><b>All clear.</b> No significant financial issues requiring attention.</div>`
      : report.attention.items
          .slice(0, 8)
          .map((item) => {
            const color =
              item.severity === "critical"
                ? "#9a2f2f"
                : item.severity === "urgent"
                  ? "#b4622a"
                  : "#a3803c";
            return `<div style="${S.card};border-left:3px solid ${color}">
<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:${color}">${esc(item.severity.toUpperCase())}</div>
<div style="font-size:14px;font-weight:650;margin:3px 0">${esc(item.title)}${item.amount !== null ? ` <span style="${S.num}">(${esc(moneyCents(item.amount))})</span>` : ""}</div>
${item.recommendedAction ? `<div style="font-size:13px;color:#343934">${esc(item.recommendedAction)}</div>` : ""}
</div>`;
          })
          .join("");

  const stat = (label: string, value: string, sub?: string) =>
    `<td style="padding:8px 10px;border:1px solid rgba(32,35,31,.12);background:#fbfaf6;vertical-align:top">
<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6c756e">${esc(label)}</div>
<div style="font-size:19px;font-weight:650;${S.num}">${esc(value)}</div>
${sub ? `<div style="font-size:11px;color:#6c756e">${esc(sub)}</div>` : ""}</td>`;

  const companyHtml = !c
    ? `<div style="${S.card}"><b>${report.qboConnected ? "QuickBooks has not completed a sync yet." : "QuickBooks is not connected."}</b> No financial figures are available - this line will replace itself once data flows.</div>`
    : `<table role="presentation" width="100%" cellspacing="4" cellpadding="0" style="border-collapse:separate;margin:0 0 6px"><tr>
${stat("Cash", money(c.cash.total), `op ${money(c.cash.operating)} · reserves ${money(c.cash.taxReserve + c.cash.operatingReserve)}`)}
${stat("Safe Cash", money(c.safeCash), c.safeCashProvisional ? "provisional" : undefined)}
</tr><tr>
${stat("Receivables", money(c.ar.total), `overdue ${money(c.ar.overdue)} (${c.ar.overdueCount})`)}
${stat("Payables", money(c.ap.total), `due 7d ${money(c.ap.dueSoon)} (${c.ap.dueSoonCount})`)}
</tr><tr>
${stat("Invoiced", `${money(c.activity.mtd.invoiced)} MTD`, `today ${money(c.activity.today.invoiced)} · YTD ${money(c.activity.ytd.invoiced)}`)}
${stat("Collected", `${money(c.activity.mtd.collected)} MTD`, `today ${money(c.activity.today.collected)} · YTD ${money(c.activity.ytd.collected)}`)}
</tr></table>`;

  const changesHtml =
    changes.length === 0
      ? `<div style="${S.row}">No meaningful changes.</div>`
      : changes
          .slice(0, 12)
          .map(
            (ch) =>
              `<div style="${S.row}">• ${esc(ch.text)}${ch.amount !== null ? ` <b style="${S.num}">${esc(moneyCents(ch.amount))}</b>` : ""}</div>`,
          )
          .join("");

  const projectHtml = report.projects.length
    ? report.projects
        .map((p) => {
          const kv = (label: string, value: string) =>
            `<td style="padding:2px 10px 2px 0;font-size:12px;color:#6c756e;white-space:nowrap">${esc(label)}</td><td style="padding:2px 0;font-size:13px;font-weight:600;${S.num}">${esc(value)}</td>`;
          return `<div style="${S.card}">
<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between;align-items:baseline">
<div style="font-size:15px;font-weight:700">${esc(p.p5Id)} ${esc(p.name)}</div>${chip(p.health)}
</div>
<div style="font-size:12px;color:#6c756e;margin:2px 0 8px">${esc(p.division)}${p.customer ? ` · ${esc(p.customer)}` : ""} · ${esc(p.status)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%"><tr>
${kv("Contract", money(p.contractValue))}${kv("Budget", p.currentBudget > 0 ? money(p.currentBudget) : "not set")}
</tr><tr>
${kv("Spent", money(p.actualCost))}${kv("Committed", money(p.committed))}
</tr><tr>
${kv("Remaining", p.remainingBudget === null ? "n/a" : money(p.remainingBudget))}${kv("Budget used", p.budgetUsedPct === null ? "n/a" : p.budgetUsedPct.toFixed(0) + "%")}
</tr><tr>
${kv("Collected", money(p.paymentsReceived))}${kv("Cust. balance", money(p.customerBalance))}
</tr><tr>
${kv("Open invoices", money(p.outstandingInvoices))}${kv("Open bills", money(p.outstandingBills))}
</tr><tr>
${kv("Proj. margin", p.projectedMarginPct === null ? "n/a" : p.projectedMarginPct.toFixed(1) + "% (goal " + p.targetMarginPct + "%)")}${kv("Proj. profit", money(p.projectedGrossProfit))}
</tr></table>
<div style="margin:8px 0 0;font-size:12px;color:#343934">${esc(p.healthReasons.join("; "))}</div>
${p.problems.map((problem) => `<div style="margin:4px 0 0;padding:6px 8px;background:#fdf6ee;font-size:12px;color:#8a4a1e"><b>Data:</b> ${esc(problem)}</div>`).join("")}
</div>`;
        })
        .join("")
    : `<div style="${S.row}">No active projects.</div>`;

  const upcomingHtml = report.upcoming.length
    ? report.upcoming
        .slice(0, 10)
        .map(
          (u) =>
            `<div style="${S.row}"><b>${esc(u.dueDate ?? "no date")}</b> · ${u.kind === "bill" ? "Pay" : "Expect"} <b style="${S.num}">${esc(moneyCents(u.amount))}</b>${u.counterparty ? ` - ${esc(u.counterparty)}` : ""}</div>`,
        )
        .join("")
    : `<div style="${S.row}">Nothing due in the next 14 days.</div>`;

  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f1ede4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#20231f">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6c756e">P5 Home Co</p>
<h1 style="margin:0 0 2px;font-size:22px;font-weight:650">Daily Financial Snapshot</h1>
<p style="margin:0 0 18px;font-size:13px;color:#6c756e">${esc(prettyDate(report.coversDate))}</p>

<p style="${S.section}">Needs your attention</p>
${attentionHtml}

<p style="${S.section};margin-top:20px">Company snapshot</p>
${companyHtml}

<p style="${S.section};margin-top:20px">What changed since yesterday</p>
${changesHtml}

<p style="${S.section};margin-top:20px">Active projects</p>
${projectHtml}

<p style="${S.section};margin-top:20px">Upcoming (14 days)</p>
${upcomingHtml}

${report.limitations.length ? `<p style="${S.section};margin-top:20px">Data notes</p>${report.limitations.map((l) => `<div style="${S.row}">• ${esc(l)}</div>`).join("")}` : ""}

<div style="margin:22px 0 0">
<a href="${esc(baseUrl)}/admin/finance/daily-report" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:#233029;color:#fff;text-decoration:none;font-size:13px;font-weight:650">Open in panel</a>
<a href="${esc(baseUrl)}/admin/finance" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid #233029;color:#233029;text-decoration:none;font-size:13px;font-weight:650">Attention queue</a>
<a href="${QBO_HOME}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid #233029;color:#233029;text-decoration:none;font-size:13px;font-weight:650">QuickBooks</a>
</div>
<p style="margin:14px 0 0;font-size:11px;color:#6c756e">${report.lastSyncAt ? `Data last synced ${esc(new Date(report.lastSyncAt).toLocaleString("en-US"))}. ` : ""}Every figure comes from synced QuickBooks data and the P5 project registry; anything that could not be computed is listed under Data notes rather than guessed.</p>
</div></body></html>`;

  return { subject, text, html };
}
