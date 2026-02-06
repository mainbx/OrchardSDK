import type { File, ProviderMessage, ProviderThread } from "./types.js";
import { BaseEmailService } from "./BaseEmailService.js";

export interface GmailServiceConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly refreshToken?: string;
}

/**
 * Gmail integration stub.
 *
 * Future implementation notes:
 * - Authenticate with Google OAuth 2.0 and request Gmail API scopes.
 * - Use access tokens to call Gmail REST APIs for thread/message operations.
 * - Support MIME creation and upload flow for attachments.
 */
export class GmailService extends BaseEmailService {
  private readonly config: GmailServiceConfig;

  constructor(config: GmailServiceConfig = {}) {
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

    // TODO: Implement Gmail OAuth token exchange and storage.
    // TODO: Implement Gmail API send call with MIME attachment support.
    // Placeholder: require OAuth credentials once real integration is implemented.
    // Expected credentials: clientId, clientSecret, redirectUri, refreshToken.
    this.assertConfigured();
    throw new Error("GmailService.sendMessage is a stub and performs no network calls.");
  }

  async listThreads(): Promise<ProviderThread[]> {
    // TODO: Implement Gmail threads.list pagination and response mapping.
    // Placeholder: call Gmail threads.list and normalize results.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    this.assertNonEmptyString(threadId, "threadId");
    // TODO: Implement Gmail threads.get / messages.get mapping for thread retrieval.
    // Placeholder: call Gmail threads.get / messages.get and normalize results.
    this.assertConfigured();
    return [];
  }

  protected assertConfigured(): void {
    void this.config;
  }
}
