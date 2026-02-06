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
    this.assertNonEmptyString(to, "to");
    this.assertNonEmptyString(subject, "subject");
    this.assertNonEmptyString(body, "body");
    this.assertNoHeaderInjection(subject, "subject");
    void attachments;

    // TODO: Implement Microsoft Entra OAuth token exchange and refresh management.
    // TODO: Implement Microsoft Graph sendMail integration with attachment support.
    // Placeholder: requires Graph OAuth credentials.
    // Expected credentials: tenantId, clientId, clientSecret, refreshToken.
    this.assertConfigured();
    throw new Error("OutlookService.sendMessage is a stub and performs no network calls.");
  }

  async listThreads(): Promise<ProviderThread[]> {
    // TODO: Implement Graph query logic and normalize conversation data.
    // Placeholder: use Graph message/conversation endpoints.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    this.assertNonEmptyString(threadId, "threadId");
    // TODO: Implement Graph message listing for a specific conversation/thread.
    // Placeholder: list messages for a conversation ID.
    this.assertConfigured();
    return [];
  }

  private assertConfigured(): void {
    void this.config;
  }

  private assertNonEmptyString(value: string, fieldName: string): void {
    if (!value.trim()) {
      throw new Error(`'${fieldName}' must be a non-empty string.`);
    }
  }

  private assertNoHeaderInjection(value: string, fieldName: string): void {
    if (value.includes("\r") || value.includes("\n")) {
      throw new Error(`'${fieldName}' must not include CR/LF characters.`);
    }
  }
}
