// Shared setup for tests that need the database (and, for isolation tests, the running app).
// Run `npm run seed` first: the tests read the demo organization and clean up what they add.
import { createHash } from "node:crypto";
import mongoose from "mongoose";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export async function connect() {
  mongoose.set("transactionAsyncLocalStorage", true);
  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27037/client-portal?directConnection=true");
  return mongoose;
}

// Same hash lib/session.ts stores for session tokens (that module needs Next's runtime, so it isn't imported here).
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
