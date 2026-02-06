export interface File {
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
  readonly data?: Uint8Array;
}

/**
 * Reserved for future adapter APIs that may accept a single message object
 * instead of positional sendMessage parameters.
 */
export interface EmailMessageInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly attachments?: File[];
}

export interface ProviderThread {
  readonly id: string;
  readonly subject?: string;
  readonly snippet?: string;
}

export interface ProviderMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from?: string;
  readonly to?: string[];
  readonly subject?: string;
  readonly bodySnippet?: string;
}
