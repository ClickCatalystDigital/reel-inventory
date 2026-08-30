"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate } from "@/lib/format";
import { useSelectedStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Mirrors routes/settings.js's validRoles allowlist.
const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "client", label: "Client" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "gelco_manager", label: "Gelco Manager" },
  { value: "gelco_worker", label: "Gelco Worker" },
];

interface AppUser {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  const { selectedStore } = useSelectedStore();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [adding, setAdding] = useState(false);

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
        <p className="text-sm text-muted-foreground">Manage users and access levels</p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <Input
            type="password"
            className="min-w-40 flex-1"
            placeholder="Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
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
          {showLS && <UsersCard title="Clients" users={clientUsers} onSaved={loadUsers} onDeleted={loadUsers} />}
          {showGelco && <UsersCard title="Gelco Users" users={gelcoUsers} onSaved={loadUsers} onDeleted={loadUsers} />}
        </>
      )}
    </div>
  );
}

function UsersCard({
  title,
  users,
  onSaved,
  onDeleted,
}: {
  title: string;
  users: AppUser[];
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
              <TableHead>Created</TableHead>
              <TableHead>New Password</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No users in this section
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => <UserRow key={u.id} user={u} onSaved={onSaved} onDeleted={onDeleted} />)
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function UserRow({ user, onSaved, onDeleted }: { user: AppUser; onSaved: () => void; onDeleted: () => void }) {
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/settings/users/${user.id}`, { method: "PUT", body: { role, password: password || undefined } });
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
