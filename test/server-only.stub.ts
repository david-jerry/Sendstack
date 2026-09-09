/**
 * Stand-in for the `server-only` marker package during tests.
 *
 * `server-only` deliberately throws unless resolved under React's
 * `react-server` condition — that is the whole mechanism by which it stops a
 * server module being imported into a client bundle. Vitest resolves under
 * neither condition, so the guard fires on any test that reaches a server
 * module. Aliasing it to this empty module keeps the guard doing its real job
 * in the Next build while letting tests import the code it protects.
 */
export {};
