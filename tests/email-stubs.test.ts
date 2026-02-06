import { describe, expect, it } from "vitest";

import { GmailService } from "../integrations/email/GmailService.js";
import { OutlookService } from "../integrations/email/OutlookService.js";
import { ProtonMailService } from "../integrations/email/ProtonMailService.js";
import { YahooMailService } from "../integrations/email/YahooMailService.js";

type ServiceFactory = () => {
  sendMessage: (
    to: string,
    subject: string,
    body: string,
    attachments?: { name: string }[],
  ) => Promise<void>;
  listThreads: () => Promise<unknown[]>;
  listMessages: (threadId: string) => Promise<unknown[]>;
};

const providers: Array<{ name: string; create: ServiceFactory }> = [
  { name: "gmail", create: () => new GmailService() },
  { name: "outlook", create: () => new OutlookService() },
  { name: "protonmail", create: () => new ProtonMailService() },
  { name: "yahoo", create: () => new YahooMailService() },
];

describe("email integration stubs", () => {
  for (const { name, create } of providers) {
    it(`${name} validates sendMessage inputs and remains a stub`, async () => {
      const service = create();

      await expect(service.sendMessage("not-an-email", "hello", "body")).rejects.toThrow(
        "must be a valid email address",
      );
      await expect(service.sendMessage("owner@example.com", "Bad\nHeader", "body")).rejects.toThrow(
        "must not include CR/LF",
      );
      await expect(service.sendMessage("owner@example.com", "subject", "body")).rejects.toThrow(
        "is a stub",
      );
    });

    it(`${name} validates listMessages thread id and keeps listThreads/listMessages as placeholders`, async () => {
      const service = create();

      await expect(service.listThreads()).resolves.toEqual([]);
      await expect(service.listMessages("   ")).rejects.toThrow("non-empty string");
      await expect(service.listMessages("thread-1")).resolves.toEqual([]);
    });
  }
});
