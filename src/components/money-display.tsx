import { absoluteAmount, balanceDirection } from "@/features/transactions/ledger";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyBalanceRow } from "@/types/database";

export function Money({ value, currency, className }: { value: string; currency: string; className?: string }) {
  return <span className={cn("money", className)}>{formatMoney(value, currency)}</span>;
}

/** Outstanding balance with its direction spelled out, so a negative number is never ambiguous. */
export function Outstanding({ value, currency }: { value: string; currency: string }) {
  const dir = balanceDirection(value, currency);
  const label = dir === "settled" ? "Settled" : dir === "owes_you" ? "Owes you" : "You owe";
  const tone = dir === "owes_you" ? "text-received" : dir === "you_owe" ? "text-given" : "text-muted-foreground";
  return (
    <span className="inline-flex flex-col items-end leading-tight sm:items-start">
      <Money value={absoluteAmount(value)} currency={currency} className="font-medium" />
      <span className={cn("text-xs", tone)}>{label}</span>
    </span>
  );
}

/** One line per currency; zero ledger shows ₹0.00 in the user's default currency. */
export function BalanceStack({
  balances, field, defaultCurrency,
}: { balances: CurrencyBalanceRow[]; field: "total_received" | "total_given" | "outstanding"; defaultCurrency: string }) {
  const rows = balances.length ? balances : [{ currency: defaultCurrency, total_received: "0.00", total_given: "0.00", outstanding: "0.00" }];
  return (
    <div className="flex flex-col gap-1 sm:items-start">
      {rows.map((b) =>
        field === "outstanding"
          ? <Outstanding key={b.currency} value={b.outstanding} currency={b.currency} />
          : <Money key={b.currency} value={b[field]} currency={b.currency} className={field === "total_received" ? "text-received" : "text-given"} />,
      )}
    </div>
  );
}
