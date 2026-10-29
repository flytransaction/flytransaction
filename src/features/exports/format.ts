import { balanceDirection, absoluteAmount } from "@/features/transactions/ledger";

/** "2026-10-28 17:30" in the user's reporting time zone. */
export function formatTimestamp(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

export function directionLabel(outstanding: string, currency: string): string {
  const d = balanceDirection(outstanding, currency);
  const abs = absoluteAmount(outstanding);
  if (d === "settled") return "Settled";
  return d === "owes_you" ? `Person owes you ${currency} ${abs}` : `You owe the person ${currency} ${abs}`;
}

export function safeFileName(s: string): string {
  return s.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";
}

/** Node stream <- async generator of strings, as a web ReadableStream (backpressure-aware). */
export function streamFromStrings(gen: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
}
