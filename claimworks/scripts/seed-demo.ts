/**
 * Dev helper: create (idempotently, by filer code) a demo brokerage so a book can be
 * ingested and viewed in the dashboard. Prints the brokerage id. Requires DATABASE_URL.
 * Usage: npm run seed:demo [filerCode] [contactEmail]
 */
import { eq } from "drizzle-orm";
import { brokerages } from "../src/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const filerCode = process.argv[2] ?? "ABC";
const contactEmail = process.argv[3] ?? "demo@reliquify.com";

async function main() {
  const { db } = await import("../src/db/client");
  const existing = await db.select().from(brokerages).where(eq(brokerages.filerCode, filerCode));
  if (existing[0]) {
    console.log(existing[0].id);
    return;
  }
  const [row] = await db
    .insert(brokerages)
    .values({ name: `${filerCode} Customs Brokerage`, filerCode, contactName: "Demo Broker", contactEmail })
    .returning({ id: brokerages.id });
  console.log(row.id);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
