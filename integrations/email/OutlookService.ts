import type { File, ProviderMessage, ProviderThread } from "./types.js";

export interface OutlookServiceConfig {
  readonly tenantId?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
}

/**
 * Outlook integration stub.
 *
 * Future implementation notes:
 * - Authenticate via Microsoft Entra ID OAuth.
 * - Use Microsoft Graph Mail APIs for threads/messages.
 * - Map Graph conversation IDs to Orchard thread references.
 */
export class OutlookService {
  constructor(private readonly config: OutlookServiceConfig = {}) {}

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: File[],
  ): Promise<void> {
    void attachments;

    // Placeholder: requires Graph OAuth credentials.
    // Expected credentials: tenantId, clientId, clientSecret, refreshToken.
    this.assertConfigured();
    throw new Error(
      `OutlookService.sendMessage is a stub. Target '${to}', subject '${subject}', body length ${body.length}.`,
    );
  }

  async listThreads(): Promise<ProviderThread[]> {
    // Placeholder: use Graph message/conversation endpoints.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    // Placeholder: list messages for a conversation ID.
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
