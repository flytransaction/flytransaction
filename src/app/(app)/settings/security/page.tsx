import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm, DeleteAccountForm } from "@/features/auth/components";
import { signOutEverywhere } from "@/features/auth/actions";
import { requireUser } from "@/lib/security/guard";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requireUser();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
      <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent><ChangePasswordForm /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">Sign out of every device, including this one.</p>
          <form action={signOutEverywhere}><Button type="submit" variant="outline">Sign out everywhere</Button></form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Delete account</CardTitle></CardHeader>
        <CardContent><DeleteAccountForm pendingSince={session.profile.deletion_requested_at} /></CardContent>
      </Card>
    </div>
  );
}
