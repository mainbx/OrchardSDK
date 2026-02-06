# Email Integrations (Stubs)

This directory contains provider-specific email integration stubs for:

- Gmail
- Outlook
- ProtonMail
- Yahoo Mail

These classes are placeholders for future implementation. They intentionally do not perform real network calls.

## Current status

Each provider service exposes stub methods:

- `sendMessage(to, subject, body, attachments?)`
- `listThreads()`
- `listMessages(threadId)`

The methods return placeholder values (or throw a stub error for sending) and include inline comments showing where real provider logic should be added.

## Provider implementation considerations

### Gmail

- Use Google OAuth 2.0 credentials (`clientId`, `clientSecret`, `redirectUri`, `refreshToken`).
- Use the Gmail API to send mail and list threads/messages.
- Build MIME messages for attachment handling.

### Outlook

- Use Microsoft Entra ID app credentials and OAuth tokens.
- Use Microsoft Graph Mail APIs for message and conversation access.
- Map Graph conversation IDs to Orchard thread identifiers.

### ProtonMail

- ProtonMail usually requires Proton Mail Bridge for IMAP/SMTP compatibility.
- Configure Bridge host/port and Bridge-specific credentials.
- Implement send/list operations through IMAP/SMTP clients.

### Yahoo Mail

- Use Yahoo OAuth credentials if available for your app model.
- If needed, fall back to IMAP/SMTP with app password or token-based auth.
- Normalize provider message/thread semantics into Orchard-compatible structures.

## Security and production guidance

- Never hardcode secrets in source files.
- Store OAuth/client secrets in a secure secret manager.
- Add token refresh, retry/backoff, and structured error handling.
- Add provider-specific rate-limit handling and telemetry.

## Limitations

- No OAuth flows are implemented.
- No IMAP/SMTP clients are configured.
- No provider SDK/API calls are made.
- No mailbox synchronization or webhook logic exists yet.
