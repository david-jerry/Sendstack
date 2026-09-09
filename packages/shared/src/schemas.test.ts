import { describe, expect, it } from "vitest";
import {
    addToListSchema,
    campaignFormSchema,
    campaignInputSchema,
    composeBulkSchema,
    composeSingleSchema,
    contactInputSchema,
    customTemplateInputSchema,
    splitAddressList,
    templateRefSchema,
} from "./schemas";

describe("contactInputSchema", () => {
    it("accepts E.164 phone numbers", () => {
        const result = contactInputSchema.safeParse({
            email: "ada@example.com",
            phone: "+14155552671",
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.phone).toBe("+14155552671");
        }
    });

    it("rejects non-E.164 phone numbers", () => {
        const result = contactInputSchema.safeParse({
            email: "ada@example.com",
            phone: "4155552671",
        });

        expect(result.success).toBe(false);
    });

    it("allows blank optional profile fields", () => {
        const result = contactInputSchema.safeParse({
            email: "ada@example.com",
            company: "",
            position: "",
            phone: "",
        });

        expect(result.success).toBe(true);
    });

    it("accepts contact group relationship ids", () => {
        const result = contactInputSchema.safeParse({
            email: "ada@example.com",
            groupIds: ["4fd94928-ee57-41d3-ad59-f25d8b894766"],
        });

        expect(result.success).toBe(true);
    });
});

describe("composeSingleSchema", () => {
    it("accepts several addresses in one field", () => {
        const result = composeSingleSchema.safeParse({
            to: "ada@example.com, grace@example.com\nalan@example.com",
            cc: "",
            bcc: "",
            subject: "Hello",
            html: "<p>Hi</p>",
        });

        expect(result.success).toBe(true);
    });

    it("names the address that is wrong", () => {
        const result = composeSingleSchema.safeParse({
            to: "ada@example.com, not-an-address, grace@example.com",
            cc: "",
            bcc: "",
            subject: "Hello",
            html: "<p>Hi</p>",
        });

        expect(result.success).toBe(false);
        // The whole point of validating the list rather than each row: telling
        // someone "invalid email" about a field holding three of them is not
        // an error message, it is a puzzle.
        expect(result.error?.issues[0]?.message).toContain("not-an-address");
    });

    it("requires a recipient but not a copy", () => {
        const missing = composeSingleSchema.safeParse({
            to: "  ",
            cc: "",
            bcc: "",
            subject: "Hello",
            html: "<p>Hi</p>",
        });
        expect(missing.success).toBe(false);

        const copies = composeSingleSchema.safeParse({
            to: "ada@example.com",
            cc: "",
            bcc: "",
            subject: "Hello",
            html: "<p>Hi</p>",
        });
        expect(copies.success).toBe(true);
    });

    it("keeps the field a string so the form and the action agree", () => {
        const result = composeSingleSchema.safeParse({
            to: "Ada@Example.com",
            cc: "",
            bcc: "",
            subject: "Hello",
            html: "<p>Hi</p>",
        });

        expect(result.success).toBe(true);
        // A transform here would hand the Server Action an array from the form
        // and a string from anywhere else. Splitting stays in one function.
        expect(result.data?.to).toBe("Ada@Example.com");
    });

    it("rejects an empty subject or body", () => {
        const base = { to: "ada@example.com", cc: "", bcc: "" };
        expect(composeSingleSchema.safeParse({ ...base, subject: " ", html: "<p>Hi</p>" }).success)
            .toBe(false);
        expect(composeSingleSchema.safeParse({ ...base, subject: "Hi", html: "" }).success)
            .toBe(false);
    });
});

describe("splitAddressList", () => {
    it("splits on commas, semicolons and newlines, and normalises", () => {
        expect(splitAddressList("Ada@Example.com; grace@example.com\n alan@example.com ")).toEqual([
            "ada@example.com",
            "grace@example.com",
            "alan@example.com",
        ]);
    });

    it("is empty for blank input", () => {
        expect(splitAddressList("   ")).toEqual([]);
        expect(splitAddressList(",,\n;")).toEqual([]);
    });
});

