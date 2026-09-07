import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchNotifications } from "../app/lib/notifications/dispatch.ts";

test("lead escalation mail defaults off before any database or provider access", async () => {
  const original = process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
  try {
    for (const value of [undefined, "false", "", "TRUE"]) {
      if (value === undefined) delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
      else process.env.P5_LEAD_ALERT_EMAILS_ENABLED = value;
      assert.deepEqual(await dispatchNotifications(), {
        considered: 0, sent: 0, suppressed: 0, failed: 0, transport: "disabled",
      });
    }
  } finally {
    if (original === undefined) delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
    else process.env.P5_LEAD_ALERT_EMAILS_ENABLED = original;
  }
});
