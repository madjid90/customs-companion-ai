import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  Phone,
  Loader2,
  User,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  MessageSquare,
} from "lucide-react";

interface PhoneUserRow {
  id: string;
  phone: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  auth_user_id: string | null;
}

export default function ManagerUsers() {
  const { session, phoneUser } = usePhoneAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<PhoneUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [conversations, setConversations] = useState<Record<string, number>>({});

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("phone_users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching users:", error);
    } else {
      setUsers((data as PhoneUserRow[]) || []);
    }
    setIsLoading(false);
  }, []);

  // Fetch conversation counts per user
  const fetchConversationCounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("user_id");

    if (!error && data) {
      const counts: Record<string, number> = {};
      data.forEach((conv: { user_id: string | null }) => {
        if (conv.user_id) {
          counts[conv.user_id] = (counts[conv.user_id] || 0) + 1;
        }
      });
      setConversations(counts);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchConversationCounts();
  }, [fetchUsers, fetchConversationCounts]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitePhone.trim()) return;
    setIsInviting(true);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            phone: invitePhone.trim(),
            displayName: inviteName.trim(),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Erreur",
          description: data.error || "Impossible d'inviter l'agent",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Agent invité !",
          description: `SMS d'invitation envoyé au ${invitePhone}`,
        });
        setInvitePhone("");
        setInviteName("");
        fetchUsers();
      }
    } catch {
      toast({
        title: "Erreur",
        description: "Erreur de connexion",
        variant: "destructive",
      });
    }

    setIsInviting(false);
  };

  const toggleUserActive = async (user: PhoneUserRow) => {
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
        title: user.is_active ? "Accès désactivé" : "Accès réactivé",
      });
      fetchUsers();
    }
  };

  const deleteUser = async (user: PhoneUserRow) => {
    if (!confirm(`Supprimer l'accès de ${user.display_name || user.phone} ?`)) return;

    const { error } = await supabase
      .from("phone_users")
      .delete()
      .eq("id", user.id);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'utilisateur",
        variant: "destructive",
      });
    } else {
      toast({ title: "Utilisateur supprimé" });
      fetchUsers();
    }
  };

  const agents = users.filter(
    (u) => u.role === "agent" && u.id !== phoneUser?.id
  );
  const agentCount = agents.length;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="admin-page-header">
        <h1 className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          Gestion des utilisateurs
        </h1>
        <p>Invitez et gérez les agents qui ont accès au chat DouaneAI.</p>
      </div>

      {/* Invite Form */}
      <Card className="card-elevated mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />
            Inviter un agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invite-phone">Numéro de téléphone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invite-phone"
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    placeholder="+212 6XX XXX XXX"
                    className="pl-10 rounded-xl"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Nom (optionnel)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invite-name"
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Nom de l'agent"
                    className="pl-10 rounded-xl"
                    maxLength={100}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {agentCount}/2 agents invités
              </p>
              <Button
                type="submit"
                className="cta-gradient rounded-xl"
                disabled={isInviting || !invitePhone.trim() || agentCount >= 2}
              >
                {isInviting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Inviter par SMS
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="text-lg">
            Utilisateurs ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Aucun utilisateur pour le moment
            </p>
          ) : (
            <div className="space-y-3">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        user.role === "manager"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary/10 text-secondary"
                      }`}
                    >
                      {user.role === "manager" ? (
                        <Shield className="h-5 w-5" />
                      ) : (
                        <User className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {user.display_name || user.phone}
                        {user.id === phoneUser?.id && (
                          <span className="text-muted-foreground text-xs ml-2">
                            (vous)
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{user.phone}</span>
                        {user.auth_user_id && conversations[user.auth_user_id] && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {conversations[user.auth_user_id]} conv.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant={user.role === "manager" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {user.role}
                    </Badge>
                    {user.id !== phoneUser?.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleUserActive(user)}
                          title={
                            user.is_active
                              ? "Désactiver l'accès"
                              : "Réactiver l'accès"
                          }
                        >
                          {user.is_active ? (
                            <ToggleRight className="h-5 w-5 text-secondary" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:text-destructive"
                          onClick={() => deleteUser(user)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
