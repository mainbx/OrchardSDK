import type { File, ProviderMessage, ProviderThread } from "./types.js";
import { BaseEmailService } from "./BaseEmailService.js";

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
export class ProtonMailService extends BaseEmailService {
  private readonly config: ProtonMailServiceConfig;

  constructor(config: ProtonMailServiceConfig = {}) {
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

    // TODO: Implement Proton Mail Bridge auth/session establishment.
    // TODO: Implement SMTP send flow and attachment encoding via Bridge transport.
    // Placeholder: requires Proton Mail Bridge connection details and credentials.
    // Expected config: bridgeHost, bridgePort, username, password.
    this.assertConfigured();
    throw new Error("ProtonMailService.sendMessage is a stub and performs no network calls.");
  }

  async listThreads(): Promise<ProviderThread[]> {
    // TODO: Implement IMAP fetch and thread reconstruction strategy.
    // Placeholder: reconstruct thread-like groupings from IMAP folders/headers.
    this.assertConfigured();
    return [];
  }

  async listMessages(threadId: string): Promise<ProviderMessage[]> {
    this.assertNonEmptyString(threadId, "threadId");
    // TODO: Implement IMAP message retrieval and normalization per thread key.
    // Placeholder: query IMAP messages mapped to a thread identifier strategy.
    this.assertConfigured();
    return [];
  }

  protected assertConfigured(): void {
    void this.config;
  }
}
