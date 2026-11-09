import { useState, type ReactNode } from "react";
import { CalendarIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const COLORS: [string, string][] = [
  ["background", "Page"],
  ["card", "Cards and inputs"],
  ["muted", "Quiet fills, hovers"],
  ["foreground", "Text"],
  ["muted-foreground", "Secondary text"],
  ["border", "Lines"],
  ["input", "Control borders"],
  ["primary", "Actions"],
  ["now", "Today, this week"],
  ["now-wash", "Today's column"],
  ["success", "Paid, invoiced"],
  ["destructive", "Errors, deleting"],
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 py-8 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="font-bold">{title}</h2>
        {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Every component in one place, in whatever theme the system is using. The reference to design against. */
export default function StyleGuide() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Style guide</h1>
      <p className="mt-1 text-muted-foreground">
        The building blocks of Zero Overhead: shadcn/ui components on our own tokens. Switch your system between light and dark to see both.
      </p>

      <Separator className="mt-6" />
      <Section title="Color" note="One neutral palette, dark ink for actions, and blue only for now.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLORS.map(([token, use]) => (
            <div key={token} className="overflow-hidden rounded-lg border">
              <div className="h-14" style={{ background: `var(--${token})` }} />
              <div className="px-3 py-2">
                <div className="font-mono text-xs">{token}</div>
                <div className="text-xs text-muted-foreground">{use}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Separator />
      <Section title="Type" note="Atkinson Hyperlegible Next throughout. Figures use tabular numbers so columns line up.">
        <div className="grid gap-3">
          <p className="text-2xl font-bold tracking-tight">Page title, 2xl bold</p>
          <p className="text-lg font-bold">Dialog and card title, lg bold</p>
          <p>Body text at 15px. Notes and descriptions read at this size.</p>
          <p className="text-sm text-muted-foreground">Secondary text, sm muted</p>
          <p className="text-xs font-bold text-muted-foreground">Group label, xs bold muted</p>
          <p className="num text-3xl font-bold">12:45 $4,250.00</p>
        </div>
      </Section>

      <Separator />
      <Section title="Buttons" note="One primary action per view. Outline for secondary, ghost inside rows and toolbars.">
        <div className="flex flex-wrap items-center gap-2">
          <Button>
            <PlusIcon />
            Track time
          </Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Back to today</Button>
          <Button variant="destructive">
            <Trash2Icon />
            Erase time and invoices
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit">
            <PencilIcon />
          </Button>
          <Button variant="outline" size="icon" aria-label="Pick a date">
            <CalendarIcon />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Separator />
      <Section title="Form controls">
        <div className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="sg-input">Client name</Label>
            <Input id="sg-input" placeholder="Northwind Labs" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-invalid">Hourly rate</Label>
            <Input id="sg-invalid" defaultValue="abc" aria-invalid />
            <p className="text-sm text-destructive">Enter an amount like 150 or 150.00.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-select">Project</Label>
            <Select defaultValue="1">
              <SelectTrigger id="sg-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Northwind Labs</SelectLabel>
                  <SelectItem value="1">Platform redesign</SelectItem>
                  <SelectItem value="2">Design system</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Brightline Events</SelectLabel>
                  <SelectItem value="3">Onboarding flow</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-textarea">Notes</Label>
            <Textarea id="sg-textarea" placeholder="What was this time for?" />
          </div>
          <div className="grid gap-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start font-semibold">
                  <CalendarIcon className="text-muted-foreground" />
                  {date ? date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={setDate} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </Section>

      <Separator />
      <Section title="Tabs and badges">
        <Tabs defaultValue="day">
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">Northwind Labs</Badge>
          <Badge variant="now">Unpaid</Badge>
          <Badge variant="destructive">Overdue</Badge>
          <Badge variant="success">Paid</Badge>
        </div>
      </Section>

      <Separator />
      <Section title="Card and list" note="Rows inside a card, divided by lines. Totals sit in a muted footer.">
        <Card className="overflow-hidden">
          <ul className="divide-y">
            <li className="flex items-start gap-4 px-5 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold">Platform redesign</span>
                  <Badge variant="outline">Northwind Labs</Badge>
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">Project management</div>
                <p className="mt-1.5">Stakeholder review of dashboard v2</p>
              </div>
              <span className="num text-xl font-bold">1:00</span>
              <Button variant="ghost" size="icon-sm" aria-label="Edit">
                <PencilIcon />
              </Button>
            </li>
            <li className="flex items-start gap-4 px-5 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold">Onboarding flow</span>
                  <Badge variant="outline">Brightline Events</Badge>
                  <Badge variant="success">Invoiced</Badge>
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">UI design</div>
              </div>
              <span className="num text-xl font-bold">2:30</span>
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <LockIcon className="size-4" />
              </span>
            </li>
          </ul>
          <CardFooter>
            <span className="ml-auto text-sm text-muted-foreground">Total</span>
            <span className="num ml-4 text-xl font-bold">3:30</span>
          </CardFooter>
        </Card>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Card with header</CardTitle>
            <CardDescription>For settings sections and summaries.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">Content goes here.</CardContent>
        </Card>
      </Section>

      <Separator />
      <Section title="Table">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Frontend development</TableCell>
                <TableCell className="num text-right">42.50</TableCell>
                <TableCell className="num text-right">$160.00</TableCell>
                <TableCell className="num text-right">$6,800.00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Project management</TableCell>
                <TableCell className="num text-right">6.25</TableCell>
                <TableCell className="num text-right">$150.00</TableCell>
                <TableCell className="num text-right">$937.50</TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="num text-right">48.75</TableCell>
                <TableCell />
                <TableCell className="num text-right">$7,737.50</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      </Section>

      <Separator />
      <Section title="Dialog" note="Title, a one-line description, fields, and actions bottom right with the primary last.">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open a dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark as paid</DialogTitle>
              <DialogDescription>Invoice S-1003 for Northwind Labs, $7,737.50</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="sg-paid">Paid on</Label>
              <Input id="sg-paid" type="date" />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>Mark as paid</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>
    </div>
  );
}
