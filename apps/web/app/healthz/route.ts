import { getDb } from "../../lib/server/db.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  try {
    await getDb().sql`select 1`;
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "fail" }, { status: 503, headers });
  }
}
