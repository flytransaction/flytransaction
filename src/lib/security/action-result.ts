export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export const ok = <T = undefined>(data?: T): ActionResult<T> => ({ ok: true, data: data as T });
export const fail = (error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<never> => ({
  ok: false, error, fieldErrors,
});

/** Maps database/RPC error messages (raised by our SQL functions) to messages safe to show users. */
export function friendlyDbError(message: string | undefined): string {
  switch ((message ?? "").trim()) {
    case "subscription_required": return "Your subscription is not active. Renew to keep working with your records.";
    case "person_not_found": return "That person no longer exists or is archived.";
    case "transaction_not_found": return "That transaction could not be found.";
    case "transaction_not_valid": return "That transaction was already voided.";
    case "invalid_currency": return "That currency is not supported.";
    case "invalid_amount": return "Enter an amount greater than zero with at most two decimals.";
    case "reason_required": return "Add a short reason (at least 3 characters).";
    case "forbidden": return "You do not have permission to do that.";
    case "cannot_suspend_admin": return "Administrator accounts cannot be suspended here.";
    default: return "Something went wrong. Please try again.";
  }
}
