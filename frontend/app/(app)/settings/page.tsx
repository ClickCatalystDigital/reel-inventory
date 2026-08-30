"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [adding, setAdding] = useState(false);

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
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add User</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input placeholder="e.g. ravi" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="Set a password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="user">User (staff)</option>
              <option value="client">Client (read-only)</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="gelco_manager">Gelco Manager</option>
              <option value="gelco_worker">Gelco Worker</option>
            </select>
          </div>
        </div>
        <Button className="mt-4" onClick={addUser} disabled={adding}>
          Add User
        </Button>
      </Card>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All Users</div>
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
              {users === null ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => <UserRow key={u.id} user={u} onSaved={loadUsers} onDeleted={loadUsers} />)
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
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
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
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
