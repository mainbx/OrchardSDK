import type { EmailProvider } from "./types.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export abstract class BaseEmailService implements EmailProvider {
  abstract sendMessage(
    to: string,
    subject: string,
    body: string,
    attachments?: import("./types.js").File[],
  ): Promise<void>;

  abstract listThreads(): Promise<import("./types.js").ProviderThread[]>;

  abstract listMessages(threadId: string): Promise<import("./types.js").ProviderMessage[]>;

  protected assertNonEmptyString(value: string, fieldName: string): void {
    if (!value.trim()) {
      throw new Error(`'${fieldName}' must be a non-empty string.`);
    }
  }

  protected assertNoHeaderInjection(value: string, fieldName: string): void {
    if (value.includes("\r") || value.includes("\n")) {
      throw new Error(`'${fieldName}' must not include CR/LF characters.`);
    }
  }

  protected assertEmailAddress(value: string, fieldName: string): void {
    if (!EMAIL_REGEX.test(value)) {
      throw new Error(`'${fieldName}' must be a valid email address.`);
    }
  }

  protected assertConfigured(): void {
    // Concrete providers should override this once auth logic is implemented.
  }
}
