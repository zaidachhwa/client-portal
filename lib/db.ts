import mongoose from "mongoose";

// Replica set from docker-compose.yml; transactions need one (§16).
const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27037/client-portal?directConnection=true";
const g = globalThis as { _db?: Promise<typeof mongoose> };

// Queries inside tx() pick up the transaction's session automatically.
mongoose.set("transactionAsyncLocalStorage", true);

// One connection per process, survives hot reload; retried if the first attempt fails.
export const db = () =>
  (g._db ??= mongoose.connect(uri).catch((e) => {
    g._db = undefined;
    throw e;
  }));

// All-or-nothing unit of work. Mongoose retries on transient transaction errors.
// Use insertMany (not create) for arrays inside it; create() with several docs refuses a session.
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await db();
  return mongoose.connection.transaction(fn);
}
