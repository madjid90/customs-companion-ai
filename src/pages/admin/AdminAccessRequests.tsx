import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Building2,
  Phone,
  Clock,
  Inbox,
} from "lucide-react";

interface AccessRequest {
  id: string;
  company_name: string;
  phone: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

export default function AdminAccessRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("access_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching requests:", error);
    } else {
      setRequests((data as AccessRequest[]) || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    setProcessingId(id);

    const { error } = await supabase
      .from("access_requests")
      .update({
        status,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de traiter la demande",
        variant: "destructive",
      });
    } else {
      toast({
        title: status === "approved" ? "Demande approuvée" : "Demande rejetée",
        description:
          status === "approved"
            ? "L'utilisateur pourra être invité comme manager."
            : "La demande a été rejetée.",
      });
      fetchRequests();
    }

    setProcessingId(null);
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const processedRequests = requests.filter((r) => r.status !== "pending");

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "En attente", variant: "secondary" },
    approved: { label: "Approuvée", variant: "default" },
    rejected: { label: "Rejetée", variant: "destructive" },
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-8">
      <div className="admin-page-header">
        <h1 className="flex items-center gap-3">
          <Inbox className="h-8 w-8 text-primary" />
          Demandes d'accès
        </h1>
        <p>Gérez les demandes d'accès des managers potentiels.</p>
      </div>

      {/* Pending Requests */}
      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-warning" />
            En attente ({pendingRequests.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Aucune demande en attente
            </p>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-5 w-5 text-warning" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {req.company_name}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {req.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(req.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
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

      {/* Processed Requests */}
      {processedRequests.length > 0 && (
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle className="text-lg">
              Historique ({processedRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {processedRequests.map((req) => {
                const cfg = statusConfig[req.status] || statusConfig.pending;
                return (
                  <div
                    key={req.id}
                    className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/50"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {req.company_name}
                        </p>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>{req.phone}</span>
                          <span>{formatDate(req.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
