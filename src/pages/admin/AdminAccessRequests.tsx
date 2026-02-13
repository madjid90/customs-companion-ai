import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Building2,
  Mail,
  Clock,
  Users,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

interface AccessRequest {
  id: string;
  company_name: string;
  email: string | null;
  status: string;
  created_at: string;
}

interface PhoneUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  is_active: boolean | null;
  created_at: string | null;
}

export default function AdminAccessRequests() {
  const { toast } = useToast();

  // Pending requests
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Users
  const [users, setUsers] = useState<PhoneUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);

  // Edit dialog
  const [editUser, setEditUser] = useState<PhoneUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog
  const [deleteUser, setDeleteUser] = useState<PhoneUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    const { data, error } = await supabase
      .from("access_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching requests:", error);
    } else {
      setRequests((data as AccessRequest[]) || []);
    }
    setIsLoadingRequests(false);
  }, []);

  const fetchUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    const { data, error } = await supabase
      .from("phone_users")
      .select("id, email, display_name, role, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching users:", error);
    } else {
      setUsers((data as PhoneUser[]) || []);
    }
    setIsLoadingUsers(false);
  }, []);

  useEffect(() => {
    fetchRequests();
    fetchUsers();
  }, [fetchRequests, fetchUsers]);

  // Approve / Reject
  const handleAction = async (id: string, action: "approved" | "rejected") => {
    setProcessingId(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-access`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ requestId: id, action }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Erreur",
          description: data.error || "Impossible de traiter la demande",
          variant: "destructive",
        });
      } else {
        toast({
          title: action === "approved" ? "Demande approuvée ✓" : "Demande rejetée",
          description:
            action === "approved"
              ? "L'utilisateur a été créé avec succès."
              : "La demande a été rejetée.",
        });
        fetchRequests();
        if (action === "approved") fetchUsers();
      }
    } catch {
      toast({
        title: "Erreur",
        description: "Erreur de connexion au serveur",
        variant: "destructive",
      });
    }
    setProcessingId(null);
  };

  // Edit user
  const openEdit = (user: PhoneUser) => {
    setEditUser(user);
    setEditName(user.display_name || "");
    setEditEmail(user.email || "");
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setIsSaving(true);

    const { error } = await supabase
      .from("phone_users")
      .update({
        display_name: editName.trim() || null,
        email: editEmail.trim().toLowerCase() || null,
      })
      .eq("id", editUser.id);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de modifier l'utilisateur",
        variant: "destructive",
      });
    } else {
      toast({ title: "Utilisateur modifié ✓" });
      setEditUser(null);
      fetchUsers();
    }
    setIsSaving(false);
  };

  // Delete user
  const handleDelete = async () => {
    if (!deleteUser) return;
    setIsDeleting(true);

    const { error } = await supabase
      .from("phone_users")
      .delete()
      .eq("id", deleteUser.id);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'utilisateur",
        variant: "destructive",
      });
    } else {
      toast({ title: "Utilisateur supprimé ✓" });
      setDeleteUser(null);
      fetchUsers();
    }
    setIsDeleting(false);
  };

  // Toggle active
  const toggleActive = async (user: PhoneUser) => {
    const { error } = await supabase
      .from("phone_users")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut",
        variant: "destructive",
      });
    } else {
      toast({
        title: user.is_active ? "Utilisateur désactivé" : "Utilisateur activé ✓",
      });
      fetchUsers();
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      <div className="admin-page-header">
        <h1 className="flex items-center gap-3">
          <Users className="h-8 w-8 text-primary" />
          Gestion des utilisateurs
        </h1>
        <p>Validez les demandes d'accès et gérez les profils utilisateurs.</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            En attente ({requests.length})
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            Utilisateurs ({users.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Pending Requests ── */}
        <TabsContent value="pending" className="mt-6">
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-warning" />
                Demandes en attente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingRequests ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : requests.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Aucune demande en attente
                </p>
              ) : (
                <div className="space-y-3">
                  {requests.map((req) => (
                    <div
                      key={req.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border/50 bg-card hover:bg-accent/5 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="h-5 w-5 text-warning" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{req.company_name}</p>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            {req.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {req.email}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(req.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 ml-14 sm:ml-0">
                        <Button
                          size="sm"
                          className="rounded-lg gap-1.5"
                          disabled={processingId === req.id}
                          onClick={() => handleAction(req.id, "approved")}
                        >
                          {processingId === req.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Approuver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg gap-1.5"
                          disabled={processingId === req.id}
                          onClick={() => handleAction(req.id, "rejected")}
                        >
                          <XCircle className="h-4 w-4" />
                          Rejeter
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Users Management ── */}
        <TabsContent value="users" className="mt-6">
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-primary" />
                Tous les utilisateurs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : users.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Aucun utilisateur
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Rôle</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Créé le</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            {user.display_name || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.email || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {user.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {user.is_active ? (
                              <Badge variant="default" className="gap-1">
                                <UserCheck className="h-3 w-3" />
                                Actif
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <UserX className="h-3 w-3" />
                                Inactif
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(user.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => toggleActive(user)}
                                title={user.is_active ? "Désactiver" : "Activer"}
                              >
                                {user.is_active ? (
                                  <UserX className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <UserCheck className="h-4 w-4 text-primary" />
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => openEdit(user)}
                                title="Modifier"
                              >
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg hover:bg-destructive/10"
                                onClick={() => setDeleteUser(user)}
                                title="Supprimer"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
            <DialogDescription>
              Modifiez les informations de l'utilisateur ci-dessous.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nom / Société</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nom ou société"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="email@example.com"
                className="rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSaving} className="rounded-xl gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer l'utilisateur{" "}
              <strong>{deleteUser?.display_name || deleteUser?.email}</strong> ?
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)} className="rounded-xl">
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-xl gap-2"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
