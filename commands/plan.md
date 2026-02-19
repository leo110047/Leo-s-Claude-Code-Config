---
description: Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# Plan Command

Create a comprehensive implementation plan before writing any code.

## Process

1. **Restate Requirements** - Clarify what needs to be built
2. **Explore Codebase** - Read relevant files to understand current architecture
3. **Break Down into Phases** - Specific, actionable steps with dependencies
4. **Assess Risks** - Surface potential issues and blockers
5. **Estimate Complexity** - High / Medium / Low
6. **WAIT for Confirmation** - MUST receive user approval before proceeding

## When to Use

- Starting a new feature
- Making significant architectural changes
- Working on complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## Output Format

```
# Implementation Plan: [Feature Name]

## Requirements Restatement
- [Bullet points restating what needs to be built]

## Implementation Phases

### Phase 1: [Name]
- [Step 1]
- [Step 2]

### Phase 2: [Name]
- [Step 1]
- [Step 2]

## Dependencies
- [External services, libraries, etc.]

## Risks
- HIGH: [Risk description]
- MEDIUM: [Risk description]
- LOW: [Risk description]

## Estimated Complexity: [HIGH/MEDIUM/LOW]

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
```

## CRITICAL Rules

- **NEVER** write code until user explicitly confirms with "yes" or "proceed"
- Always verify assumptions with actual code (Read, Grep, Glob) before planning
- If user says "modify", adjust the plan and present again
