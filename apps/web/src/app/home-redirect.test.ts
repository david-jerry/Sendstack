import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Turning the landing page off has to be true in three places at once, and
 * this is the suite that holds them together.
 *
 * `/` is the obvious one. The other two are `robots.txt` and `sitemap.xml`:
 * a sitemap that still lists a URL which only ever answers with a redirect is
 * how an instance ends up in search results pointing at a sign-in form. The
 * three read the same flag and are tested against the same two states.
 */

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const state = vi.hoisted(() => ({
	setup: { stage: "complete" } as { stage: string },
	config: {} as Record<string, unknown>,
	session: null as unknown,
}));

class Redirected extends Error {
	constructor(readonly to: string) {
		super(`redirect:${to}`);
	}
}

vi.mock("next/navigation", () => ({
	redirect: (to: string) => {
		throw new Redirected(to);
	},
}));

vi.mock("@sendstack/auth", () => ({ getSession: async () => state.session }));

vi.mock("@/lib/config-cache", () => ({
	getSetupStateCached: async () => state.setup,
	getConfigCached: async () => state.config,
	getBrandingRefsCached: async () => ({}),
}));

vi.mock("@sendstack/config", () => ({
	getSetupState: async () => state.setup,
	getConfig: async () => state.config,
	brandingRefs: async () => ({}),
}));

const Home = (await import("./page")).default;
const robots = (await import("./robots")).default;
const sitemap = (await import("./sitemap")).default;

/** Where the route sent us, or `null` if it rendered instead. */
async function landingOn(route: () => Promise<unknown>): Promise<string | null> {
	try {
		await route();
		return null;
	} catch (error) {
		if (error instanceof Redirected) return error.to;
		throw error;
	}
}

beforeEach(() => {
	process.env.NEXT_PUBLIC_APP_URL = "https://mail.example.com";
	state.setup = { stage: "complete" };
	state.session = null;
	state.config = {
		appName: "Acme Mail",
		appUrl: "https://mail.example.com",
		primaryColor: "#4f46e5",
		homeRedirect: false,
	};
});

describe("the home route", () => {
	it("renders the landing page for an anonymous visitor by default", async () => {
		expect(await landingOn(Home)).toBeNull();
	});

	it("redirects an anonymous visitor to the inbox once the flag is on", async () => {
		state.config.homeRedirect = true;
		expect(await landingOn(Home)).toBe("/inbox");
	});

	it("redirects a signed-in visitor whether the flag is on or not", async () => {
		state.session = { user: { id: "u1" } };
		expect(await landingOn(Home)).toBe("/inbox");

		state.config.homeRedirect = true;
		expect(await landingOn(Home)).toBe("/inbox");
	});

	/**
	 * Order matters: an instance that has not finished the wizard has no
	 * settings row, so reading `homeRedirect` from it would be reading a
	 * default — and sending someone to an inbox that cannot exist yet.
	 */
	it("still sends an unconfigured instance to the wizard first", async () => {
		state.setup = { stage: "branding" };
		state.config.homeRedirect = true;
		expect(await landingOn(Home)).toBe("/setup");
	});
});

describe("crawler directives", () => {
	it("offers `/` while the landing page is on", async () => {
		const result = await robots();
		expect(result.rules).toMatchObject({ allow: ["/"] });
		expect(await sitemap()).toHaveLength(1);
	});

	it("withdraws `/` from both files once the flag is on", async () => {
		state.config.homeRedirect = true;

		const result = await robots();
		expect(result.rules).toMatchObject({ disallow: "/" });
		expect(result.rules).not.toHaveProperty("allow");
		expect(await sitemap()).toEqual([]);
	});
});
