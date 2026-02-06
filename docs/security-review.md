---
title: Security Review
description: Comprehensive OrchardSDK security and completeness audit.
---

# Security & Completeness Report

## Scope

Audit date: 2026-02-06

Inspected all tracked repository files via `git ls-files` (code, tests, examples, docs, configs, and lockfile):

- Core SDK: `src/errors.ts`, `src/types.ts`, `src/index.ts`, `src/in-memory-orchard.ts`
- Tests: `tests/orchard.test.ts`
- Example: `examples/phase1.ts`
- Email integrations: `integrations/email/*`
- Documentation: `README.md`, `docs/*.mdx`, `docs.json`
- Config: `.gitignore`, `package.json`, `tsconfig.json`, `package-lock.json`

## Repository Inspection Results

### Placeholder / incomplete sections

The only intentionally incomplete runtime code is in the email provider stubs:

- `integrations/email/GmailService.ts:33`, `integrations/email/GmailService.ts:34`, `integrations/email/GmailService.ts:42`, `integrations/email/GmailService.ts:50`
- `integrations/email/OutlookService.ts:33`, `integrations/email/OutlookService.ts:34`, `integrations/email/OutlookService.ts:42`, `integrations/email/OutlookService.ts:50`
- `integrations/email/ProtonMailService.ts:33`, `integrations/email/ProtonMailService.ts:34`, `integrations/email/ProtonMailService.ts:42`, `integrations/email/ProtonMailService.ts:50`
- `integrations/email/YahooMailService.ts:34`, `integrations/email/YahooMailService.ts:35`, `integrations/email/YahooMailService.ts:43`, `integrations/email/YahooMailService.ts:51`

These now include explicit `TODO` markers for missing auth and provider API/IMAP/SMTP logic.

### "Not implemented" / stub throw sites

- `integrations/email/GmailService.ts:38`
- `integrations/email/OutlookService.ts:38`
- `integrations/email/ProtonMailService.ts:38`
- `integrations/email/YahooMailService.ts:39`

Each throws a controlled stub message and performs no network calls.

### Undocumented/unused artifacts

- `integrations/email/types.ts:12` (`EmailMessageInput`) is not yet consumed by service methods. Added clarifying comment that it is reserved for future adapter APIs.

## Security Review Findings

## Resolved issues

1. Runtime input validation hardening (resolved)
- Issue: public methods trusted TypeScript types; malformed JavaScript callers could bypass type constraints.
- Fix: added runtime validation for strings, participant types, decisions, filters, event types, and listener functions.
- References: `src/in-memory-orchard.ts:102`, `src/in-memory-orchard.ts:150`, `src/in-memory-orchard.ts:216`, `src/in-memory-orchard.ts:291`, `src/in-memory-orchard.ts:397`, `src/in-memory-orchard.ts:466`, `src/in-memory-orchard.ts:501`, `src/in-memory-orchard.ts:559`, `src/in-memory-orchard.ts:575`, `src/in-memory-orchard.ts:666`.

2. Safer cloning and metadata handling (resolved)
- Issue: uncloneable metadata/payload values could throw non-domain errors.
- Fix: wrapped cloning with `ValidationError` conversion.
- References: `src/in-memory-orchard.ts:56`, `src/in-memory-orchard.ts:128`, `src/in-memory-orchard.ts:185`, `src/in-memory-orchard.ts:259`, `src/in-memory-orchard.ts:357`, `src/in-memory-orchard.ts:458`.

3. Idempotency fingerprint robustness (resolved)
- Issue: prior fingerprinting under-modeled complex values and did not detect circular references.
- Fix: deterministic serializer now supports `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`, finite/non-finite numbers, and rejects circular/function/symbol values with explicit errors.
- References: `src/in-memory-orchard.ts:834`, `src/in-memory-orchard.ts:870`, `src/in-memory-orchard.ts:896`, `src/in-memory-orchard.ts:911`, `src/in-memory-orchard.ts:921`.

4. Idempotency map key collision ambiguity (resolved)
- Issue: concatenated `scope:key` storage was delimiter-sensitive.
- Fix: tuple-encoded key via `JSON.stringify([scope, key])`.
- References: `src/in-memory-orchard.ts:625`, `src/in-memory-orchard.ts:656`, `src/in-memory-orchard.ts:731`.

5. Verification metadata validation (resolved)
- Issue: invalid `verifiedAt` could cause runtime exceptions.
- Fix: explicit validation of `method`, `verifierId`, and valid `Date`.
- References: `src/in-memory-orchard.ts:297`, `src/in-memory-orchard.ts:824`.

