---
name: Estimator browser timing
description: How to interpret estimator processing delays without inventing a browser completion failure.
---

Do not diagnose a completion-to-browser handoff failure from total browser-automation wall time alone. Compare persisted queue/model/completion timestamps with when the browser actually presents the first clarification.

**Why:** A confirmed production baseline advanced normally: the job took about 72.5 seconds and the first clarification appeared at about 85 seconds. Most of the much longer automation run was harness overhead, not an application stall.

**How to apply:** Measure queue, provider attempts/backoffs, persisted completion, and visible clarification separately. Change polling or handoff behavior only when a run reproduces a post-completion browser stall.