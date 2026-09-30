---
name: Large database row transfer
description: Reliable handling of large read-only production JSON rows through the SQL callback
---

For large JSON rows returned by the read-only production SQL callback, prefer a single-row `row_to_json(t)::text` projection and parse the callback's CSV-wrapped field in pure JavaScript. Check for output truncation and verify row identity and a database-computed digest after any development-side transfer. Do not print the payload.

**Why:** A cross-block base64 decode helper for large callback output failed with an internal `executeJs is not defined` error, while parsing the untruncated CSV-wrapped JSON field directly succeeded. Combining multiple large rows can truncate callback output without delivering all evidence.

**How to apply:** Query large rows individually. For the one-field CSV result, strip its header and outer CSV quotes, unescape doubled quotes, then `JSON.parse` the inner row. Keep the payload inside the execution environment, and compare production/development digests after copying only when explicitly authorized.