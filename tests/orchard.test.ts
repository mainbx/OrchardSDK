import { describe, expect, it } from "vitest";

import {
  InMemoryOrchard,
  IdempotencyConflictError,
  PolicyViolationError,
  type Clock,
  type IdGenerator,
} from "../src/index.js";

class FakeClock implements Clock {
  private currentMs: number;
  private readonly stepMs: number;

  constructor(startIso: string, stepMs = 1_000) {
    this.currentMs = Date.parse(startIso);
    this.stepMs = stepMs;
  }

  now(): Date {
    const date = new Date(this.currentMs);
    this.currentMs += this.stepMs;
    return date;
  }
}

class SequentialIdGenerator implements IdGenerator {
  private sequence = 0;

  next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }
}

const createSdk = () =>
  new InMemoryOrchard({
    clock: new FakeClock("2026-01-01T00:00:00.000Z"),
    idGenerator: new SequentialIdGenerator(),
  });

describe("InMemoryOrchard", () => {
  it("supports agent proposal + human approval with verification and subscription", () => {
    const orchard = createSdk();
    const seenEventTypes: string[] = [];

    orchard.subscribe((event) => {
      seenEventTypes.push(event.type);
    });

    const thread = orchard.createThread({
      ownerId: "owner-1",
      title: "Ops approvals",
    });

    orchard.postMessage({
      threadId: thread.id,
      sender: {
        type: "agent",
        id: "agent-alpha",
      },
      body: "I propose rotating the API key.",
    });

    const action = orchard.createActionRequest({
      threadId: thread.id,
      requestedBy: {
        type: "agent",
        id: "agent-alpha",
      },
      actionType: "rotate_api_key",
      payload: {
        environment: "prod",
      },
      approvalPolicy: {
        ownerOnly: true,
        verification: {
          required: true,
          maxAgeMs: 60_000,
          allowedMethods: ["webauthn", "magic_link"],
        },
      },
    });

    const approval = orchard.decideActionRequest({
      actionRequestId: action.id,
      decidedBy: {
        type: "human",
        id: "owner-1",
      },
      decision: "approved",
      reason: "Confirmed in runbook.",
      verification: {
        method: "webauthn",
        verifiedAt: new Date("2026-01-01T00:00:03.500Z"),
        verifierId: "auth-service-1",
      },
    });

    expect(approval.decision).toBe("approved");

    const resolvedAction = orchard.getActionRequest(action.id);
    expect(resolvedAction?.status).toBe("approved");

    expect(seenEventTypes).toEqual([
      "thread.created",
      "message.posted",
      "action_request.created",
      "action_request.decided",
    ]);

    const auditEvents = orchard.getAuditEvents({ threadId: thread.id });
    expect(auditEvents).toHaveLength(4);
    expect(auditEvents[3]?.type).toBe("action_request.decided");
  });

  it("enforces verification policy for approvals requiring recent owner verification", () => {
    const orchard = createSdk();
    const thread = orchard.createThread({ ownerId: "owner-1" });

    const action = orchard.createActionRequest({
      threadId: thread.id,
      requestedBy: {
        type: "agent",
        id: "agent-alpha",
      },
      actionType: "wire_transfer",
      payload: {
        amount: 500,
      },
      approvalPolicy: {
        verification: {
          required: true,
          maxAgeMs: 1_000,
        },
      },
    });

    expect(() =>
      orchard.decideActionRequest({
        actionRequestId: action.id,
        decidedBy: {
          type: "human",
          id: "owner-1",
        },
        decision: "approved",
      }),
    ).toThrow(PolicyViolationError);

    expect(() =>
      orchard.decideActionRequest({
        actionRequestId: action.id,
        decidedBy: {
          type: "human",
          id: "owner-1",
        },
        decision: "approved",
        verification: {
          method: "magic_link",
          verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          verifierId: "auth-service-1",
        },
      }),
    ).toThrow(PolicyViolationError);

    const denied = orchard.decideActionRequest({
      actionRequestId: action.id,
      decidedBy: {
        type: "human",
        id: "owner-1",
      },
      decision: "denied",
      reason: "Not needed.",
    });

    expect(denied.decision).toBe("denied");
    expect(orchard.getActionRequest(action.id)?.status).toBe("denied");
  });

  it("supports idempotent action decisions and rejects conflicting reuse", () => {
    const orchard = createSdk();
    const thread = orchard.createThread({ ownerId: "owner-1" });

    const action = orchard.createActionRequest({
      threadId: thread.id,
      requestedBy: {
        type: "agent",
        id: "agent-alpha",
      },
      actionType: "restart_service",
      payload: {
        service: "payments",
      },
    });

    const firstApproval = orchard.decideActionRequest({
      actionRequestId: action.id,
      decidedBy: {
        type: "human",
        id: "owner-1",
      },
      decision: "approved",
      idempotencyKey: "decision-1",
    });

    const secondApproval = orchard.decideActionRequest({
      actionRequestId: action.id,
      decidedBy: {
        type: "human",
        id: "owner-1",
      },
      decision: "approved",
      idempotencyKey: "decision-1",
    });

    expect(secondApproval.id).toBe(firstApproval.id);
    expect(orchard.getApprovals(action.id)).toHaveLength(1);
    expect(orchard.getAuditEvents({ types: ["action_request.decided"] })).toHaveLength(1);

    expect(() =>
      orchard.decideActionRequest({
        actionRequestId: action.id,
        decidedBy: {
          type: "human",
          id: "owner-1",
        },
        decision: "denied",
        idempotencyKey: "decision-1",
      }),
    ).toThrow(IdempotencyConflictError);
  });

  it("returns defensive copies so audit history remains immutable to callers", () => {
    const orchard = createSdk();
    const thread = orchard.createThread({ ownerId: "owner-1" });

    const events = orchard.getAuditEvents({ threadId: thread.id });
    expect(events).toHaveLength(1);

    const localCopy = events[0];
    if (!localCopy) {
      throw new Error("Expected an event");
    }

    const castForMutation = localCopy as { payload: { thread: { ownerId: string } } };
    castForMutation.payload.thread.ownerId = "tampered-owner";

    const reloaded = orchard.getAuditEvents({ threadId: thread.id });
    const threadCreated = reloaded[0];
    if (!threadCreated || threadCreated.type !== "thread.created") {
      throw new Error("Expected a thread.created event");
    }

    expect(threadCreated.payload.thread.ownerId).toBe("owner-1");
  });
});
