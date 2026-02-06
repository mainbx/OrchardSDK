import type { File, ProviderMessage, ProviderThread } from "./types.js";

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
export class GmailService {
  constructor(private readonly config: GmailServiceConfig = {}) {}

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: File[],
  ): Promise<void> {
    void attachments;

    // Placeholder: require OAuth credentials once real integration is implemented.
    // Expected credentials: clientId, clientSecret, redirectUri, refreshToken.
    this.assertConfigured();
    throw new Error(
      `GmailService.sendMessage is a stub. Target '${to}', subject '${subject}', body length ${body.length}.`,
    );
  }

  async listThreads(): Promise<ProviderThread[]> {
    // Placeholder: call Gmail threads.list and normalize results.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    // Placeholder: call Gmail threads.get / messages.get and normalize results.
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
