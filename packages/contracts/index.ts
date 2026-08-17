/**
 * The contract every client is typed against.
 *
 * This exists so that `apps/web` — and `apps/desktop`, when it arrives — never
 * import `apps/server` directly. App-to-app dependencies are what make a
 * workspace rot, and the indirection means that if the router definition ever
 * moves out of the server, this is the only file that changes.
 *
 * It is types only. Nothing here is emitted or shipped to a browser.
 */
export type { AppRouter, GraphView } from "@orbital/server";
