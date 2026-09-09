"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Client plugins are registered unconditionally, unlike the server's.
 *
 * They only add methods to this object — `authClient.signIn.passkey()` and so
 * on — and calling one against a server that has the plugin disabled returns a
 * 404 rather than doing anything. Registering them always keeps this module
 * free of a round trip to discover configuration, and the UI simply does not
 * render the buttons for methods that are off.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
