import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

/** Plain GET form: filters live in the URL (shareable, back-button friendly, works without JS). */
export function TransactionFilters({
  action, from, to, type, hidden,
}: { action: string; from?: string; to?: string; type?: string; hidden?: Record<string, string> }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" aria-label="Filter transactions">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div><label htmlFor="f-from" className="mb-1 block text-xs font-medium">From</label><Input id="f-from" type="date" name="from" defaultValue={from} className="w-40" /></div>
      <div><label htmlFor="f-to" className="mb-1 block text-xs font-medium">To</label><Input id="f-to" type="date" name="to" defaultValue={to} className="w-40" /></div>
      <div>
        <label htmlFor="f-type" className="mb-1 block text-xs font-medium">Type</label>
        <Select id="f-type" name="type" defaultValue={type ?? ""} className="w-40">
          <option value="">All</option><option value="received">Received</option><option value="given">Given</option>
        </Select>
      </div>
      <Button type="submit" variant="outline">Apply</Button>
      {from || to || type ? <Link href={action} className="pb-2 text-sm underline text-muted-foreground">Clear</Link> : null}
    </form>
  );
}
