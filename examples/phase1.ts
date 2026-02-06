import { createInMemoryOrchard } from "../src/index.js";

const orchard = createInMemoryOrchard();

// Agents subscribe to audit events and react when approvals/messages occur.
const unsubscribe = orchard.subscribe((event) => {
  if (event.type === "action_request.decided" && event.payload.approval.decision === "approved") {
    console.log("[agent] approval received; safe to run external action:", {
      actionRequestId: event.payload.actionRequest.id,
      actionType: event.payload.actionRequest.actionType,
    });
  }
});

const thread = orchard.createThread({
  ownerId: "human-owner-1",
  title: "Production maintenance",
});

orchard.postMessage({
  threadId: thread.id,
  sender: {
    type: "agent",
    id: "agent-ops",
  },
  body: "I propose rotating production API keys.",
});

const actionRequest = orchard.createActionRequest({
  threadId: thread.id,
  requestedBy: {
    type: "agent",
    id: "agent-ops",
  },
  actionType: "rotate_api_keys",
  payload: {
    environment: "production",
  },
  reason: "Routine key rotation",
  approvalPolicy: {
    ownerOnly: true,
    verification: {
      required: true,
      maxAgeMs: 5 * 60 * 1000,
      allowedMethods: ["webauthn", "magic_link", "email_oauth"],
    },
  },
});

const approval = orchard.decideActionRequest({
  actionRequestId: actionRequest.id,
  decidedBy: {
    type: "human",
    id: "human-owner-1",
  },
  decision: "approved",
  reason: "Approved after verification",
  verification: {
    method: "webauthn",
    verifiedAt: new Date(),
    verifierId: "identity-gateway",
    metadata: {
      sessionId: "sess_123",
    },
  },
});

console.log("approval recorded", approval);
console.log("append-only audit events", orchard.getAuditEvents({ threadId: thread.id }));

unsubscribe();
