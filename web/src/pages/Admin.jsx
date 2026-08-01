// Admin — manage the email → role access list (admin only).
// Backed by server/data/users.json via /api/admin/users.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { adminListUsers, adminSaveUser, adminDeleteUser } from '@/lib/api';
import { useAuth } from '@/auth/AuthProvider';
import { UserCog, UserPlus, Trash2, ShieldCheck, RefreshCw, Search, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const ROLE_TONE = {
  admin:       'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  manager:     'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  salesperson: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  viewer:      'bg-sky-500/15 text-sky-600 dark:text-sky-300',
};

const ROLE_HELP = {
  admin:       'Full access + user management',
  manager:     'All reports except a few owner-only ones',
  salesperson: 'Own performance, floor sales, discontinued only',
  viewer:      'Read-only access to manager reports',
};

export default function Admin() {
  const { user: me } = useAuth();
  const [roles, setRoles] = useState(['admin', 'manager', 'salesperson', 'viewer']);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [savingEmail, setSavingEmail] = useState(null);

  // Add-user form
  const [form, setForm] = useState({ email: '', name: '', role: 'viewer' });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await adminListUsers();
      setRoles(data.roles?.length ? data.roles : roles);
      setUsers(data.users || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    const n = filter.trim().toLowerCase();
    if (!n) return users;
    return users.filter((u) => u.email.includes(n) || (u.name || '').toLowerCase().includes(n) || u.role.includes(n));
  }, [users, filter]);

  const changeRole = async (email, role) => {
    setSavingEmail(email); setError(null);
    try {
      const saved = await adminSaveUser({ email, role });
      setUsers((list) => list.map((u) => (u.email === email ? { ...u, role: saved.role } : u)));
    } catch (e) { setError(e.message); }
    finally { setSavingEmail(null); }
  };

  const addUser = async (e) => {
    e.preventDefault();
    setAdding(true); setError(null);
    try {
      const saved = await adminSaveUser(form);
      setUsers((list) => {
        const rest = list.filter((u) => u.email !== saved.email);
        return [{ email: saved.email, name: saved.name, role: saved.role }, ...rest];
      });
      setForm({ email: '', name: '', role: 'viewer' });
    } catch (e) { setError(e.message); }
    finally { setAdding(false); }
  };

  const removeUser = async (email) => {
    if (!window.confirm(`Remove access for ${email}?`)) return;
    setError(null);
    try {
      await adminDeleteUser(email);
      setUsers((list) => list.filter((u) => u.email !== email));
    } catch (e) { setError(e.message); }
  };

  const roleCounts = useMemo(() => {
    const c = {};
    for (const u of users) c[u.role] = (c[u.role] || 0) + 1;
    return c;
  }, [users]);

  return (
    <>
      <Topbar title="User Management" subtitle={`${users.length} user${users.length === 1 ? '' : 's'} · email → role access list`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* Role legend */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {roles.map((r) => (
            <Card key={r}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-bold uppercase', ROLE_TONE[r] || ROLE_TONE.viewer)}>{r}</span>
                  <p className="mt-1.5 text-[11px] text-muted-fg">{ROLE_HELP[r] || ''}</p>
                </div>
                <span className="text-2xl font-extrabold tabular-nums text-muted-fg">{roleCounts[r] || 0}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add user */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus size={16} className="text-primary" /> Add or update a user</CardTitle>
            <CardDescription>Enter a Google account email and pick a role. Re-adding an existing email updates its role.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addUser} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Email</span>
                <Input type="email" required placeholder="name@123cfc.com" value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-64" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Name (optional)</span>
                <Input placeholder="Full name" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-48" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Role</span>
                <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <Button type="submit" disabled={adding}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Add / Update
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>
        )}

        {/* Users table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2"><UserCog size={16} className="text-primary" /> Access List</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-8 w-48 pl-8" />
              </div>
              <Button variant="outline" size="icon" title="Reload" onClick={load}><RefreshCw size={14} /></Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Email</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Name</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Role</th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-fg">
                      <Loader2 size={18} className="mx-auto animate-spin" /></td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-fg">No users match.</td></tr>
                  ) : filtered.map((u) => {
                    const isMe = u.email === me?.email;
                    return (
                      <tr key={u.email} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium">
                          {u.email}
                          {isMe && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">you</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-fg">{u.name || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <select
                              value={u.role}
                              disabled={savingEmail === u.email}
                              onChange={(e) => changeRole(u.email, e.target.value)}
                              className={cn('h-8 rounded-md border border-border bg-card px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/30', ROLE_TONE[u.role])}
                            >
                              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            {savingEmail === u.email && <Loader2 size={13} className="animate-spin text-muted-fg" />}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => removeUser(u.email)}
                            disabled={isMe}
                            title={isMe ? "You can't remove your own access" : 'Remove access'}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="flex items-center gap-1.5 text-[11px] text-muted-fg">
          <ShieldCheck size={12} /> New users are added here automatically as <strong className="mx-1 text-fg">salesperson</strong> the first time they sign in — promote them in the Role column. Role changes apply on the user's next request (no re-login). Removing a user drops them back to salesperson (re-added on their next sign-in).
        </p>
      </div>
    </>
  );
}
