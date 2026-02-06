export type ParticipantType = "agent" | "human";

/** A participant reference used across messages, action requests, and approvals. */
export interface ParticipantRef {
  readonly type: ParticipantType;
  readonly id: string;
  readonly displayName?: string;
}

/** Conversation container for agent/human communication and action approvals. */
export interface Thread {
  readonly id: string;
  readonly ownerId: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly closedAt?: Date;
}

/** Message posted to a thread by an agent or human participant. */
export interface Message {
  readonly id: string;
  readonly threadId: string;
  readonly sender: ParticipantRef;
  readonly body: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly idempotencyKey?: string;
}

export type ActionRequestStatus = "pending" | "approved" | "denied";
export type ApprovalDecision = "approved" | "denied";

export interface VerificationPolicy {
  /** When true, approval decisions must include verification metadata. */
  readonly required: boolean;
  /** Maximum age allowed between verification time and approval decision time. */
  readonly maxAgeMs?: number;
  /** Optional allowlist of verification methods (for example: webauthn, magic_link). */
  readonly allowedMethods?: readonly string[];
}

export interface ActionApprovalPolicy {
  /** Restrict decisions to the thread owner. Defaults to true in the reference implementation. */
  readonly ownerOnly?: boolean;
  /** Verification requirements that must be met before approval is accepted. */
  readonly verification?: VerificationPolicy;
}

/** Verification evidence provided with a human approval decision. */
export interface OwnerVerificationMetadata {
  readonly method: string;
  readonly verifiedAt: Date;
  readonly verifierId: string;
  readonly metadata?: Record<string, unknown>;
}

/** Structured external action proposal from an agent, optionally requiring human approval. */
export interface ActionRequest<TPayload = unknown> {
  readonly id: string;
  readonly threadId: string;
  readonly requestedBy: ParticipantRef & { readonly type: "agent" };
  readonly actionType: string;
  readonly payload: TPayload;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  readonly approvalPolicy?: ActionApprovalPolicy;
  readonly status: ActionRequestStatus;
  readonly createdAt: Date;
  readonly resolvedAt?: Date;
  readonly resolution?: ApprovalDecision;
}

/** Human decision recorded against an action request. */
export interface Approval {
  readonly id: string;
  readonly actionRequestId: string;
  readonly threadId: string;
  readonly decision: ApprovalDecision;
  readonly decidedBy: ParticipantRef & { readonly type: "human" };
  readonly reason?: string;
  readonly verification?: OwnerVerificationMetadata;
  readonly decidedAt: Date;
  readonly idempotencyKey?: string;
}

export interface CreateThreadInput {
  readonly ownerId: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

export interface PostMessageInput {
  readonly threadId: string;
  readonly sender: ParticipantRef;
  readonly body: string;
  readonly metadata?: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

export interface CreateActionRequestInput<TPayload = unknown> {
  readonly threadId: string;
  readonly requestedBy: ParticipantRef & { readonly type: "agent" };
  readonly actionType: string;
  readonly payload: TPayload;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  readonly approvalPolicy?: ActionApprovalPolicy;
  readonly idempotencyKey?: string;
}

export interface DecideActionRequestInput {
  readonly actionRequestId: string;
  readonly decidedBy: ParticipantRef & { readonly type: "human" };
  readonly decision: ApprovalDecision;
  readonly reason?: string;
  readonly verification?: OwnerVerificationMetadata;
  readonly idempotencyKey?: string;
}

export interface CloseThreadInput {
  readonly threadId: string;
  readonly closedBy: ParticipantRef & { readonly type: "human" };
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

export interface AuditEventBase<TType extends string, TPayload> {
  readonly id: string;
  readonly type: TType;
  readonly threadId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export type ThreadCreatedEvent = AuditEventBase<
  "thread.created",
  {
    readonly thread: Thread;
  }
>;

export type MessagePostedEvent = AuditEventBase<
  "message.posted",
  {
    readonly message: Message;
  }
>;

export type ThreadClosedEvent = AuditEventBase<
  "thread.closed",
  {
    readonly thread: Thread;
    readonly closedBy: ParticipantRef & { readonly type: "human" };
    readonly reason?: string;
    readonly metadata?: Record<string, unknown>;
  }
>;

export type ActionRequestCreatedEvent = AuditEventBase<
  "action_request.created",
  {
    readonly actionRequest: ActionRequest;
  }
>;

export type ActionRequestDecidedEvent = AuditEventBase<
  "action_request.decided",
  {
    readonly actionRequest: ActionRequest;
    readonly approval: Approval;
  }
>;

export type AuditEvent =
  | ThreadCreatedEvent
  | MessagePostedEvent
  | ThreadClosedEvent
  | ActionRequestCreatedEvent
  | ActionRequestDecidedEvent;

export type AuditEventType = AuditEvent["type"];

export interface AuditEventFilter {
  readonly threadId?: string;
  readonly types?: readonly AuditEventType[];
}

export interface SubscriptionFilter {
  readonly threadId?: string;
  readonly types?: readonly AuditEventType[];
}

export interface ThreadListFilter {
  readonly ownerId?: string;
  readonly includeClosed?: boolean;
}

export interface ActionRequestListFilter {
  readonly threadId?: string;
  readonly status?: ActionRequestStatus;
  readonly actionType?: string;
  readonly requestedById?: string;
}

export interface PendingActionRequestFilter {
  readonly threadId?: string;
  readonly requestedById?: string;
}

export type OrchardEventListener = (event: AuditEvent) => void;
export type Unsubscribe = () => void;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Orchard {
  /** Create a thread with an owner identity. */
  createThread(input: CreateThreadInput): Thread;
  /** Post an agent/human message to a thread. */
  postMessage(input: PostMessageInput): Message;
  /** Propose an external action requiring possible human review and approval. */
  createActionRequest<TPayload = unknown>(
    input: CreateActionRequestInput<TPayload>,
  ): ActionRequest<TPayload>;
  /** Approve or deny an action request with optional verification metadata. */
  decideActionRequest(input: DecideActionRequestInput): Approval;
  /** Close a thread to prevent new messages and action requests. */
  closeThread(input: CloseThreadInput): Thread;

  listThreads(filter?: ThreadListFilter): Thread[];
  getThread(threadId: string): Thread | undefined;
  getMessages(threadId: string): Message[];
  listActionRequests(filter?: ActionRequestListFilter): ActionRequest[];
  listPendingActionRequests(filter?: PendingActionRequestFilter): ActionRequest[];
  getActionRequest(actionRequestId: string): ActionRequest | undefined;
  getApprovals(actionRequestId: string): Approval[];
  /** Read immutable audit events (append-only) for observability and replay. */
  getAuditEvents(filter?: AuditEventFilter): AuditEvent[];

  /** Subscribe to emitted audit events; returns an unsubscribe function. */
  subscribe(listener: OrchardEventListener, filter?: SubscriptionFilter): Unsubscribe;
}
