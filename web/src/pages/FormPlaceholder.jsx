// Honest placeholder for form pages until each form is wired up to its
// `create*` named query on the server (those are write operations and need
// special handling — out of scope for the read-only rebuild pass).
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { ClipboardEdit, ExternalLink } from 'lucide-react';

export default function FormPlaceholder({ title, description, originalPath }) {
  return (
    <>
      <Topbar title={title} subtitle="Form · pending wiring" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardEdit size={18} /> {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-fg">
              This form lives on the original cpanel for now. Forms write data, which means
              wiring up validated <code className="rounded bg-muted px-1">/api/q/*</code> mutation queries
              on the server — done one at a time as needed. Until then, use the original site
              for entry; this app shows the resulting data on its data pages.
            </p>
            {originalPath && (
              <a
                href={`http://192.168.68.8:3000${originalPath}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition hover:opacity-90"
              >
                Open original form
                <ExternalLink size={14} />
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
