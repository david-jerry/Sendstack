import { isLikelyValidEmail, normalizeEmail } from "./email-address";

/**
 * The fields a bulk send can personalise with, defined once.
 *
 * Three things read this list, and they have to agree or personalisation
 * silently breaks: the CSV importer deciding which column is which, the
 * editor's tag palette, and the sender building the context it substitutes
 * into. A tag offered in the UI that the sender does not populate renders as
 * an empty string in someone's inbox, and nothing anywhere reports it.
 */
export type MergeField = {
  tag: string;
  label: string;
  /** Shown in the palette so the tag's effect is obvious before inserting it. */
  example: string;
  /** Header spellings this field answers to, lowercased and stripped. */
  aliases: string[];
};

export const MERGE_FIELDS: MergeField[] = [
  {
    tag: "firstName",
    label: "First name",
    example: "Ada",
    aliases: ["firstname", "first", "givenname", "forename", "fname"],
  },
  {
    tag: "lastName",
    label: "Last name",
    example: "Lovelace",
    aliases: ["lastname", "last", "surname", "familyname", "lname"],
  },
  {
    tag: "email",
    label: "Email",
    example: "ada@example.com",
    aliases: ["email", "emailaddress", "mail", "e-mail"],
  },
  {
    tag: "company",
    label: "Company",
    example: "Analytical Engines",
    aliases: ["company", "organisation", "organization", "org", "employer", "business"],
  },
  {
    tag: "position",
    label: "Role",
    example: "Head of Research",
    aliases: ["position", "role", "title", "jobtitle", "companyrole", "job"],
  },
  {
    tag: "phone",
    label: "Phone",
    example: "+44 20 7946 0000",
    aliases: ["phone", "phonenumber", "mobile", "tel", "telephone", "cell"],
  },
];

/** `First Name` and `first_name` are the same header. */
function canonical(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]/g, "");
}

/** Which merge field a CSV header refers to, if any. */
export function fieldForHeader(header: string): MergeField | null {
  const key = canonical(header);
  return MERGE_FIELDS.find((field) => field.aliases.includes(key)) ?? null;
}

export type ParsedRecipient = {
  email: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  company?: string | undefined;
  position?: string | undefined;
  phone?: string | undefined;
};

export type ParseResult = {
  recipients: ParsedRecipient[];
  /** Which merge fields the input actually supplies. */
  available: string[];
  /** Rows that could not be used, and why. Never silently dropped. */
  skipped: { line: number; value: string; reason: string }[];
  /** Addresses that appeared more than once, kept only on first sight. */
  duplicates: number;
};

/**
 * One CSV line, respecting quoted fields.
 *
 * Written out rather than split on commas because a `company` column holding
 * `Acme, Inc.` is not unusual, and a naive split shifts every column after it
 * — producing an import that looks like it worked.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }

  cells.push(current.trim());
  return cells;
}

/**
 * Turn pasted text into recipients.
 *
 * Accepts both shapes people actually have: a bare list of addresses, and a
 * CSV with headers. Which one it is is decided by whether the first line
 * contains a recognisable header — asking would be a question with an obvious
 * answer the input already contains.
 */
export function parseRecipients(input: string): ParseResult {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const skipped: ParseResult["skipped"] = [];
  const recipients: ParsedRecipient[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  if (lines.length === 0) {
    return { recipients: [], available: [], skipped, duplicates: 0 };
  }

  const headerCells = splitCsvLine(lines[0]!);
  const mapping = headerCells.map(fieldForHeader);
  const hasHeader = mapping.some((field) => field !== null) && mapping.some((f) => f?.tag === "email");

  const emailIndex = hasHeader ? mapping.findIndex((field) => field?.tag === "email") : -1;
  const rows = hasHeader ? lines.slice(1) : lines;

  rows.forEach((line, index) => {
    const lineNumber = index + (hasHeader ? 2 : 1);

    let recipient: ParsedRecipient | null = null;

    if (hasHeader) {
      const cells = splitCsvLine(line);
      const raw = cells[emailIndex] ?? "";
      if (!raw) {
        skipped.push({ line: lineNumber, value: line.slice(0, 60), reason: "No email in this row" });
        return;
      }
      if (!isLikelyValidEmail(raw)) {
        skipped.push({ line: lineNumber, value: raw, reason: "Not a valid address" });
        return;
      }
      recipient = { email: normalizeEmail(raw) };
      mapping.forEach((field, cellIndex) => {
        if (!field || field.tag === "email") return;
        const value = cells[cellIndex]?.trim();
        if (value) (recipient as Record<string, unknown>)[field.tag] = value;
      });
    } else {
      // A bare list may still be `Ada Lovelace <ada@example.com>`.
      const match = /<([^>]+)>/.exec(line);
      const raw = (match?.[1] ?? line).trim();
      if (!isLikelyValidEmail(raw)) {
        skipped.push({ line: lineNumber, value: line.slice(0, 60), reason: "Not a valid address" });
        return;
      }
      const name = match ? line.slice(0, match.index).replace(/["']/g, "").trim() : "";
      const [first, ...rest] = name.split(/\s+/).filter(Boolean);
      recipient = {
        email: normalizeEmail(raw),
        ...(first ? { firstName: first } : {}),
        ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
      };
    }

    if (seen.has(recipient.email)) {
      // Sending the same person a campaign twice is worse than dropping a row,
      // so duplicates are counted and reported rather than passed through.
      duplicates += 1;
      return;
    }
    seen.add(recipient.email);
    recipients.push(recipient);
  });

  const available = MERGE_FIELDS.filter((field) =>
    recipients.some((recipient) => {
      const value = (recipient as Record<string, unknown>)[field.tag];
      return typeof value === "string" && value.length > 0;
    }),
  ).map((field) => field.tag);

  return { recipients, available, skipped, duplicates };
}

/** Merge tags referenced by a body that the recipients cannot fill in. */
export function unresolvableTags(html: string, available: string[]): string[] {
  const used = new Set<string>();
  // Both a value and a `{{#if name}}` condition: a block gated on a field the
  // list lacks would silently vanish, which is the same defect as "Hi ,".
  for (const match of html.matchAll(/\{\{\s*([\w.]+)\s*\}\}|\{\{#if\s+([\w.]+)\s*\}\}/g)) {
    const tag = (match[1] ?? match[2])!;
    // `unsubscribeUrl` is supplied by the sender, not by the recipient data.
    if (tag === "unsubscribeUrl" || tag.startsWith("attributes.")) continue;
    used.add(tag);
  }
  return [...used].filter((tag) => !available.includes(tag));
}
