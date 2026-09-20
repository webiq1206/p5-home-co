---
name: GitHub synchronization
description: Safe source synchronization while GitHub remains authoritative and Replit-only history remains recoverable.
---

Create the reviewed GitHub commit from the current GitHub branch parent and update the branch reference without force. Before alignment, preserve local history with recovery refs and a bundle. If API-created and local commits have identical trees but different commit IDs, align local `main` to the remote identity only after verifying exact tree equality. Keep pulls configured to stop on divergence rather than rebasing.

**Why:** API-created commits can contain the same source under different commit IDs. Rebasing a local history that already contains equivalent changes can replay duplicate patches, create conflicts, and leave the Git panel in an unfinished operation.

**How to apply:** Compare the expected remote SHA, use a compare-and-set/non-force update, and abort if the remote advanced. Preserve pre-alignment refs and private evidence separately. Fetch, compare trees, then align identities; never rebase duplicate local/API histories.

When the shell remote has no credential helper but an authorized GitHub connector is available, do not expose or request a token. The connector's Git commit API normalizes away a terminal commit-message newline, so it may not reproduce a local commit SHA even when every visible field matches.

**Why:** Treating that normalized SHA as corruption can block an otherwise exact tree reconciliation, while assuming equality without checking can discard history.

**How to apply:** Require the expected remote parent, exact tree, ordered parents, author metadata, and `force:false`; then fetch and align local history only after Git confirms the remote tree is byte-identical.