# Ship-Only Fix-First Heuristic

This file is for `/ship` and explicit repair workflows only. Normal `/review`
must not use it because `/review` is read-only.

## Classification

```
AUTO-FIX (ship may fix without asking):   ASK (needs human judgment):
├─ Dead code / unused variables           ├─ Security (auth, XSS, injection)
├─ Missing eager loading for clear N+1    ├─ Race conditions
├─ Stale comments contradicting code      ├─ Design decisions
├─ Magic numbers to named constants       ├─ Large fixes (>20 lines)
├─ Missing simple output validation       ├─ Enum completeness
├─ Version/path mismatches                ├─ Removing functionality
├─ Variables assigned but never read      └─ Anything changing user-visible
└─ Inline styles, O(n*m) view lookups       behavior
```

Rule of thumb: if the fix is mechanical and a senior engineer would apply it
without discussion, `/ship` may auto-fix it. If reasonable engineers could
disagree, ask first.

Critical findings default toward ASK. Informational findings default toward
AUTO-FIX only when the fix is mechanical and low-risk.
