// Honest placeholder for routes that aren't built yet — matches the agent's
// per-page spec so we know what each one needs to become.
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Construction } from 'lucide-react';

export default function StubPage({ title, path }) {
  return (
    <>
      <Topbar title={title} subtitle="Faithful rebuild pending" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Construction size={18} /> {title}
            </CardTitle>
            <CardDescription>
              This route is wired up but the faithful page rebuild is not done yet. It will mirror the
              original <code className="rounded bg-muted px-1 py-0.5">/auth{path}</code> page — same
              filters, same data tables, same SQL queries.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
