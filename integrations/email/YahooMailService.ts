import type { File, ProviderMessage, ProviderThread } from "./types.js";
import { BaseEmailService } from "./BaseEmailService.js";

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
export class YahooMailService extends BaseEmailService {
  private readonly config: YahooMailServiceConfig;

  constructor(config: YahooMailServiceConfig = {}) {
    super();
    this.config = config;
  }

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: File[],
  ): Promise<void> {
    this.assertEmailAddress(to, "to");
    this.assertNonEmptyString(to, "to");
    this.assertNonEmptyString(subject, "subject");
    this.assertNonEmptyString(body, "body");
    this.assertNoHeaderInjection(subject, "subject");
    void attachments;

    // TODO: Implement Yahoo OAuth/app-password auth management.
    // TODO: Implement SMTP/REST send flow and attachment handling.
    // Placeholder: requires Yahoo OAuth or IMAP/SMTP credentials.
    // Expected config: clientId/clientSecret/refreshToken or IMAP/SMTP credential pair.
    this.assertConfigured();
    throw new Error("YahooMailService.sendMessage is a stub and performs no network calls.");
  }

  async listThreads(): Promise<ProviderThread[]> {
    // TODO: Implement mailbox query and provider thread normalization.
    // Placeholder: fetch and map mailbox threads or emulate threads via headers.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    this.assertNonEmptyString(threadId, "threadId");
    // TODO: Implement message listing and thread correlation strategy.
    // Placeholder: fetch messages by provider-specific thread grouping.
    this.assertConfigured();
    return [];
  }

  protected assertConfigured(): void {
    void this.config;
  }
}
