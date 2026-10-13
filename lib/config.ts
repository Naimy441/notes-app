/**
 * Constants shared by the browser app and the server routes. Kept free of any
 * Firebase SDK import so API routes don't pull the client SDK into the server.
 */

export const OWNER_EMAIL = "abdullah.naim.441@gmail.com";

export const FIREBASE_PROJECT_ID = "note-d7ce7";

/** Public Firebase web key (it ships in the client by design). Not an OpenAI secret. */
export const WEB_API_KEY = "AIzaSyAQmcPniVOBtXDi00Q78xmV4t4q6YV2QiE";
