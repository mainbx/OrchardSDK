import { randomUUID } from "node:crypto";

import {
  type ActionRequestListFilter,
  type ActionApprovalPolicy,
  type ActionRequest,
  type ActionRequestCreatedEvent,
  type ActionRequestDecidedEvent,
  type Approval,
  type AuditEvent,
  type AuditEventFilter,
  type Clock,
  type CloseThreadInput,
  type CreateActionRequestInput,
  type CreateThreadInput,
  type DecideActionRequestInput,
  type IdGenerator,
  type Message,
  type MessagePostedEvent,
  type Orchard,
  type OrchardEventListener,
  type ParticipantType,
  type PendingActionRequestFilter,
  type PostMessageInput,
  type SubscriptionFilter,
  type Thread,
  type ThreadClosedEvent,
  type ThreadCreatedEvent,
  type ThreadListFilter,
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

const clone = <T>(value: T, fieldName = "value"): T => {
  try {
    return structuredClone(value);
  } catch {
    throw new ValidationError(`'${fieldName}' contains unsupported data for cloning.`);
  }
};

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
    assertNonEmptyString(input.ownerId, "ownerId");
    assertOptionalNonEmptyString(input.title, "title");
    assertOptionalNonEmptyString(input.idempotencyKey, "idempotencyKey");

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
      ...(input.metadata ? { metadata: clone(input.metadata, "metadata") } : {}),
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
    assertNonEmptyString(input.threadId, "threadId");
    assertParticipantRef(input.sender, "sender", ["agent", "human"]);
    assertNonEmptyString(input.body, "body");
    assertOptionalNonEmptyString(input.idempotencyKey, "idempotencyKey");

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
    ensureThreadIsOpen(thread);

    const message: Message = {
      id: this.ids.next("msg"),
      threadId: input.threadId,
      sender: clone(input.sender, "sender"),
      body: input.body,
      createdAt: this.clock.now(),
      ...(input.metadata ? { metadata: clone(input.metadata, "metadata") } : {}),
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
    assertNonEmptyString(input.threadId, "threadId");
    assertParticipantRef(input.requestedBy, "requestedBy", ["agent"]);
    assertNonEmptyString(input.actionType, "actionType");
    assertOptionalNonEmptyString(input.reason, "reason");
    assertOptionalNonEmptyString(input.idempotencyKey, "idempotencyKey");

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
    ensureThreadIsOpen(thread);

    const actionRequest: ActionRequest<TPayload> = {
      id: this.ids.next("act"),
      threadId: input.threadId,
      requestedBy: clone(input.requestedBy, "requestedBy"),
      actionType: input.actionType,
      payload: clone(input.payload, "payload"),
      status: "pending",
      createdAt: this.clock.now(),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.metadata ? { metadata: clone(input.metadata, "metadata") } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: clone(input.approvalPolicy, "approvalPolicy") } : {}),
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
    assertNonEmptyString(input.actionRequestId, "actionRequestId");
    assertParticipantRef(input.decidedBy, "decidedBy", ["human"]);
    assertApprovalDecision(input.decision, "decision");
    assertOptionalNonEmptyString(input.reason, "reason");
    assertOptionalNonEmptyString(input.idempotencyKey, "idempotencyKey");
    if (input.verification) {
      validateVerificationMetadata(input.verification);
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
      decidedBy: clone(input.decidedBy, "decidedBy"),
      decidedAt,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.verification ? { verification: clone(input.verification, "verification") } : {}),
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

  closeThread(input: CloseThreadInput): Thread {
    assertNonEmptyString(input.threadId, "threadId");
    assertParticipantRef(input.closedBy, "closedBy", ["human"]);
    assertOptionalNonEmptyString(input.reason, "reason");
    assertOptionalNonEmptyString(input.idempotencyKey, "idempotencyKey");

    const thread = this.threads.get(input.threadId);
    if (!thread) {
      throw new NotFoundError(`Thread '${input.threadId}' was not found.`);
    }

    if (thread.ownerId !== input.closedBy.id) {
      throw new PolicyViolationError(
        `Thread '${thread.id}' can only be closed by owner '${thread.ownerId}'.`,
      );
    }

    const fingerprint = stableStringify({
      threadId: input.threadId,
      closedBy: input.closedBy,
      reason: input.reason,
      metadata: input.metadata,
    });

    const idempotent = this.resolveIdempotentResult(
      `thread.close:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      (id) => this.threads.get(id),
    );
    if (idempotent) {
      return idempotent;
    }

    if (thread.closedAt) {
      throw new ConflictError(`Thread '${thread.id}' is already closed.`);
    }

    const closedThread: Thread = {
      ...thread,
      closedAt: this.clock.now(),
    };

    this.threads.set(closedThread.id, closedThread);

    this.recordIdempotency(
      `thread.close:${input.threadId}`,
      input.idempotencyKey,
      fingerprint,
      closedThread.id,
    );

    const event: ThreadClosedEvent = {
      id: this.ids.next("evt"),
      type: "thread.closed",
      threadId: closedThread.id,
      occurredAt: this.clock.now(),
      payload: {
        thread: clone(closedThread, "thread"),
        closedBy: clone(input.closedBy, "closedBy"),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ? { metadata: clone(input.metadata, "metadata") } : {}),
      },
    };
    this.appendAuditEvent(event);

    return clone(closedThread);
  }

  listThreads(filter: ThreadListFilter = {}): Thread[] {
    assertOptionalNonEmptyString(filter.ownerId, "ownerId");
    if (filter.includeClosed !== undefined && typeof filter.includeClosed !== "boolean") {
      throw new ValidationError("'includeClosed' must be a boolean.");
    }

    const includeClosed = filter.includeClosed ?? true;
    const threads = [...this.threads.values()].filter((thread) => {
      if (filter.ownerId && thread.ownerId !== filter.ownerId) {
        return false;
      }
      if (!includeClosed && thread.closedAt) {
        return false;
      }
      return true;
    });

    return clone(threads);
  }

  getThread(threadId: string): Thread | undefined {
    assertNonEmptyString(threadId, "threadId");
    const thread = this.threads.get(threadId);
    return thread ? clone(thread) : undefined;
  }

  getMessages(threadId: string): Message[] {
    assertNonEmptyString(threadId, "threadId");
    const messages = this.messagesByThread.get(threadId);
    if (!messages) {
      return [];
    }
    return clone(messages);
  }

  listActionRequests(filter: ActionRequestListFilter = {}): ActionRequest[] {
    assertOptionalNonEmptyString(filter.threadId, "threadId");
    assertOptionalNonEmptyString(filter.actionType, "actionType");
    assertOptionalNonEmptyString(filter.requestedById, "requestedById");
    if (
      filter.status !== undefined &&
      filter.status !== "pending" &&
      filter.status !== "approved" &&
      filter.status !== "denied"
    ) {
      throw new ValidationError("'status' must be one of: pending, approved, denied.");
    }

    const actionRequests = [...this.actionRequests.values()].filter((actionRequest) => {
      if (filter.threadId && actionRequest.threadId !== filter.threadId) {
        return false;
      }
      if (filter.status && actionRequest.status !== filter.status) {
        return false;
      }
      if (filter.actionType && actionRequest.actionType !== filter.actionType) {
        return false;
      }
      if (filter.requestedById && actionRequest.requestedBy.id !== filter.requestedById) {
        return false;
      }
      return true;
    });

    return clone(actionRequests);
  }

  listPendingActionRequests(filter: PendingActionRequestFilter = {}): ActionRequest[] {
    assertOptionalNonEmptyString(filter.threadId, "threadId");
    assertOptionalNonEmptyString(filter.requestedById, "requestedById");

    return this.listActionRequests({
      status: "pending",
      ...(filter.threadId ? { threadId: filter.threadId } : {}),
      ...(filter.requestedById ? { requestedById: filter.requestedById } : {}),
    });
  }

  getActionRequest(actionRequestId: string): ActionRequest | undefined {
    assertNonEmptyString(actionRequestId, "actionRequestId");
    const actionRequest = this.actionRequests.get(actionRequestId);
    return actionRequest ? clone(actionRequest) : undefined;
  }

  getApprovals(actionRequestId: string): Approval[] {
    assertNonEmptyString(actionRequestId, "actionRequestId");
    const approvals = this.approvalsByActionRequest.get(actionRequestId);
    if (!approvals) {
      return [];
    }
    return clone(approvals);
  }

  getAuditEvents(filter: AuditEventFilter = {}): AuditEvent[] {
    assertOptionalNonEmptyString(filter.threadId, "threadId");
    assertOptionalAuditEventTypes(filter.types, "types");
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
    if (typeof listener !== "function") {
      throw new ValidationError("'listener' must be a function.");
    }
    if (filter?.threadId !== undefined) {
      assertNonEmptyString(filter.threadId, "threadId");
    }
    assertOptionalAuditEventTypes(filter?.types, "types");

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

    const record = this.idempotency.get(idempotencyStorageKey(scope, key));
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

    this.idempotency.set(idempotencyStorageKey(scope, key), {
      fingerprint,
      resultId,
    });
  }
}

export const createInMemoryOrchard = (options: InMemoryOrchardOptions = {}): Orchard =>
  new InMemoryOrchard(options);

const assertNonEmptyString = (value: unknown, fieldName: string): void => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`'${fieldName}' must be a non-empty string.`);
  }
};

const assertOptionalNonEmptyString = (value: unknown, fieldName: string): void => {
  if (value === undefined) {
    return;
  }
  assertNonEmptyString(value, fieldName);
};

const assertParticipantRef = (
  value: unknown,
  fieldName: string,
  allowedTypes: readonly ParticipantType[],
): void => {
  if (!isRecord(value)) {
    throw new ValidationError(`'${fieldName}' must be a participant object.`);
  }

  assertNonEmptyString(value.id, `${fieldName}.id`);
  assertNonEmptyString(value.type, `${fieldName}.type`);

  const participantType = value.type as string;
  if (!allowedTypes.includes(participantType as ParticipantType)) {
    throw new ValidationError(
      `'${fieldName}.type' must be one of: ${allowedTypes.map((type) => `'${type}'`).join(", ")}.`,
    );
  }

  if (value.displayName !== undefined) {
    assertNonEmptyString(value.displayName, `${fieldName}.displayName`);
  }
};

const assertApprovalDecision = (value: unknown, fieldName: string): void => {
  if (value !== "approved" && value !== "denied") {
    throw new ValidationError(`'${fieldName}' must be either 'approved' or 'denied'.`);
  }
};

const assertOptionalAuditEventTypes = (value: unknown, fieldName: string): void => {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new ValidationError(`'${fieldName}' must be an array of audit event type strings.`);
  }

  for (const entry of value) {
    assertNonEmptyString(entry, `${fieldName}[]`);
    if (!AUDIT_EVENT_TYPES.has(entry)) {
      throw new ValidationError(`Unsupported audit event type '${entry}'.`);
    }
  }
};

const ensureThreadIsOpen = (thread: Thread): void => {
  if (thread.closedAt) {
    throw new ConflictError(`Thread '${thread.id}' is closed and cannot accept new requests.`);
  }
};

const idempotencyStorageKey = (scope: string, key: string): string =>
  JSON.stringify([scope, key]);

const AUDIT_EVENT_TYPES = new Set([
  "thread.created",
  "thread.closed",
  "message.posted",
  "action_request.created",
  "action_request.decided",
]);

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
  if (verification.maxAgeMs !== undefined && !Number.isFinite(verification.maxAgeMs)) {
    throw new ValidationError("approvalPolicy.verification.maxAgeMs must be a finite number.");
  }

  if (verification.allowedMethods) {
    if (verification.allowedMethods.length === 0) {
      throw new ValidationError(
        "approvalPolicy.verification.allowedMethods must include at least one method when provided.",
      );
    }

    for (const method of verification.allowedMethods) {
      assertNonEmptyString(method, "approvalPolicy.verification.allowedMethods[]");
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

  validateVerificationMetadata(verification);

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

const validateVerificationMetadata = (
  verification: NonNullable<DecideActionRequestInput["verification"]>,
): void => {
  assertNonEmptyString(verification.method, "verification.method");
  assertNonEmptyString(verification.verifierId, "verification.verifierId");
  if (!(verification.verifiedAt instanceof Date) || Number.isNaN(verification.verifiedAt.getTime())) {
    throw new ValidationError("'verification.verifiedAt' must be a valid Date.");
  }
};

const stableStringify = (value: unknown): string => {
  return stableStringifyInternal(value, new WeakSet<object>());
};

const stableStringifyInternal = (value: unknown, seen: WeakSet<object>): string => {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "bigint") {
    return `{\"$bigint\":${JSON.stringify(value.toString())}}`;
  }

  if (typeof value === "number" && Number.isNaN(value)) {
    return "{\"$number\":\"NaN\"}";
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return `{\"$number\":${JSON.stringify(value.toString())}}`;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new ValidationError("Unsupported value type for idempotency fingerprinting.");
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError("Invalid Date value provided.");
    }
    return `{\"$date\":${JSON.stringify(value.toISOString())}}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyInternal(item, seen)).join(",")}]`;
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      throw new ValidationError("Circular references are not supported in idempotent payloads.");
    }
    seen.add(value);
    try {
      const entries: Array<[string, string]> = [...value.entries()]
        .map(([entryKey, entryValue]) => [
          stableStringifyInternal(entryKey, seen),
          stableStringifyInternal(entryValue, seen),
        ] as [string, string])
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
          leftKey === rightKey
            ? compareStrings(leftValue, rightValue)
            : compareStrings(leftKey, rightKey),
        );

      const serializedEntries = entries.map(
        ([entryKey, entryValue]) => `[${entryKey},${entryValue}]`,
      );
      return `{\"$map\":[${serializedEntries.join(",")}]}`;
    } finally {
      seen.delete(value);
    }
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      throw new ValidationError("Circular references are not supported in idempotent payloads.");
    }
    seen.add(value);
    try {
      const entries = [...value.values()]
        .map((entryValue) => stableStringifyInternal(entryValue, seen))
        .sort((left, right) => compareStrings(left, right));
      return `{\"$set\":[${entries.join(",")}]}`;
    } finally {
      seen.delete(value);
    }
  }

  if (ArrayBuffer.isView(value)) {
    const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
    return `{\"$typedArray\":\"${value.constructor.name}\",\"data\":${JSON.stringify(buffer)}}`;
  }

  if (value instanceof ArrayBuffer) {
    const buffer = Buffer.from(value).toString("base64");
    return `{\"$arrayBuffer\":${JSON.stringify(buffer)}}`;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new ValidationError("Circular references are not supported in idempotent payloads.");
    }
    seen.add(value);
    try {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => compareStrings(left, right));

      const serialized = entries.map(
        ([entryKey, entryValue]) =>
          `${JSON.stringify(entryKey)}:${stableStringifyInternal(entryValue, seen)}`,
      );

      return `{${serialized.join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }

  return JSON.stringify(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};
