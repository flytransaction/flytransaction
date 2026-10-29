import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArchivePersonButton, PersonForm } from "@/features/people/components";
import { getPerson } from "@/features/people/queries";

export const metadata: Metadata = { title: "Edit person" };

export default async function EditPersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const person = await getPerson(personId);
  if (!person) notFound();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Edit {person.name}</h1>
        <PersonForm personId={person.id} defaults={{ name: person.name, phone: person.phone ?? "", email: person.email ?? "", address: person.address ?? "", notes: person.notes ?? "" }} />
      </div>
      <div className="max-w-xl border-t pt-6"><ArchivePersonButton personId={person.id} name={person.name} /></div>
    </div>
  );
}
