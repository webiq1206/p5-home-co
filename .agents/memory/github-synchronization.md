---
name: GitHub synchronization
description: Safe source synchronization while GitHub remains authoritative and Replit-only history remains recoverable.
---

Create the reviewed GitHub commit from the current GitHub branch parent, update the branch reference without force, then reconcile that commit into the local branch with an explicit no-fast-forward merge. Keep pull configured to stop on divergence rather than rebasing.

**Why:** The local branch intentionally contains Replit-only publication and recovery history that must not become GitHub's source ancestry or be erased by a force update.

**How to apply:** Before every source synchronization, compare the expected remote SHA, use a compare-and-set/non-force reference update, and abort if the remote advanced. Merge the resulting remote commit locally with `--no-ff`; never rebase the local recovery history.