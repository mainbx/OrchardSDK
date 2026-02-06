# OrchardSDK (Phase 1)

OrchardSDK is a transport-agnostic TypeScript SDK for trusted communication between AI agents and humans.

## Scope

This phase includes:

- agent <-> agent and agent <-> human messages in threads
- structured action requests that can require explicit human approval
- approval/deny decisions with optional owner verification metadata
- append-only audit events
- idempotency support for create/post/decision APIs
- event subscription so agents can react to messages and approvals

This phase explicitly does **not** include:

- UI
- email sending or inbox sync
- OAuth provider integrations
- server/database/hosting assumptions

## Install and run

```bash
npm install
npm test
npm run example
```

## Public API

Core exports:

- `createInMemoryOrchard()` / `InMemoryOrchard`
- `Orchard` interface
- domain types (`Thread`, `Message`, `ActionRequest`, `Approval`, `AuditEvent`, etc.)
- error types (`ValidationError`, `PolicyViolationError`, `IdempotencyConflictError`, etc.)

Main operations:

1. `createThread`
2. `postMessage`
3. `createActionRequest`
4. `decideActionRequest` (approve/deny)
5. `subscribe`
6. `getAuditEvents`

## Example flow

```ts
import { createInMemoryOrchard } from "./src/index.js";

const orchard = createInMemoryOrchard();

orchard.subscribe((event) => {
  if (event.type === "action_request.decided" && event.payload.approval.decision === "approved") {
    // Agent can proceed with an external action here.
    // External execution itself is intentionally out of scope for this SDK.
  }
});

const thread = orchard.createThread({ ownerId: "human-owner-1" });

const actionRequest = orchard.createActionRequest({
  threadId: thread.id,
  requestedBy: { type: "agent", id: "agent-ops" },
  actionType: "rotate_api_keys",
  payload: { environment: "prod" },
  approvalPolicy: {
    ownerOnly: true,
    verification: {
      required: true,
      maxAgeMs: 300_000,
      allowedMethods: ["webauthn", "magic_link", "email_oauth"],
    },
  },
});

orchard.decideActionRequest({
  actionRequestId: actionRequest.id,
  decidedBy: { type: "human", id: "human-owner-1" },
  decision: "approved",
  verification: {
    method: "webauthn",
    verifiedAt: new Date(),
    verifierId: "identity-gateway",
  },
});
```

## Verification policy behavior

Verification is metadata only, not provider integration. A caller can enforce policy such as:

- verification required
- verification must be recent (`maxAgeMs`)
- verification method must be in an allowlist (`allowedMethods`)
- owner-only decision (`ownerOnly` default is `true`)

For approvals (`decision = "approved"`), policy checks are enforced before the decision is recorded.
