import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  ChevronDown,
  Users,
} from "lucide-react";

const COUNTRY_CODES = [
  { code: "+212", flag: "🇲🇦", label: "Maroc", placeholder: "6XX XXX XXX" },
  { code: "+33", flag: "🇫🇷", label: "France", placeholder: "6 XX XX XX XX" },
];

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
  const [invitePhoneLocal, setInvitePhoneLocal] = useState("");
  const [inviteCountryIndex, setInviteCountryIndex] = useState(0);
  const [inviteCountryOpen, setInviteCountryOpen] = useState(false);
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

  const fetchConversationCounts = useCallback(async () => {
    const userIds = users
      .filter((u) => u.auth_user_id)
      .map((u) => u.auth_user_id!);
    
    if (userIds.length === 0) return;

    const { data, error } = await supabase.rpc("count_conversations_by_users", {
      user_ids: userIds,
    });

    if (error) {
      console.error("Error fetching conversation counts:", error);
      return;
    }

    const counts: Record<string, number> = {};
    if (data) {
      for (const row of data) {
        counts[row.user_id] = Number(row.conversation_count);
      }
    }
    setConversations(counts);
  }, [users]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (users.length > 0) {
      fetchConversationCounts();
    }
  }, [users, fetchConversationCounts]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitePhoneLocal.trim()) return;
    setIsInviting(true);

    const inviteCountry = COUNTRY_CODES[inviteCountryIndex];
    const fullInvitePhone = `${inviteCountry.code}${invitePhoneLocal.replace(/\s/g, "")}`;

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
            phone: fullInvitePhone,
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
          description: `SMS d'invitation envoyé au ${inviteCountry.code} ${invitePhoneLocal}`,
        });
        setInvitePhoneLocal("");
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
  const maxInvites = phoneUser?.max_invites ?? 2;
  const agentCount = agents.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-5 md:py-8 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">Utilisateurs</h1>
            <p className="text-sm text-muted-foreground">Gérez les agents ayant accès au chat.</p>
          </div>
        </div>

        {/* Invite Form — compact */}
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserPlus className="h-4 w-4 text-primary" />
            Inviter un agent
          </div>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invite-phone" className="text-sm">Téléphone</Label>
                <div className="flex gap-1.5">
                  <div className="relative">
                    <button
                      type="button"
                      className="flex items-center gap-1 h-10 px-2.5 rounded-lg border border-input bg-background text-sm hover:bg-accent/50 transition-colors whitespace-nowrap"
                      onClick={() => setInviteCountryOpen(!inviteCountryOpen)}
                    >
                      <span className="text-sm leading-none">{COUNTRY_CODES[inviteCountryIndex].flag}</span>
                      <span className="font-medium text-foreground">{COUNTRY_CODES[inviteCountryIndex].code}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {inviteCountryOpen && (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg overflow-hidden min-w-[160px]">
                        {COUNTRY_CODES.map((c, i) => (
                          <button
                            key={c.code}
                            type="button"
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-accent/50 transition-colors",
                              i === inviteCountryIndex ? "bg-primary/5 text-primary font-medium" : "text-foreground"
                            )}
                            onClick={() => {
                              setInviteCountryIndex(i);
                              setInviteCountryOpen(false);
                            }}
                          >
                            <span className="text-sm leading-none">{c.flag}</span>
                            <span>{c.label}</span>
                            <span className="ml-auto text-muted-foreground">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative flex-1">
                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      id="invite-phone"
                      type="tel"
                      value={invitePhoneLocal}
                      onChange={(e) => setInvitePhoneLocal(e.target.value)}
                      placeholder={COUNTRY_CODES[inviteCountryIndex].placeholder}
                      className="pl-8 h-10 rounded-lg text-sm"
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-name" className="text-sm">Nom (optionnel)</Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="invite-name"
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Nom de l'agent"
                    className="pl-8 h-10 rounded-lg text-sm"
                    maxLength={100}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {agentCount}/{maxInvites} agents
              </p>
              <Button
                type="submit"
                size="sm"
                className="cta-gradient rounded-lg h-9 text-sm px-4"
                disabled={isInviting || !invitePhoneLocal.trim() || agentCount >= maxInvites}
              >
                {isInviting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                )}
                {isInviting ? "Envoi..." : "Inviter"}
              </Button>
            </div>
          </form>
        </div>

        {/* Users List — compact rows */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <span className="text-sm font-semibold">Équipe</span>
            <span className="text-sm text-muted-foreground">{users.length} membre{users.length > 1 ? "s" : ""}</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">
              Aucun utilisateur
            </p>
          ) : (
            <div className="divide-y divide-border/40">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0",
                        user.role === "manager"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary/10 text-secondary"
                      )}
                    >
                      {user.role === "manager" ? (
                        <Shield className="h-3.5 w-3.5" />
                      ) : (
                        <User className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">
                        {user.display_name || user.phone}
                        {user.id === phoneUser?.id && (
                          <span className="text-muted-foreground text-xs ml-1.5">(vous)</span>
                        )}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{user.phone}</span>
                        {user.auth_user_id && conversations[user.auth_user_id] && (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {conversations[user.auth_user_id]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Badge
                      variant={user.role === "manager" ? "default" : "secondary"}
                      className="capitalize text-xs h-5 px-1.5"
                    >
                      {user.role}
                    </Badge>
                    {user.id !== phoneUser?.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleUserActive(user)}
                          title={user.is_active ? "Désactiver" : "Réactiver"}
                        >
                          {user.is_active ? (
                            <ToggleRight className="h-4 w-4 text-secondary" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:text-destructive"
                          onClick={() => deleteUser(user)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
