import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourceUrl = new URL("../app/quote/AbandonmentPrompt.tsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

const events: Array<[string, Record<string, unknown> | undefined]> = [];
const promptExports: Record<string, any> = {};
new Function("require", "exports", compiled)((id: string) => {
  if (id.endsWith("analytics.ts")) return { track: (event: string, params?: Record<string, unknown>) => { events.push([event, params]); } };
  if (id.endsWith("estimatorSession.ts")) return { recordRecoveryAction() {}, deviceCategory: () => "desktop", getEstimatorSessionId: () => "session" };
  return require(id);
}, promptExports);

const { TEXT_REPLY_HOURS, RecoveryReply, AbandonmentPrompt } = promptExports;
const TEXT_REPLY_LINE = `Prefer to text? Text (208) 477-1169. We reply in minutes during business hours (${TEXT_REPLY_HOURS}).`;
const IDLE_LINE = "A quick call or text answers most questions in a minute. Or leave a number and we will call you back within one business day.";
const SENT_LINE = "Thanks. Someone from the team will call within one business day. You can keep going here or close this window.";

function visible(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function findElement(node: any, testId: string): any {
  if (!node || typeof node !== "object") return null;
  if (node.props?.["data-testid"] === testId) return node;
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : children == null ? [] : [children];
  for (const child of list) {
    const found = findElement(child, testId);
    if (found) return found;
  }
  return null;
}

test("text-reply hours live in one constant", () => {
  assert.equal(TEXT_REPLY_HOURS, "Mon–Fri 9–6, Sat 9–4 MT");
  assert.equal(source.match(/Mon–Fri 9–6, Sat 9–4 MT/g)?.length, 1);
  assert.equal(TEXT_REPLY_LINE, "Prefer to text? Text (208) 477-1169. We reply in minutes during business hours (Mon–Fri 9–6, Sat 9–4 MT).");
});

test("the text-reply line renders immediately after each one-business-day line", () => {
  for (const [sent, line] of [[false, IDLE_LINE], [true, SENT_LINE]] as const) {
    const html = renderToStaticMarkup(RecoveryReply({ sent }));
    const text = visible(html);
    const other = sent ? IDLE_LINE : SENT_LINE;
    assert.ok(text.includes(line), line);
    assert.equal(text.includes(other), false);
    assert.equal(text.indexOf(TEXT_REPLY_LINE), text.indexOf(line) + line.length);
    assert.match(html, /href="sms:\+12084771169"/);
    assert.equal(html.match(/href="sms:\+12084771169"/g)?.length, 1);
  }
});

test("the quote recovery prompt keeps both promises and the existing text click", () => {
  const html = renderToStaticMarkup(React.createElement(AbandonmentPrompt, {
    open: false,
    method: null,
    leaving: false,
    onStay() {},
    onContinue() {},
  }));
  const text = visible(html);
  assert.ok(text.includes(IDLE_LINE));
  assert.equal(text.includes(SENT_LINE), false);
  assert.equal(text.indexOf(TEXT_REPLY_LINE), text.indexOf(IDLE_LINE) + IDLE_LINE.length);
  assert.match(html, /data-testid="recovery-text"/);
  assert.match(html, />Text us</);
  const replyAt = source.indexOf("<RecoveryReply sent={state === \"sent\"} />");
  const hiddenAt = source.indexOf("{state !== \"sent\" &&");
  assert.ok(replyAt > 0 && hiddenAt > replyAt);
});

test("the text-reply number uses the existing text_click event", () => {
  events.length = 0;
  const link = findElement(RecoveryReply({ sent: false }), "recovery-text-reply");
  assert.equal(link.type, "a");
  assert.equal(link.props.href, "sms:+12084771169");
  link.props.onClick();
  assert.deepEqual(events, [["text_click", { location: "recovery_prompt" }]]);
});
