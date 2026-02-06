import { randomUUID } from "node:crypto";

import {
  type ActionApprovalPolicy,
  type ActionRequest,
  type ActionRequestCreatedEvent,
  type ActionRequestDecidedEvent,
  type Approval,
  type AuditEvent,
  type AuditEventFilter,
  type Clock,
  type CreateActionRequestInput,
  type CreateThreadInput,
  type DecideActionRequestInput,
  type IdGenerator,
  type Message,
  type MessagePostedEvent,
  type Orchard,
  type OrchardEventListener,
  type PostMessageInput,
  type SubscriptionFilter,
  type Thread,
  type ThreadCreatedEvent,
  type Unsubscribe,
  type VerificationPolicy,
} from "./types.js";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  PolicyViolationError,
  ValidationError,
} from "./errors.js";

export interface InMemoryOrchardOptions {
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly resultId: string;
}

interface ResolvedApprovalPolicy {
  readonly ownerOnly: boolean;
  readonly verification: VerificationPolicy;
}

const clone = <T>(value: T): T => structuredClone(value);

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

class RandomIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

export class InMemoryOrchard implements Orchard {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  private readonly threads = new Map<string, Thread>();
  private readonly messagesByThread = new Map<string, Message[]>();
  private readonly actionRequests = new Map<string, ActionRequest<unknown>>();
  private readonly approvalsByActionRequest = new Map<string, Approval[]>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  private readonly subscribers = new Map<
    number,
    {
      readonly listener: OrchardEventListener;
      readonly filter?: SubscriptionFilter;
    }
  >();

  private subscriberSequence = 0;

  constructor(options: InMemoryOrchardOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.idGenerator ?? new RandomIdGenerator();
  }

  createThread(input: CreateThreadInput): Thread {
    assertNonEmpty(input.ownerId, "ownerId");

    const fingerprint = stableStringify({
      ownerId: input.ownerId,
      title: input.title,
      metadata: input.metadata,
    });

    const idempotent = this.resolveIdempotentResult(
      "thread.create",
      input.idempotencyKey,
      fingerprint,
      (id) => this.threads.get(id),
    );
    if (idempotent) {
      return idempotent;
    }

    const thread: Thread = {
      id: this.ids.next("thr"),
      ownerId: input.ownerId,
      createdAt: this.clock.now(),
      ...(input.title ? { title: input.title } : {}),
      ...(input.metadata ? { metadata: clone(input.metadata) } : {}),
    };

    this.threads.set(thread.id, thread);
    this.messagesByThread.set(thread.id, []);

    this.recordIdempotency("thread.create", input.idempotencyKey, fingerprint, thread.id);

    const event: ThreadCreatedEvent = {
      id: this.ids.next("evt"),
      type: "thread.created",
      threadId: thread.id,
      occurredAt: this.clock.now(),
      payload: {
        thread: clone(thread),
      },
    };
    this.appendAuditEvent(event);

    return clone(thread);
  }

  postMessage(input: PostMessageInput): Message {
    assertNonEmpty(input.threadId, "threadId");
    assertNonEmpty(input.sender.id, "sender.id");
    assertNonEmpty(input.body, "body");

    const thread = this.threads.get(input.threadId);
    if (!thread) {
      throw new NotFoundError(`Thread '${input.threadId}' was not found.`);
    }

    const fingerprint = stableStringify({
      threadId: input.threadId,
      sender: input.sender,
      body: input.body,
      metadata: input.metadata,
    });

    const idempotent = this.resolveIdempotentResult(
      `message.post:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      (id) => this.messagesByThread.get(input.threadId)?.find((message) => message.id === id),
    );
    if (idempotent) {
      return idempotent;
    }

    const message: Message = {
      id: this.ids.next("msg"),
      threadId: input.threadId,
      sender: clone(input.sender),
      body: input.body,
      createdAt: this.clock.now(),
      ...(input.metadata ? { metadata: clone(input.metadata) } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    const messages = this.messagesByThread.get(thread.id);
    if (!messages) {
      throw new ConflictError(`Message storage for thread '${thread.id}' is missing.`);
    }
    messages.push(message);

    this.recordIdempotency(
      `message.post:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      message.id,
    );

    const event: MessagePostedEvent = {
      id: this.ids.next("evt"),
      type: "message.posted",
      threadId: input.threadId,
      occurredAt: this.clock.now(),
      payload: {
        message: clone(message),
      },
    };
    this.appendAuditEvent(event);

    return clone(message);
  }

