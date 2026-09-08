# specs

Design intent for things that are **not built**. When code and a spec here disagree, the spec is
intent and the code is reality — reconcile deliberately rather than assuming either one won.

[`shipped/`](shipped/) is the archive. A spec moves there the moment its feature ships, as the last
step of the feature checklist: once the thing is live, how it _behaves_ belongs in
[business-workflows](../development/business-workflows.md) and [manual/](../manual/README.md), and
what survives here is the design rationale — the options weighed and rejected, which no manual
article carries.

**A spec is not a backlog.** An unbuilt spec describes _how_; the tracker says _whether_ and _when_.
Every file in this directory should have an open tracking issue labelled `spec` — three do not
(`project-spec.md`, `staff-email-change-spec.md`, `reservation-confirmation-window.md`), which is
the failure mode this rule exists to catch: work that only exists as a markdown file is work nobody
is going to pick up.

```bash
gh issue list --label spec          # the specs someone is tracking
```

The annotated table of every spec — status, lifecycle and what it covers — is in
[`docs/README.md#specs`](../README.md#specs). It is the only copy; do not start a second one here.

<!-- docs-index: delegated -->
