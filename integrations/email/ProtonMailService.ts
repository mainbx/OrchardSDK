import type { File, ProviderMessage, ProviderThread } from "./types.js";

export interface ProtonMailServiceConfig {
  readonly bridgeHost?: string;
  readonly bridgePort?: number;
  readonly username?: string;
  readonly password?: string;
}

/**
 * ProtonMail integration stub.
 *
 * Future implementation notes:
 * - ProtonMail typically requires Proton Mail Bridge for IMAP/SMTP access.
 * - Authenticate with Bridge-generated IMAP/SMTP credentials.
 * - Implement send/list operations through IMAP/SMTP clients.
 */
export class ProtonMailService {
  constructor(private readonly config: ProtonMailServiceConfig = {}) {}

  async sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: File[],
  ): Promise<void> {
    void attachments;

    // Placeholder: requires Proton Mail Bridge connection details and credentials.
    // Expected config: bridgeHost, bridgePort, username, password.
    this.assertConfigured();
    throw new Error(
      `ProtonMailService.sendMessage is a stub. Target '${to}', subject '${subject}', body length ${body.length}.`,
    );
  }

  async listThreads(): Promise<ProviderThread[]> {
    // Placeholder: reconstruct thread-like groupings from IMAP folders/headers.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    // Placeholder: query IMAP messages mapped to a thread identifier strategy.
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
