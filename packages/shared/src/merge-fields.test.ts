import { describe, expect, it } from "vitest";
import { fieldForHeader, parseRecipients, unresolvableTags } from "./merge-fields";

describe("fieldForHeader", () => {
  it.each([
    ["First Name", "firstName"],
    ["first_name", "firstName"],
    ["FIRSTNAME", "firstName"],
    ["Surname", "lastName"],
    ["E-Mail", "email"],
    ["Organisation", "company"],
    ["Job Title", "position"],
    ["Company Role", "position"],
    ["Mobile", "phone"],
  ])("maps %s to %s", (header, tag) => {
    // Spelling, case and separators all vary between exports; none of them
    // should mean a column silently goes unmapped.
    expect(fieldForHeader(header)?.tag).toBe(tag);
  });

  it("returns null for a column it does not recognise", () => {
    expect(fieldForHeader("Lead Score")).toBeNull();
  });
});

describe("parseRecipients", () => {
  it("reads a CSV with headers in any order", () => {
    const result = parseRecipients(
      "Company,Email,First Name,Job Title\nAcme,ada@example.com,Ada,Engineer",
    );
    expect(result.recipients).toEqual([
      { email: "ada@example.com", firstName: "Ada", company: "Acme", position: "Engineer" },
    ]);
  });

  it("respects quoted fields containing commas", () => {
    // A company called "Acme, Inc." shifts every later column when split
    // naively — producing an import that looks like it worked.
    const result = parseRecipients('Email,Company\nada@example.com,"Acme, Inc."');
    expect(result.recipients[0]?.company).toBe("Acme, Inc.");
  });

  it("handles doubled quotes inside a quoted field", () => {
    const result = parseRecipients('Email,Company\nada@example.com,"The ""Big"" Co"');
    expect(result.recipients[0]?.company).toBe('The "Big" Co');
  });

  it("accepts a bare list of addresses", () => {
    const result = parseRecipients("ada@example.com\ngrace@example.com");
    expect(result.recipients.map((r) => r.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("pulls a name out of an addressed line", () => {
    const result = parseRecipients("Ada Lovelace <ada@example.com>");
    expect(result.recipients[0]).toMatchObject({
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("reports bad rows rather than dropping them", () => {
    // An import that says "400 added" while discarding 100 is how a campaign
    // goes to two-thirds of its audience with nobody noticing.
    const result = parseRecipients("Email,First Name\nada@example.com,Ada\nnot-an-email,Bob");
    expect(result.recipients).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ line: 3, reason: "Not a valid address" });
  });

  it("keeps a duplicated address only once, and counts it", () => {
    // Sending the same person a campaign twice is worse than dropping a row.
    const result = parseRecipients("ada@example.com\nADA@example.com\ngrace@example.com");
    expect(result.recipients).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  it("reports which merge fields the data can actually fill", () => {
    const result = parseRecipients("Email,First Name,Company\nada@example.com,Ada,");
    // Company is a column but every value is blank, so offering the tag would
    // promise something the send cannot deliver.
    expect(result.available).toContain("firstName");
    expect(result.available).not.toContain("company");
  });

  it("treats a headerless first row as data, not a header", () => {
    const result = parseRecipients("ada@example.com\ngrace@example.com");
    expect(result.recipients).toHaveLength(2);
  });

  it("returns nothing for empty input", () => {
    expect(parseRecipients("   ").recipients).toHaveLength(0);
  });
});

describe("unresolvableTags", () => {
  it("flags a tag the recipient data cannot fill", () => {
    // This is the check that stops "Hi ," going out to five hundred people.
    expect(unresolvableTags("<p>Hi {{ firstName }} at {{ company }}</p>", ["firstName"])).toEqual([
      "company",
    ]);
  });

  it("ignores tags the sender supplies itself", () => {
    expect(unresolvableTags("<a href={{ unsubscribeUrl }}>x</a>", [])).toEqual([]);
  });

  it("ignores custom attribute lookups", () => {
    expect(unresolvableTags("{{ attributes.plan }}", [])).toEqual([]);
  });

  it("is quiet when everything resolves", () => {
    expect(unresolvableTags("<p>Hi {{ firstName }}</p>", ["firstName", "email"])).toEqual([]);
  });

  it("treats a {{#if field}} condition as a use of that field", () => {
    // A block gated on a column the list lacks would silently vanish.
    expect(unresolvableTags("{{#if company}}at {{ company }}{{/if}}", ["firstName"])).toEqual([
      "company",
    ]);
    expect(unresolvableTags("{{#if company}}x{{/if}}", ["company"])).toEqual([]);
  });
});
