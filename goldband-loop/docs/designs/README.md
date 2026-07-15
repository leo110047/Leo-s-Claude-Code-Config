# Design document lifecycle

This directory contains both current designs and retained decision records. Every
design document must declare exactly one lifecycle status near the top using this
form:

```markdown
**Status:** Active — reason this status applies.
```

Allowed statuses:

- `Active` — current design or architecture with ongoing work or authority.
- `Implemented` — the design shipped; keep the document as a historical decision
  record, and verify current behavior from source and runtime documentation.
- `Superseded` — a newer design or architecture replaced this one; name the current
  owner in the status reason.
- `Abandoned` — the team intentionally stopped pursuing the design and no successor
  implements it.

Delete documents that are clearly invalid and have no durable decision value. Do not
invent intermediate values such as `Draft`, `Tabled`, or `Shipped`; explain that
detail in the reason after the canonical status.
