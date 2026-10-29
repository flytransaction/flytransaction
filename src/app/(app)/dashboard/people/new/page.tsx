import type { Metadata } from "next";
import { PersonForm } from "@/features/people/components";

export const metadata: Metadata = { title: "Add person" };

export default function NewPersonPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Add New Person</h1>
      <p className="mb-6 text-sm text-muted-foreground">Their account starts at zero received and zero given.</p>
      <PersonForm />
    </div>
  );
}