  createActionRequest<TPayload = unknown>(
    input: CreateActionRequestInput<TPayload>,
  ): ActionRequest<TPayload> {
    assertNonEmpty(input.threadId, "threadId");
    assertNonEmpty(input.requestedBy.id, "requestedBy.id");
    assertNonEmpty(input.actionType, "actionType");

    if (input.requestedBy.type !== "agent") {
      throw new ValidationError("Action requests must be created by an agent participant.");
    }

    const thread = this.threads.get(input.threadId);
    if (!thread) {
      throw new NotFoundError(`Thread '${input.threadId}' was not found.`);
    }

    validateApprovalPolicy(input.approvalPolicy);

    const fingerprint = stableStringify({
      threadId: input.threadId,
      requestedBy: input.requestedBy,
      actionType: input.actionType,
      payload: input.payload,
      reason: input.reason,
      metadata: input.metadata,
      approvalPolicy: input.approvalPolicy,
    });

    const idempotent = this.resolveIdempotentResult(
      `action.create:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      (id) => this.actionRequests.get(id),
    );

    if (idempotent) {
      return idempotent as ActionRequest<TPayload>;
    }

    const actionRequest: ActionRequest<TPayload> = {
      id: this.ids.next("act"),
      threadId: input.threadId,
      requestedBy: clone(input.requestedBy),
      actionType: input.actionType,
      payload: clone(input.payload),
      status: "pending",
      createdAt: this.clock.now(),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.metadata ? { metadata: clone(input.metadata) } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: clone(input.approvalPolicy) } : {}),
    };

    this.actionRequests.set(actionRequest.id, actionRequest);
    this.approvalsByActionRequest.set(actionRequest.id, []);

    this.recordIdempotency(
      `action.create:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      actionRequest.id,
    );

    const event: ActionRequestCreatedEvent = {
      id: this.ids.next("evt"),
      type: "action_request.created",
      threadId: input.threadId,
      occurredAt: this.clock.now(),
      payload: {
        actionRequest: clone(actionRequest),
      },
    };
    this.appendAuditEvent(event);

    return clone(actionRequest);
  }

