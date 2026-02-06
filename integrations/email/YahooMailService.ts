import type { File, ProviderMessage, ProviderThread } from "./types.js";

export interface YahooMailServiceConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
  readonly imapHost?: string;
  readonly smtpHost?: string;
}

/**
 * Yahoo Mail integration stub.
 *
 * Future implementation notes:
 * - Use Yahoo OAuth credentials where available.
 * - For mailbox sync/send, integrate IMAP/SMTP clients using app passwords or OAuth tokens.
 * - Normalize Yahoo message/thread identifiers into SDK-friendly objects.
 */
export class YahooMailService {
  constructor(private readonly config: YahooMailServiceConfig = {}) {}

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: File[],
  ): Promise<void> {
    void attachments;

    // Placeholder: requires Yahoo OAuth or IMAP/SMTP credentials.
    // Expected config: clientId/clientSecret/refreshToken or IMAP/SMTP credential pair.
    this.assertConfigured();
    throw new Error(
      `YahooMailService.sendMessage is a stub. Target '${to}', subject '${subject}', body length ${body.length}.`,
    );
  }

  async listThreads(): Promise<ProviderThread[]> {
    // Placeholder: fetch and map mailbox threads or emulate threads via headers.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    // Placeholder: fetch messages by provider-specific thread grouping.
    this.assertConfigured();
    if (!threadId.trim()) {
      throw new Error("threadId must be a non-empty string.");
    }
    return [];
  }

  private assertConfigured(): void {
    void this.config;
  }
}
