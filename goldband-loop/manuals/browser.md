# Browser work

Use the browser capability available on the active host. Preserve the current
session when it helps, inspect page state before acting, and verify the visible
result after each meaningful action.

- Capture screenshots, console errors, network failures, or page text when they
  are useful evidence. Make screenshots visible to the user when the host
  supports image attachments.
- Ask the user to take over for CAPTCHA, MFA, or authentication that requires
  their direct participation. Resume from the resulting page state.
- Get explicit approval before purchases, form submissions, messages, account
  changes, cookie import, or other outward-facing or irreversible actions.
- Never expose credentials, session cookies, tokens, or private page content in
  logs or reports.
- If browser control is unavailable, report the missing capability instead of
  claiming the page was tested.
