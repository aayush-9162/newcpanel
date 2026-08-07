// Admin — manage users (email → role) AND roles + their page permissions.
// Backed by server/data/users.json and server/data/roles.json.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  adminListUsers, adminSaveUser, adminDeleteUser,
  adminListRoles, adminSaveRole, adminDeleteRole,
} from '@/lib/api';
import { PERMISSIONABLE_ROUTES } from '@/routes';
import { useAuth } from '@/auth/AuthProvider';
import {
  UserCog, UserPlus, Trash2, ShieldCheck, RefreshCw, Search, Loader2,
  SlidersHorizontal, Plus, Lock, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const TONE_ORDER = ['primary', 'violet', 'emerald', 'sky', 'amber', 'rose'];
const KNOWN_TONE = { superadmin: 'rose', management: 'amber', manager: 'violet', salesperson: 'emerald', viewer: 'sky' };
const TONE_CLASS = {
  primary: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  violet:  'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  sky:     'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  amber:   'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  rose:    'bg-rose-500/15 text-rose-600 dark:text-rose-300',
};
const toneFor = (id, i) => KNOWN_TONE[id] || TONE_ORDER[i % TONE_ORDER.length];

export default function Admin() {
  const { user: me } = useAuth();
  const [roles, setRoles] = useState([]);      // [{ id, label, system, allowAll, routes[] }]
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [savingEmail, setSavingEmail] = useState(null);

  const [form, setForm] = useState({ email: '', name: '', role: '' });
  const [adding, setAdding] = useState(false);

  const [showRoles, setShowRoles] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await adminListUsers();
      setRoles(data.roles || []);
      setUsers(data.users || []);
      setForm((f) => ({ ...f, role: f.role || (data.roles?.find((r) => r.id === 'salesperson')?.id) || data.roles?.[0]?.id || '' }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const reloadRoles = async () => {
    try { setRoles(await adminListRoles()); } catch (e) { setError(e.message); }
  };

  const roleLabel = (id) => roles.find((r) => r.id === id)?.label || id;
  const roleCounts = useMemo(() => {
    const c = {}; for (const u of users) c[u.role] = (c[u.role] || 0) + 1; return c;
  }, [users]);

  const filtered = useMemo(() => {
    const n = filter.trim().toLowerCase();
    if (!n) return users;
    return users.filter((u) => u.email.includes(n) || (u.name || '').toLowerCase().includes(n) || u.role.includes(n));
  }, [users, filter]);

  // ── user actions ──
  const changeRole = async (email, role) => {
    setSavingEmail(email); setError(null);
    try {
      const saved = await adminSaveUser({ email, role });
      setUsers((list) => list.map((u) => (u.email === email ? { ...u, role: saved.role } : u)));
    } catch (e) { setError(e.message); }
    finally { setSavingEmail(null); }
  };
  const addUser = async (e) => {
    e.preventDefault(); setAdding(true); setError(null);
    try {
      const saved = await adminSaveUser(form);
      setUsers((list) => [{ email: saved.email, name: saved.name, role: saved.role }, ...list.filter((u) => u.email !== saved.email)]);
      setForm((f) => ({ ...f, email: '', name: '' }));
    } catch (e) { setError(e.message); }
    finally { setAdding(false); }
  };
  const removeUser = async (email) => {
    if (!window.confirm(`Remove access for ${email}?`)) return;
    setError(null);
    try { await adminDeleteUser(email); setUsers((list) => list.filter((u) => u.email !== email)); }
    catch (e) { setError(e.message); }
  };

  // ── role / permission actions ──
  const toggleRoute = async (role, path) => {
    if (role.allowAll) return;
    const has = role.routes.includes(path);
    const nextRoutes = has ? role.routes.filter((p) => p !== path) : [...role.routes, path];
    setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, routes: nextRoutes } : r))); // optimistic
    setError(null);
    try { await adminSaveRole({ id: role.id, routes: nextRoutes }); }
    catch (e) { setError(e.message); reloadRoles(); }
  };
  const createRole = async (e) => {
    e.preventDefault();
    const label = newRole.trim(); if (!label) return;
    setCreating(true); setError(null);
    try { await adminSaveRole({ id: label, label, routes: [] }); setNewRole(''); await reloadRoles(); }
    catch (e) { setError(e.message); }
    finally { setCreating(false); }
  };
  const removeRole = async (role) => {
    if (role.system) return;
    if (!window.confirm(`Delete role "${role.label}"? Users on it drop to the default role on next sign-in.`)) return;
    setError(null);
    try { await adminDeleteRole(role.id); await reloadRoles(); await load(); }
    catch (e) { setError(e.message); }
  };

  const groupedRoutes = useMemo(() => {
    const g = {}; for (const r of PERMISSIONABLE_ROUTES) (g[r.group] ||= []).push(r); return g;
  }, []);

  return (
    <>
      <Topbar title="User Management" subtitle={`${users.length} user${users.length === 1 ? '' : 's'} · ${roles.length} roles`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* Control bar */}
        <div className="flex flex-wrap items-center gap-2">
          {roles.map((r, i) => (
            <span key={r.id} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold', TONE_CLASS[toneFor(r.id, i)])}>
              {r.allowAll && <ShieldCheck size={12} />}{r.label}
              <span className="rounded bg-black/10 px-1 tabular-nums dark:bg-white/10">{roleCounts[r.id] || 0}</span>
            </span>
          ))}
          <Button variant={showRoles ? 'primary' : 'outline'} size="sm" className="ml-auto" onClick={() => setShowRoles((s) => !s)}>
            <SlidersHorizontal size={14} /> Roles &amp; Permissions
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>
        )}

        {/* ── Roles & Permissions panel (the control) ── */}
        {showRoles && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-primary" /> Roles &amp; Permissions</CardTitle>
                <CardDescription>Tick a page to grant it to a role. Create new roles below. Admin has full access; Quick Access is always on; User Management is admin-only.</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowRoles(false)}><X size={16} /></Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* create role */}
              <form onSubmit={createRole} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">New role name</span>
                  <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. Floor Manager" className="w-56" />
                </label>
                <Button type="submit" disabled={creating || !newRole.trim()}>
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create role
                </Button>
              </form>

              {/* permission matrix */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border">
                      <th className="sticky left-0 z-[1] bg-muted/40 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Page</th>
                      {roles.map((r, i) => (
                        <th key={r.id} className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider">
                          <div className="flex flex-col items-center gap-1">
                            <span className={cn('rounded px-1.5 py-0.5', TONE_CLASS[toneFor(r.id, i)])}>{r.label}</span>
                            {r.system ? (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-fg"><Lock size={9} /> system</span>
                            ) : (
                              <button type="button" onClick={() => removeRole(r)} className="text-[9px] text-rose-500 hover:underline">delete</button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(groupedRoutes).map(([group, rts]) => (
                      <RouteGroup key={group} group={group} routes={rts} roles={roles} onToggle={toggleRoute} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-fg">Changes save instantly and take effect on each user's next page load — no re-login needed.</p>
            </CardContent>
          </Card>
        )}

        {/* ── Add user ── */}
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
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <Button type="submit" disabled={adding || !form.role}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add / Update
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Users table ── */}
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
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-fg"><Loader2 size={18} className="mx-auto animate-spin" /></td></tr>
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
                            <select value={u.role} disabled={savingEmail === u.email}
                              onChange={(e) => changeRole(u.email, e.target.value)}
                              className="h-8 rounded-md border border-border bg-card px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/30">
                              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                              {!roles.some((r) => r.id === u.role) && <option value={u.role}>{u.role} (removed)</option>}
                            </select>
                            {savingEmail === u.email && <Loader2 size={13} className="animate-spin text-muted-fg" />}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button type="button" onClick={() => removeUser(u.email)} disabled={isMe}
                            title={isMe ? "You can't remove your own access" : 'Remove access'}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300">
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
          <ShieldCheck size={12} /> New users are added automatically as <strong className="mx-1 text-fg">salesperson</strong> on first sign-in. Role and permission changes apply on the user's next page load.
        </p>
      </div>
    </>
  );
}

// A group of routes (Home / Reports / Forms) as rows in the permission matrix.
function RouteGroup({ group, routes, roles, onToggle }) {
  return (
    <>
      <tr className="bg-muted/20">
        <td colSpan={roles.length + 1} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg">{group}</td>
      </tr>
      {routes.map((rt) => (
        <tr key={rt.path} className="border-b border-border last:border-0 hover:bg-muted/20">
          <td className="sticky left-0 z-[1] bg-card px-3 py-2 font-medium">{rt.label}</td>
          {roles.map((role) => {
            const checked = role.allowAll || role.routes.includes(rt.path);
            return (
              <td key={role.id} className="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={role.allowAll}
                  onChange={() => onToggle(role, rt.path)}
                  title={role.allowAll ? 'Admin has full access' : `${checked ? 'Remove' : 'Grant'} ${rt.label} for ${role.label}`}
                  className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