describe("composeBulkSchema", () => {
    it("requires recipients", () => {
        const result = composeBulkSchema.safeParse({
            name: "",
            subject: "Hello",
            html: "<p>Hi</p>",
            recipients: "",
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain("CSV");
    });

    it("takes a name that defaults to the subject downstream", () => {
        const result = composeBulkSchema.safeParse({
            subject: "March update",
            html: "<p>Hi</p>",
            recipients: "ada@example.com",
        });

        expect(result.success).toBe(true);
        expect(result.data?.name).toBeUndefined();
    });
});

describe("campaignFormSchema", () => {
    it("requires a list — a campaign needs someone to go to", () => {
        const result = campaignFormSchema.safeParse({
            name: "March update",
            subject: "What shipped",
            html: "<p>Hi</p>",
            listId: "",
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain("who this goes to");
    });

    it("accepts a campaign with an optional preview line", () => {
        const result = campaignFormSchema.safeParse({
            name: "March update",
            subject: "What shipped",
            preheader: "",
            html: "<p>Hi</p>",
            listId: "4fd94928-ee57-41d3-ad59-f25d8b894766",
        });

        expect(result.success).toBe(true);
    });

    it("does not ask for a sender — settings owns that", () => {
        // A from-address off the verified domain is rejected by the provider,
        // and there is nothing useful someone can do with that error inside a
        // create dialog.
        expect(Object.keys(campaignFormSchema.shape)).not.toContain("fromEmail");
        expect(Object.keys(campaignFormSchema.shape)).not.toContain("fromName");
    });
});

describe("campaignInputSchema", () => {
    it("carries an uploaded template id alongside the built-in kind", () => {
        const result = campaignInputSchema.safeParse({
            name: "March update",
            subject: "What shipped",
            fromName: "Ada",
            fromEmail: "ada@example.com",
            html: "<p>Hi</p>",
            customTemplateId: "4fd94928-ee57-41d3-ad59-f25d8b894766",
        });
        expect(result.success).toBe(true);
        expect(result.data?.customTemplateId).toBe("4fd94928-ee57-41d3-ad59-f25d8b894766");
        expect(result.data?.emailTemplate).toBeNull();
    });

    it("defaults the template to the instance-wide choice", () => {
        const result = campaignInputSchema.safeParse({
            name: "March update",
            subject: "What shipped",
            fromName: "Ada",
            fromEmail: "ada@example.com",
            html: "<p>Hi</p>",
        });

        expect(result.success).toBe(true);
        // Null, not "simple": a campaign written before templates existed must
        // not suddenly render as a different design.
        expect(result.data?.emailTemplate).toBeNull();
    });

    it("rejects a template that does not exist", () => {
        const result = campaignInputSchema.safeParse({
            name: "March update",
            subject: "What shipped",
            fromName: "Ada",
            fromEmail: "ada@example.com",
            html: "<p>Hi</p>",
            emailTemplate: "fancy",
        });

        expect(result.success).toBe(false);
    });
});

describe("templateRefSchema", () => {
    it("accepts a built-in kind and an uploaded template", () => {
        expect(templateRefSchema.safeParse("plain").success).toBe(true);
        expect(
            templateRefSchema.safeParse("custom:4fd94928-ee57-41d3-ad59-f25d8b894766").success,
        ).toBe(true);
    });

    it("rejects a name that is not a design", () => {
        // The offline send route used to list the four kinds by hand; this is
        // the check that replaced it, and it must still refuse what they did.
        expect(templateRefSchema.safeParse("fancy").success).toBe(false);
        expect(templateRefSchema.safeParse("custom:nope").success).toBe(false);
    });
});

describe("customTemplateInputSchema", () => {
    const html =
        "<html><body>{{{ body }}}{{#if unsubscribeUrl}}<a href=\"{{ unsubscribeUrl }}\">Unsubscribe</a>{{/if}}</body></html>";

    it("accepts a named template that meets the contract", () => {
        const result = customTemplateInputSchema.safeParse({ name: " Launch ", html });
        expect(result.success).toBe(true);
        expect(result.data?.name).toBe("Launch");
    });

    it("surfaces the validator's first finding as the field error", () => {
        const result = customTemplateInputSchema.safeParse({ name: "Launch", html: "<html></html>" });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["html"]);
        expect(result.error?.issues[0]?.message).toContain("{{{ body }}}");
    });

    it("needs a name", () => {
        const result = customTemplateInputSchema.safeParse({ name: "", html });
        expect(result.success).toBe(false);
    });
});

describe("addToListSchema", () => {
    it("needs at least one contact", () => {
        const result = addToListSchema.safeParse({
            listId: "4fd94928-ee57-41d3-ad59-f25d8b894766",
            contactIds: [],
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain("at least one");
    });

    it("accepts a selection", () => {
        const result = addToListSchema.safeParse({
            listId: "4fd94928-ee57-41d3-ad59-f25d8b894766",
            contactIds: ["b1f94928-ee57-41d3-ad59-f25d8b894766"],
        });

        expect(result.success).toBe(true);
    });
});
