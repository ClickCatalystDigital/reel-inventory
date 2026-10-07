"use client";

import { useEffect, useState } from "react";
import { Database, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate } from "@/lib/format";
import { useSelectedStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { StorageCard } from "@/components/settings/StorageCard";
import { AssistantCard } from "@/components/settings/AssistantCard";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SettingsNav, type SettingsTab } from "@/components/settings/SettingsNav";
import { ChipMark } from "@/components/assistant/ChipMark";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchPicker } from "@/components/SearchPicker";
import { parseIds, type Company } from "@/lib/catalog";

// Mirrors routes/settings.js's validRoles allowlist.
const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "client", label: "Client" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "gelco_manager", label: "Gelco Manager" },
  { value: "gelco_worker", label: "Gelco Worker" },
];

const TAB_STORAGE: SettingsTab = { key: "storage", label: "Storage", caption: "Database & files", icon: Database };
const TAB_AI: SettingsTab = { key: "ai", label: "AI", caption: "LS AI assistant", icon: ChipMark as unknown as SettingsTab["icon"] };
const TAB_HUMANS: SettingsTab = { key: "humans", label: "Humans", caption: "Users & access", icon: Users };

interface AppUser {
  id: number;
  username: string;
  role: string;
  created_at: string;
  company_ids: string | null;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [adding, setAdding] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);

  // Sections: Storage | AI (admin only — the server enforces it too) | Humans. The active one lives in the URL hash so a refresh keeps it.
  const tabs = user?.role === "admin" ? [TAB_STORAGE, TAB_AI, TAB_HUMANS] : [TAB_STORAGE, TAB_HUMANS];
  const [tab, setTab] = useState("storage");
  const active = tabs.some((t) => t.key === tab) ? tab : "storage";
  useEffect(() => {
    const h = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the hash is only possible after mount (static export)
    if (h) setTab(h);
  }, []);
  function selectTab(k: string) {
    setTab(k);
    window.history.replaceState(null, "", `#${k}`);
  }

  const lsUsers = users?.filter((u) => ["user", "manager", "admin"].includes(u.role)) ?? [];
  const clientUsers = users?.filter((u) => u.role === "client") ?? [];
  const gelcoUsers = users?.filter((u) => ["gelco_manager", "gelco_worker"].includes(u.role)) ?? [];
  const showLS = selectedStore === "all" || selectedStore === "primary";
  const showGelco = selectedStore === "all" || selectedStore === "secondary";

  async function loadUsers() {
    try {
      const list = await api<AppUser[]>("/api/settings/users");
      setUsers(list);
    } catch {
      // api() already toasted
    }
  }

  useEffect(() => {
    // Data fetch on mount — a legitimate effect use, not state derived from a prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    api<Company[]>("/api/po/companies").then(setCompanies).catch(() => {});
  }, []);

  async function addUser() {
    const username = newUsername.trim();
    if (!username || !newPassword) return showToast("Username and password required", "error");
    setAdding(true);
    try {
      await api("/api/settings/users", { method: "POST", body: { username, password: newPassword, role: newRole } });
      showToast(`User "${username}" added`);
      setNewUsername("");
      setNewPassword("");
      loadUsers();
    } catch {
      // api() already toasted
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Storage, the LS AI assistant, and the people who use the app</p>
      </div>

      <Tabs value={active} onValueChange={selectTab} orientation="vertical" className="flex-col gap-4 md:flex-row md:items-start">
        <SettingsNav tabs={tabs} />

        <div className="min-w-0 flex-1">
          <TabsContent value="storage" className="space-y-4 outline-none">
            <StorageCard />
          </TabsContent>

          {user?.role === "admin" && (
            <TabsContent value="ai" className="space-y-4 outline-none">
              <AssistantCard />
            </TabsContent>
          )}

          <TabsContent value="humans" className="space-y-4 outline-none">
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-40 flex-1" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                  <Input type="password" className="min-w-40 flex-1" placeholder="Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={addUser} disabled={adding}>
                    <UserPlus /> Add User
                  </Button>
                </div>
              </Card>

              {users === null ? (
                <Card className="p-5 text-center text-muted-foreground">Loading users...</Card>
              ) : (
                <>
                  {showLS && <UsersCard title="LS Users" users={lsUsers} onSaved={loadUsers} onDeleted={loadUsers} />}
                  {showLS && <UsersCard title="Clients" users={clientUsers} companies={companies} onSaved={loadUsers} onDeleted={loadUsers} />}
                  {showGelco && <UsersCard title="Gelco Users" users={gelcoUsers} companies={companies} onSaved={loadUsers} onDeleted={loadUsers} />}
                </>
              )}
            </>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function UsersCard({
  title,
  users,
  companies,
  onSaved,
  onDeleted,
}: {
  title: string;
  users: AppUser[];
  // Set for outside logins (clients, Gelco): which CRM companies they belong to decides which catalog items they see.
  companies?: Company[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              {companies && <TableHead>Company</TableHead>}
              <TableHead>Created</TableHead>
              <TableHead>New Password</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={companies ? 6 : 5} className="text-center text-muted-foreground">
                  No users in this section
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => <UserRow key={u.id} user={u} companies={companies} onSaved={onSaved} onDeleted={onDeleted} />)
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function UserRow({
  user,
  companies,
  onSaved,
  onDeleted,
}: {
  user: AppUser;
  companies?: Company[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [role, setRole] = useState(user.role);
  const [companyIds, setCompanyIds] = useState(parseIds(user.company_ids));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/settings/users/${user.id}`, { method: "PUT", body: { role, password: password || undefined, ...(companies && { company_ids: companyIds }) } });
      showToast(`User "${user.username}" updated`);
      setPassword("");
      onSaved();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/settings/users/${user.id}`, { method: "DELETE" });
      showToast(`User "${user.username}" deleted`);
      onDeleted();
    } catch {
      // api() already toasted
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <strong>{user.username}</strong>
      </TableCell>
      <TableCell>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      {companies && (
        <TableCell>
          <SearchPicker
            multiple
            className="h-8 w-44"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            value={companyIds}
            onChange={setCompanyIds}
            placeholder="Not linked"
            searchPlaceholder="Search companies"
          />
        </TableCell>
      )}
      <TableCell>{formatDate(user.created_at)}</TableCell>
      <TableCell>
        <Input
          type="password"
          className="h-8 w-40 text-xs"
          placeholder="Leave blank to keep"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
