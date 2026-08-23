# QuickBooks Online: future integration

**QuickBooks is not connected, and was not touched during this project.**

No login, no OAuth request, no API credentials, no data sent, and no existing
configuration or Handoff-to-QuickBooks connection inspected or changed.

## The flag

`settings.featureFlags.quickBooksIntegrationEnabled` — defaults to **false**.

While false, the system makes no QuickBooks API requests, requests no
credentials, runs no synchronization jobs, and displays no financial data as
verified. Administrators see QuickBooks as **Planned**, never Failed, and
accounting controls stay hidden from employees. Its disconnected state raises
no alerts and fails no tests.

## What exists now

Reserved, unused, null columns on `deal`: `quickbooks_customer_id`,
`quickbooks_estimate_id`, `quickbooks_invoice_id`. The `integration_health`
table can carry a `quickbooks` row in the `planned` state.

## Intended scope, once enabled

QuickBooks remains the accounting system of record. The P5 interface would show
**read-only** status: customer, estimate, invoice, payment, balance, last sync,
sync error, and a direct link to the record.

## Explicitly out of scope

The following must never be built here: reconciling transactions, changing the
chart of accounts, changing taxes, changing products or services, marking
invoices paid, modifying payments, creating duplicate invoices, or pushing
HubSpot deals directly into QuickBooks.

The intended architecture is **Handoff → QuickBooks**. A second path from the
CRM into accounting would produce duplicate customers and invoices.

---

**Update (2026-08-22):** the owner commissioned the full P5 Financial Operating
System, superseding the "planned, read-only" scope above. The integration now
lives in `app/lib/finance/` with the feature documented in `docs/finance-os.md`.
The architectural principles of this document survive unchanged: QuickBooks is
the accounting system of record, the P5 side never becomes a second ledger, and
no duplicate customer/invoice path is created.