  decideActionRequest(input: DecideActionRequestInput): Approval {
    assertNonEmpty(input.actionRequestId, "actionRequestId");
    assertNonEmpty(input.decidedBy.id, "decidedBy.id");

    if (input.decidedBy.type !== "human") {
      throw new ValidationError("Action request decisions must be made by a human participant.");
    }

    const actionRequest = this.actionRequests.get(input.actionRequestId);
    if (!actionRequest) {
      throw new NotFoundError(`ActionRequest '${input.actionRequestId}' was not found.`);
    }

    const thread = this.threads.get(actionRequest.threadId);
    if (!thread) {
      throw new ConflictError(
        `Thread '${actionRequest.threadId}' referenced by action request is missing.`,
      );
    }

    const fingerprint = stableStringify({
      actionRequestId: input.actionRequestId,
      decidedBy: input.decidedBy,
      decision: input.decision,
      reason: input.reason,
      verification: input.verification,
    });

    const idempotent = this.resolveIdempotentResult(
      `action.decide:${input.actionRequestId}`,
      input.idempotencyKey,
      fingerprint,
      (id) => this.approvalsByActionRequest.get(input.actionRequestId)?.find((approval) => approval.id === id),
    );
    if (idempotent) {
      return idempotent;
    }

    if (actionRequest.status !== "pending") {
      throw new ConflictError(`ActionRequest '${actionRequest.id}' has already been ${actionRequest.status}.`);
    }

    const policy = resolveApprovalPolicy(actionRequest.approvalPolicy);

    if (policy.ownerOnly && input.decidedBy.id !== thread.ownerId) {
      throw new PolicyViolationError(
        `ActionRequest '${actionRequest.id}' requires owner '${thread.ownerId}' to decide.`,
      );
    }

    const decidedAt = this.clock.now();

    if (input.decision === "approved") {
      ensureApprovalVerificationSatisfiesPolicy(policy.verification, input.verification, decidedAt);
    }

    const approval: Approval = {
      id: this.ids.next("apr"),
      actionRequestId: actionRequest.id,
      threadId: actionRequest.threadId,
      decision: input.decision,
      decidedBy: clone(input.decidedBy),
      decidedAt,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.verification ? { verification: clone(input.verification) } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    const approvals = this.approvalsByActionRequest.get(actionRequest.id);
    if (!approvals) {
      throw new ConflictError(`Approval storage for action request '${actionRequest.id}' is missing.`);
    }
    approvals.push(approval);

    const updatedActionRequest: ActionRequest<unknown> = {
      ...actionRequest,
      status: input.decision,
      resolution: input.decision,
      resolvedAt: decidedAt,
    };
    this.actionRequests.set(actionRequest.id, updatedActionRequest);

    this.recordIdempotency(
      `action.decide:${input.actionRequestId}`,
      input.idempotencyKey,
      fingerprint,
      approval.id,
    );

    const event: ActionRequestDecidedEvent = {
      id: this.ids.next("evt"),
      type: "action_request.decided",
      threadId: actionRequest.threadId,
      occurredAt: this.clock.now(),
      payload: {
        actionRequest: clone(updatedActionRequest),
        approval: clone(approval),
      },
    };
    this.appendAuditEvent(event);

    return clone(approval);
  }

  getThread(threadId: string): Thread | undefined {
    const thread = this.threads.get(threadId);
    return thread ? clone(thread) : undefined;
  }

  getMessages(threadId: string): Message[] {
    const messages = this.messagesByThread.get(threadId);
    if (!messages) {
      return [];
    }
    return clone(messages);
  }

  getActionRequest(actionRequestId: string): ActionRequest | undefined {
    const actionRequest = this.actionRequests.get(actionRequestId);
    return actionRequest ? clone(actionRequest) : undefined;
  }

  getApprovals(actionRequestId: string): Approval[] {
    const approvals = this.approvalsByActionRequest.get(actionRequestId);
    if (!approvals) {
      return [];
    }
    return clone(approvals);
  }

  getAuditEvents(filter: AuditEventFilter = {}): AuditEvent[] {
    const typeSet = filter.types ? new Set(filter.types) : undefined;
    const events = this.auditEvents.filter((event) => {
      if (filter.threadId && event.threadId !== filter.threadId) {
        return false;
      }
      if (typeSet && !typeSet.has(event.type)) {
        return false;
      }
      return true;
    });
    return clone(events);
  }

  subscribe(listener: OrchardEventListener, filter?: SubscriptionFilter): Unsubscribe {
    const id = ++this.subscriberSequence;
    const subscription = filter ? { listener, filter: clone(filter) } : { listener };
    this.subscribers.set(id, subscription);

    return () => {
      this.subscribers.delete(id);
    };
  }

  private appendAuditEvent(event: AuditEvent): void {
    this.auditEvents.push(event);
    this.publishEvent(event);
  }

  private publishEvent(event: AuditEvent): void {
    for (const { listener, filter } of this.subscribers.values()) {
      if (filter?.threadId && filter.threadId !== event.threadId) {
        continue;
      }
      if (filter?.types && !filter.types.includes(event.type)) {
        continue;
      }

      try {
        listener(clone(event));
      } catch {
        // Listener failures must not break state transitions.
      }
    }
  }

  private resolveIdempotentResult<T>(
    scope: string,
    key: string | undefined,
    fingerprint: string,
    fetchById: (resultId: string) => T | undefined,
  ): T | undefined {
    if (!key) {
      return undefined;
    }

    const record = this.idempotency.get(`${scope}:${key}`);
    if (!record) {
      return undefined;
    }

    if (record.fingerprint !== fingerprint) {
      throw new IdempotencyConflictError(
        `Idempotency key '${key}' was already used for a different request payload.`,
      );
    }

    const result = fetchById(record.resultId);
    if (!result) {
      throw new ConflictError(
        `Idempotency record exists for key '${key}' but the original result is missing.`,
      );
    }

    return clone(result);
  }

  private recordIdempotency(
    scope: string,
    key: string | undefined,
    fingerprint: string,
    resultId: string,
  ): void {
    if (!key) {
      return;
    }

    this.idempotency.set(`${scope}:${key}`, {
      fingerprint,
      resultId,
    });
  }
}

export const createInMemoryOrchard = (options: InMemoryOrchardOptions = {}): Orchard =>
  new InMemoryOrchard(options);

const assertNonEmpty = (value: string, fieldName: string): void => {
  if (!value.trim()) {
    throw new ValidationError(`'${fieldName}' must be a non-empty string.`);
  }
};

const resolveApprovalPolicy = (policy: ActionApprovalPolicy | undefined): ResolvedApprovalPolicy => {
  const verification = policy?.verification;

  return {
    ownerOnly: policy?.ownerOnly ?? true,
    verification: {
      required: verification?.required ?? false,
      ...(verification?.maxAgeMs !== undefined ? { maxAgeMs: verification.maxAgeMs } : {}),
      ...(verification?.allowedMethods
        ? { allowedMethods: [...verification.allowedMethods] }
        : {}),
    },
  };
};

const validateApprovalPolicy = (policy: ActionApprovalPolicy | undefined): void => {
  if (!policy) {
    return;
  }

  const verification = policy.verification;
  if (!verification) {
    return;
  }

  if (verification.maxAgeMs !== undefined && verification.maxAgeMs < 0) {
    throw new ValidationError("approvalPolicy.verification.maxAgeMs must be >= 0.");
  }

  if (verification.allowedMethods) {
    if (verification.allowedMethods.length === 0) {
      throw new ValidationError(
        "approvalPolicy.verification.allowedMethods must include at least one method when provided.",
      );
    }

    for (const method of verification.allowedMethods) {
      assertNonEmpty(method, "approvalPolicy.verification.allowedMethods[]");
    }
  }
};

const ensureApprovalVerificationSatisfiesPolicy = (
  policy: VerificationPolicy,
  verification: DecideActionRequestInput["verification"],
  decidedAt: Date,
): void => {
  if (!policy.required) {
    return;
  }

  if (!verification) {
    throw new PolicyViolationError(
      "Approval requires owner verification metadata, but no verification metadata was provided.",
    );
  }

  assertNonEmpty(verification.method, "verification.method");
  assertNonEmpty(verification.verifierId, "verification.verifierId");

  if (policy.allowedMethods && !policy.allowedMethods.includes(verification.method)) {
    throw new PolicyViolationError(
      `Verification method '${verification.method}' is not allowed by this action request policy.`,
    );
  }

  const ageMs = decidedAt.getTime() - verification.verifiedAt.getTime();
  if (ageMs < 0) {
    throw new PolicyViolationError(
      "Verification timestamp cannot be in the future relative to the approval decision.",
    );
  }

  if (policy.maxAgeMs !== undefined && ageMs > policy.maxAgeMs) {
    throw new PolicyViolationError(
      `Verification evidence is too old (${ageMs}ms > ${policy.maxAgeMs}ms).`,
    );
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "null";
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    const serialized = entries.map(
      ([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`,
    );

    return `{${serialized.join(",")}}`;
  }

  return JSON.stringify(value);
};
