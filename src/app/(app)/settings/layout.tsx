import Link from "next/link";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tab = "rounded-md px-3 py-1.5 text-sm hover:bg-muted";
  return (
    <div className="space-y-6">
      <nav aria-label="Settings" className="flex flex-wrap gap-1 border-b pb-3">
        <Link className={tab} href="/settings/profile">Profile</Link>
        <Link className={tab} href="/settings/security">Security</Link>
        <Link className={tab} href="/settings/subscription">Subscription</Link>
      </nav>
      {children}
    </div>
  );
}
