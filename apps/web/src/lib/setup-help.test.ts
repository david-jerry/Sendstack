import { describe, expect, it } from "vitest";
import { HELP } from "./setup-help";

/**
 * The help content is the whole point of the wizard — a field with no
 * explanation is a field someone abandons setup on. These assert the shape
 * rather than the wording, so copy can be improved without breaking the build.
 */
describe("setup help", () => {
  const topics = Object.entries(HELP);

  it("covers every credential the wizard asks for", () => {
    for (const key of [
      "databaseUrl",
      "authSecret",
      "resendApiKey",
      "resendDomain",
      "resendWebhookSecret",
      "redis",
      "inngest",
      "cloudinary",
      "logo",
      "favicon",
      "passkey",
      "magicLink",
    ]) {
      expect(HELP, `missing help for ${key}`).toHaveProperty(key);
    }
  });

  it.each(topics)("%s has a title, summary and at least one step", (_key, topic) => {
    expect(topic.title.length).toBeGreaterThan(0);
    expect(topic.summary.length).toBeGreaterThan(0);
    expect(topic.steps.length).toBeGreaterThan(0);
  });

  it.each(topics.filter(([, t]) => t.link))("%s links to an https URL", (_key, topic) => {
    expect(topic.link!.href).toMatch(/^https:\/\//);
  });

  it("warns about the mistakes that cost an hour", () => {
    // These four are the ones that fail silently rather than loudly.
    for (const key of ["resendApiKey", "resendDomain", "authSecret", "cloudinary"]) {
      expect(HELP[key]!.gotcha, `${key} should carry a gotcha`).toBeTruthy();
    }
  });
});
