'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Loader2, Check, X, Trash2, UserPlus, ChevronLeft, AlertTriangle, KeyRound,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  DASHBOARDS, FEATURES, OVERVIEW_WIDGETS, ROLE_PRESETS, ROLE_LABELS, presetFor,
  type AccessRole,
} from '../../lib/access-registry';

// Only these roles are pickable in the editor (owner is reserved).
const PICKABLE_ROLES: AccessRole[] = ['admin', 'field_sup', 'field', 'custom'];

interface AdminUser {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  role: AccessRole;
  jtMembershipId: string | null;
  email: string | null;
  enabled: boolean;
  dashboards: string[];
  features: string[];
  overviewWidgets: string[];
  hasPin?: boolean;
}

type EditState = {
  isNew: boolean;
  id: string;
  name: string;
  title: string;
  role: AccessRole;
  jtMembershipId: string;
  email: string;
  enabled: boolean;
  dashboards: Set<string>;
  features: Set<string>;
  overviewWidgets: Set<string>;
};

const GOLD = '#c88c00';
const BORDER = '1px solid #e8e5e0';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('bkb-token') || '';
}

const ASSIGNABLE_DASHBOARDS = DASHBOARDS.filter((d) => !d.ownerOnly);

export default function AdminPage() {
  const auth = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.status === 403) { setError('You must be an owner to manage users.'); setUsers([]); return; }
      if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (auth.role !== 'owner') { setLoading(false); setError('You must be an owner to manage users.'); return; }
    load();
  }, [auth.loading, auth.role, load]);

  function startNew() {
    setSaveMsg('');
    setEdit({
      isNew: true, id: '', name: '', title: '', role: 'custom',
      jtMembershipId: '', email: '', enabled: true,
      dashboards: new Set(), features: new Set(), overviewWidgets: new Set(),
    });
  }

  function startEdit(u: AdminUser) {
    setSaveMsg('');
    setEdit({
      isNew: false, id: u.id, name: u.name, title: u.title || '', role: u.role,
      jtMembershipId: u.jtMembershipId || '', email: u.email || '', enabled: u.enabled,
      dashboards: new Set(u.dashboards), features: new Set(u.features), overviewWidgets: new Set(u.overviewWidgets),
    });
  }

  function applyPreset(role: AccessRole) {
    if (!edit) return;
    const p = presetFor(role);
    setEdit({
      ...edit,
      dashboards: new Set(p.dashboards.filter((d) => ASSIGNABLE_DASHBOARDS.some((x) => x.id === d))),
      features: new Set(p.features),
      overviewWidgets: new Set(p.overviewWidgets),
    });
  }

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  async function save() {
    if (!edit) return;
    if (!edit.name.trim()) { setSaveMsg('Name is required'); return; }
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        id: edit.id || undefined,
        name: edit.name.trim(),
        title: edit.title.trim() || null,
        role: edit.role,
        jtMembershipId: edit.jtMembershipId.trim() || null,
        email: edit.email.trim() || null,
        enabled: edit.enabled,
        dashboards: Array.from(edit.dashboards),
        features: Array.from(edit.features),
        overviewWidgets: Array.from(edit.overviewWidgets),
      };
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      await load();
      setEdit(null);
    } catch (e: any) {
      setSaveMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`Remove ${u.name}? This deletes their access and login PIN. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(u.id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      await load();
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    }
  }

  if (loading) {
    return <div className="flex items-center gap-3 py-16 justify-center" style={{ color: '#8a8078' }}><Loader2 className="animate-spin" size={20} /> Loading…</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle size={28} style={{ color: '#ef4444' }} className="mb-2" />
        <p style={{ color: '#ef4444' }}>{error}</p>
      </div>
    );
  }

  // ---- Editor view ----
  if (edit) {
    return (
      <div className="space-y-5 max-w-3xl">
        <button onClick={() => setEdit(null)} className="flex items-center gap-1 text-sm" style={{ color: GOLD, background: 'none', border: 'none', cursor: 'pointer' }}>
          <ChevronLeft size={16} /> Back to users
        </button>
        <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>
          {edit.isNew ? 'Add New User' : `Edit ${edit.name}`}
        </h1>

        {/* Identity */}
        <div className="rounded-lg p-4 space-y-3" style={{ background: '#fff', border: BORDER }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name *">
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inputStyle} placeholder="Jane Smith" />
            </Field>
            <Field label="Job title (shown on login)">
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={inputStyle} placeholder="Project Coordinator" />
            </Field>
            <Field label={edit.isNew ? 'Login ID (optional — auto-generated from name)' : 'Login ID (locked)'}>
              <input
                value={edit.id}
                onChange={(e) => setEdit({ ...edit, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                disabled={!edit.isNew}
                style={{ ...inputStyle, opacity: edit.isNew ? 1 : 0.5 }}
                placeholder="jane"
              />
            </Field>
            <Field label="Role">
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as AccessRole })} style={inputStyle}>
                {PICKABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="JobTread membership ID (for task assignment)">
              <input value={edit.jtMembershipId} onChange={(e) => setEdit({ ...edit, jtMembershipId: e.target.value })} style={inputStyle} placeholder="22P5..." />
            </Field>
            <Field label="Email (optional)">
              <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} style={inputStyle} placeholder="jane@brettkingbuilder.com" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#5a5550' }}>
            <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />
            Account enabled (can log in)
          </label>
        </div>

        {/* Preset helper */}
        <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: '#5a5550' }}>
          <span>Quick-fill from a template:</span>
          {PICKABLE_ROLES.map((r) => (
            <button key={r} onClick={() => applyPreset(r)} className="px-2.5 py-1 rounded-md" style={{ border: `1px solid ${GOLD}33`, color: GOLD, background: `${GOLD}0d`, cursor: 'pointer' }}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>

        {/* Dashboards */}
        <ToggleSection
          title="Dashboards"
          subtitle="Top-level pages this user can open"
          items={ASSIGNABLE_DASHBOARDS.map((d) => ({ id: d.id, label: d.label, description: d.description }))}
          selected={edit.dashboards}
          onToggle={(id) => setEdit({ ...edit, dashboards: toggle(edit.dashboards, id) })}
        />

        {/* Overview widgets */}
        <ToggleSection
          title="Overview widgets"
          subtitle="Sections shown on the Overview page (only matters if Overview is enabled above)"
          items={OVERVIEW_WIDGETS.map((w) => ({ id: w.id, label: w.label, description: w.description }))}
          selected={edit.overviewWidgets}
          onToggle={(id) => setEdit({ ...edit, overviewWidgets: toggle(edit.overviewWidgets, id) })}
        />

        {/* Features */}
        <ToggleSection
          title="Features"
          subtitle="Cross-cutting capabilities"
          items={FEATURES.map((f) => ({ id: f.id, label: f.label, description: f.description }))}
          selected={edit.features}
          onToggle={(id) => setEdit({ ...edit, features: toggle(edit.features, id) })}
        />

        {/* Save bar */}
        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold disabled:opacity-50" style={{ background: GOLD, color: '#fff', border: 'none', cursor: 'pointer' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {edit.isNew ? 'Create User' : 'Save Changes'}
          </button>
          <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-lg text-sm" style={{ border: BORDER, color: '#5a5550', background: '#fff', cursor: 'pointer' }}>
            Cancel
          </button>
          {saveMsg && <span className="text-sm" style={{ color: '#ef4444' }}>{saveMsg}</span>}
        </div>

        {edit.isNew && (
          <p className="text-xs flex items-start gap-1.5" style={{ color: '#8a8078' }}>
            <KeyRound size={13} style={{ marginTop: 1, flexShrink: 0 }} />
            After you create the user, they set their own PIN on first login: they pick their name on the login screen and choose a PIN.
          </p>
        )}
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} style={{ color: GOLD }} />
          <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>User Administration</h1>
        </div>
        <button onClick={startNew} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: GOLD, color: '#fff', border: 'none', cursor: 'pointer' }}>
          <Plus size={16} /> Add User
        </button>
      </div>
      <p className="text-sm" style={{ color: '#8a8078' }}>
        Control which dashboards, widgets, and features each team member can see. Changes take effect the next time they load the app.
      </p>

      <div className="rounded-lg overflow-hidden" style={{ border: BORDER, background: '#fff' }}>
        {users.map((u, i) => (
          <button
            key={u.id}
            onClick={() => startEdit(u)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            style={{ borderTop: i === 0 ? 'none' : BORDER, background: 'transparent', cursor: 'pointer' }}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: u.enabled ? GOLD : '#bbb', color: '#fff' }}>
              {u.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium" style={{ color: '#1a1a1a' }}>{u.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#f0ede8', color: '#6a6058' }}>{ROLE_LABELS[u.role]}</span>
                {!u.enabled && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#fde8e8', color: '#b91c1c' }}>disabled</span>}
                {!u.hasPin && u.enabled && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92660a' }}>no PIN yet</span>}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
                {u.role === 'owner' ? 'Full access (owner)' : `${u.dashboards.length} dashboards · ${u.overviewWidgets.length} widgets · ${u.features.length} features`}
              </div>
            </div>
            {u.role !== 'owner' && auth.userId !== u.id && (
              <span
                onClick={(e) => { e.stopPropagation(); remove(u); }}
                className="p-2 rounded-md hover:bg-red-50 flex-shrink-0"
                style={{ color: '#b91c1c' }}
                title="Remove user"
              >
                <Trash2 size={15} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: '#6a6058' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, borderRadius: 6,
  background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a', outline: 'none',
};

function ToggleSection({
  title, subtitle, items, selected, onToggle,
}: {
  title: string;
  subtitle: string;
  items: Array<{ id: string; label: string; description?: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-lg p-4" style={{ background: '#fff', border: BORDER }}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{title}</h3>
        <p className="text-xs" style={{ color: '#8a8078' }}>{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((it) => {
          const on = selected.has(it.id);
          return (
            <button
              key={it.id}
              onClick={() => onToggle(it.id)}
              className="flex items-start gap-2 p-2.5 rounded-md text-left transition-colors"
              style={{ border: on ? `1px solid ${GOLD}` : '1px solid #e8e5e0', background: on ? `${GOLD}0d` : '#fff', cursor: 'pointer' }}
            >
              <span
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: on ? GOLD : '#fff', border: on ? 'none' : '1px solid #cfc8c0' }}
              >
                {on && <Check size={11} style={{ color: '#fff' }} />}
              </span>
              <span className="min-w-0">
                <span className="text-sm block" style={{ color: '#1a1a1a' }}>{it.label}</span>
                {it.description && <span className="text-xs block" style={{ color: '#8a8078' }}>{it.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