6. Email stub input safety improvements (resolved)
- Issue: stubs accepted arbitrary subject/body values without minimal safety checks.
- Fix: added non-empty validation and CR/LF header injection checks in all providers.
- References: `integrations/email/GmailService.ts:27`, `integrations/email/OutlookService.ts:27`, `integrations/email/ProtonMailService.ts:27`, `integrations/email/YahooMailService.ts:28`.

## Residual risks / design assumptions

1. Single-process in-memory model
- No multi-process locking or transactional persistence is provided by design.
- For distributed use, callers must back this interface with durable transactional storage.
- References: `README.md:108`, `README.md:109`.

2. Synchronous subscriber execution
- Event listeners execute inline and can block producer latency.
- Listener exceptions are isolated, but long-running listeners can still delay operations.
- References: `src/in-memory-orchard.ts:593`, `src/in-memory-orchard.ts:598`.

3. Email integrations intentionally incomplete
- All provider classes remain scaffolds and must not be treated as production integrations.
- References: `integrations/email/README.md:10`, `docs/extensions/email-integrations.mdx:21`.

## Concurrency / race assessment

- Core SDK methods are synchronous and mutate in-memory maps atomically within a single call stack.
- No `await` exists in core mutating paths, so no async interleaving occurs inside a method body.
- Reentrancy can occur through subscribers calling back into SDK methods, but state transitions are still sequential in a single-threaded runtime.

## Completeness Audit

### Core SDK parity with docs

Validated that documented core APIs exist and are implemented:

- `createThread`, `postMessage`, `createActionRequest`, `decideActionRequest`, `closeThread`, `listThreads`, `listActionRequests`, `listPendingActionRequests`, `getThread`, `getMessages`, `getAuditEvents`, `subscribe`.
- References: `src/types.ts:224`, `src/in-memory-orchard.ts:102`, `src/in-memory-orchard.ts:150`, `src/in-memory-orchard.ts:216`, `src/in-memory-orchard.ts:291`, `src/in-memory-orchard.ts:397`, `src/in-memory-orchard.ts:466`, `src/in-memory-orchard.ts:501`, `src/in-memory-orchard.ts:533`, `src/in-memory-orchard.ts:486`, `src/in-memory-orchard.ts:492`, `src/in-memory-orchard.ts:559`, `src/in-memory-orchard.ts:575`.

### Documentation gaps corrected

- Added `getThread` to API reference.
- Added security notes to README.
- Added note that email stubs only do minimal input checks.
- References: `docs/api-reference.mdx:15`, `README.md:106`, `docs/extensions/email-integrations.mdx:22`.

### Email service implementation requirements (remaining)

For each provider, the following still needs implementation:

- OAuth or provider auth/session bootstrap.
- Real send/list API or IMAP/SMTP calls.
- Pagination, retries, rate-limit handling, error normalization.
- Thread/message mapping semantics and integration tests.

Provider-specific TODO anchors:

- Gmail: `integrations/email/GmailService.ts:33`, `integrations/email/GmailService.ts:42`, `integrations/email/GmailService.ts:50`
- Outlook: `integrations/email/OutlookService.ts:33`, `integrations/email/OutlookService.ts:42`, `integrations/email/OutlookService.ts:50`
- ProtonMail: `integrations/email/ProtonMailService.ts:33`, `integrations/email/ProtonMailService.ts:42`, `integrations/email/ProtonMailService.ts:50`
- Yahoo: `integrations/email/YahooMailService.ts:34`, `integrations/email/YahooMailService.ts:43`, `integrations/email/YahooMailService.ts:51`

## Test Coverage Updates

Added security-focused tests:

- Invalid runtime participant/decision input rejection.
- Circular payload rejection in idempotent requests.
- Map payload idempotency conflict detection.
- Uncloneable metadata rejection.

References: `tests/orchard.test.ts:392`, `tests/orchard.test.ts:429`, `tests/orchard.test.ts:465`.

## Secrets / credentials audit

- No committed API keys, private keys, or live tokens were found.
- Credential-looking fields in email configs are parameter definitions only.
- References: `integrations/email/GmailService.ts:3`, `integrations/email/OutlookService.ts:3`, `integrations/email/ProtonMailService.ts:3`, `integrations/email/YahooMailService.ts:3`.

## Validation

Executed after changes:

- `npm run build` (pass)
- `npm test` (pass)
