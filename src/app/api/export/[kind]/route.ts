import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActionContext } from "@/lib/security/guard";
import { rateLimit } from "@/lib/security/rate-limit";
import { isValidIsoDate } from "@/lib/money";
import { iterateLedger, iteratePeople, iterateTable, iterateTransactions } from "@/features/exports/queries";
import { ledgerCsv, peopleCsv, transactionsCsv } from "@/features/exports/csv";
import { ledgerXlsx, peopleXlsx, transactionsXlsx } from "@/features/exports/xlsx";
import { statementPdf, statementTotals } from "@/features/exports/pdf";
import { formatTimestamp, safeFileName, streamFromStrings } from "@/features/exports/format";
import { getPerson } from "@/features/people/queries";
import { getPersonTotals } from "@/features/transactions/queries";
import { minorToDecimal, parseMinor } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  format: z.enum(["csv", "xlsx", "pdf", "json"]).default("csv"),
  personId: z.string().uuid().optional(),
  from: z.string().refine(isValidIsoDate).optional(),
  to: z.string().refine(isValidIsoDate).optional(),
  type: z.enum(["received", "given"]).optional(),
});

const MIME = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  json: "application/json; charset=utf-8",
} as const;

const json = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

/**
 * GET /api/export/{people|transactions|ledger|account-data}?format=csv|xlsx|pdf|json&personId&from&to&type
 * Ownership comes from the session (RLS), never from the query string. A foreign personId yields "not found".
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return json(auth.error, 401);
  const { ctx } = auth;

  if (!(await rateLimit("export", ctx.userId, 20, 300))) return json("Too many exports. Try again in a few minutes.", 429);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json("Invalid export options.", 400);
  const q = parsed.data;
  if (q.from && q.to && q.from > q.to) return json("The start date is after the end date.", 400);

  const supabase = await createClient();
  const tz = ctx.profile.time_zone;
  const stamp = formatTimestamp(new Date().toISOString(), tz).slice(0, 10);
  const filters = { from: q.from, to: q.to, type: q.type };
  const send = (body: ReadableStream<Uint8Array>, name: string, format: keyof typeof MIME) =>
    new Response(body, {
      headers: {
        "content-type": MIME[format],
        "content-disposition": `attachment; filename="${safeFileName(name)}-${stamp}.${format}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });

  switch (kind) {
    case "people": {
      if (q.format === "csv") return send(streamFromStrings(peopleCsv(iteratePeople(supabase, ctx.profile.default_currency))), "people", "csv");
      if (q.format === "xlsx") return send(peopleXlsx(iteratePeople(supabase, ctx.profile.default_currency)), "people", "xlsx");
      return json("Unsupported format for this export.", 400);
    }
    case "transactions": {
      if (q.format === "csv") return send(streamFromStrings(transactionsCsv(iterateTransactions(supabase, filters, q.personId), tz)), "transactions", "csv");
      if (q.format === "xlsx") return send(transactionsXlsx(iterateTransactions(supabase, filters, q.personId), tz), "transactions", "xlsx");
      return json("Unsupported format for this export.", 400);
    }
    case "ledger": {
      if (!q.personId) return json("Choose a person.", 400);
      const person = await getPerson(q.personId); // RLS: someone else's person comes back null
      if (!person) return json("Person not found.", 404);
      const name = `ledger-${person.name}`;
      if (q.format === "csv") return send(streamFromStrings(ledgerCsv(iterateLedger(supabase, person.id, filters), person.name, tz)), name, "csv");
      if (q.format === "xlsx") return send(ledgerXlsx(iterateLedger(supabase, person.id, filters), person.name, tz), name, "xlsx");
      if (q.format === "pdf") {
        // Pass 1: totals for the selected range. Pass 2 (inside statementPdf): the rows.
        const periodRows = await collect(iterateLedger(supabase, person.id, filters));
        const totals = statementTotals(periodRows);
        const filtered = Boolean(q.from || q.to || q.type);
        const allTime = filtered
          ? (await getPersonTotals(person.id)).map((t) => ({
              currency: t.currency,
              totalReceived: minorToDecimal(parseMinor(t.total_received, t.currency), t.currency),
              totalGiven: minorToDecimal(parseMinor(t.total_given, t.currency), t.currency),
              outstanding: t.outstanding.startsWith("-")
                ? `-${minorToDecimal(parseMinor(t.outstanding.slice(1), t.currency), t.currency)}`
                : minorToDecimal(parseMinor(t.outstanding, t.currency), t.currency),
            }))
          : undefined;
        const body = statementPdf(
          { personName: person.name, timeZone: tz, from: q.from, to: q.to, type: q.type, allTime },
          totals,
          () => iterateLedger(supabase, person.id, filters),
        );
        return send(body, `statement-${person.name}`, "pdf");
      }
      return json("Unsupported format for this export.", 400);
    }
    case "account-data": {
      return send(streamFromStrings(accountData(supabase, ctx.profile, tz)), "fly-transaction-account-data", "json");
    }
    default:
      return json("Unknown export.", 404);
  }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  // Statement totals need one pass before rendering. Rows are small; 1M rows is ~100 MB worst case, so cap it.
  const out: T[] = [];
  for await (const r of gen) {
    out.push(r);
    if (out.length > 1_000_000) throw new Error("export_too_large");
  }
  return out;
}

async function* accountData(supabase: Awaited<ReturnType<typeof createClient>>, profile: { id: string; full_name: string; email: string | null; time_zone: string; default_currency: string; created_at: string }, tz: string): AsyncGenerator<string> {
  yield `{"exported_at":${JSON.stringify(new Date().toISOString())},"reporting_time_zone":${JSON.stringify(tz)},`;
  yield `"profile":${JSON.stringify({ id: profile.id, full_name: profile.full_name, email: profile.email, time_zone: profile.time_zone, default_currency: profile.default_currency, created_at: profile.created_at })}`;
  for (const [key, table] of [["people", "people"], ["transactions", "transactions"], ["transaction_audit_logs", "transaction_audit_logs"]] as const) {
    yield `,"${key}":[`;
    let first = true;
    for await (const row of iterateTable(supabase, table)) {
      yield (first ? "" : ",") + JSON.stringify(row);
      first = false;
    }
    yield "]";
  }
  yield "}";
}
