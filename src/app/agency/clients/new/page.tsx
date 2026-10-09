import { onboardClient } from "@/app/agency/actions";
import { Button, Card, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "Onboard client" };

export default async function NewClientPage() {
  await requireStaff();
  return (
    <>
      <PageHeader title="Onboard a client" description="Give the AI the basics. It plans the site, writes every page, links them and sets up keyword tracking." />
      <Card className="max-w-3xl p-6">
        <form action={onboardClient} className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">Business name</Label>
            <Input id="name" name="name" required placeholder="Brum Plumbing Co" />
          </div>
          <div>
            <Label htmlFor="industry">Industry</Label>
            <Input id="industry" name="industry" required placeholder="Plumbing & heating" />
          </div>
          <div>
            <Label htmlFor="subdomain" hint="(optional)">Site subdomain</Label>
            <Input id="subdomain" name="subdomain" placeholder="brum-plumbing" />
          </div>
          <div>
            <Label htmlFor="services" hint="one per line">Services</Label>
            <Textarea id="services" name="services" required rows={5} placeholder={"Emergency plumbing\nBoiler repair\nBathroom installation"} />
          </div>
          <div>
            <Label htmlFor="locations" hint="primary first">Locations served</Label>
            <Textarea id="locations" name="locations" required rows={5} placeholder={"Birmingham\nSolihull\nSutton Coldfield"} />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div>
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" />
          </div>
          <div>
            <Label htmlFor="hours">Opening hours</Label>
            <Input id="hours" name="hours" placeholder="Mon–Fri 8am–6pm, 24/7 emergencies" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="usp" hint="one per line: only true facts, the AI won't invent any">Selling points</Label>
            <Textarea id="usp" name="usp" rows={3} placeholder={"Gas Safe registered\nFixed prices quoted upfront"} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="instructions" hint="(optional)">Instructions for the AI</Label>
            <Textarea id="instructions" name="instructions" rows={3} placeholder="Friendly tone. Emphasise 24/7 emergency call-outs. Focus on residential customers." />
          </div>
          <div>
            <Label htmlFor="budget">Monthly AI budget (USD)</Label>
            <Input id="budget" name="budget" type="number" min={0} step="1" defaultValue={25} />
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-slate-700">
            <input type="checkbox" name="publish" className="h-4 w-4" /> Publish automatically when generation finishes
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">Create client &amp; generate website</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
