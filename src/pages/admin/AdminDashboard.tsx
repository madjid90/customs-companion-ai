import { useState, useEffect } from "react";
import { Package, DollarSign, FileText, MessageSquare, AlertTriangle, Clock, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { statsService } from "@/lib/supabase-services";

interface DashboardStats {
  hs_codes: number;
  tariffs: number;
  documents: number;
  conversations: number;
}

interface Alert {
  id: string;
  severity: string;
  title: string;
  created_at: string;
}

interface VeilleDoc {
  id: string;
  title: string;
  category: string;
  importance: string;
}

const severityColors: Record<string, string> = {
  error: "bg-destructive text-destructive-foreground",
  high: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  medium: "bg-warning text-warning-foreground",
  info: "bg-primary text-primary-foreground",
  low: "bg-muted text-muted-foreground",
};

const importanceColors: Record<string, string> = {
  haute: "bg-destructive/10 text-destructive",
  moyenne: "bg-warning/10 text-warning",
  basse: "bg-success/10 text-success",
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<{ date: string; conversations: number }[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pendingVeille, setPendingVeille] = useState<VeilleDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        // Load all dashboard data in parallel
        const [statsData, chartDataResult, alertsResult, veilleResult] = await Promise.all([
          statsService.getDashboardStats(),
          statsService.getConversationsPerDay(7),
          statsService.getRecentAlerts(5),
          statsService.getPendingVeille(5),
        ]);

        setStats(statsData);
        setChartData(chartDataResult);
        if (alertsResult.data) setAlerts(alertsResult.data as Alert[]);
        if (veilleResult.data) setPendingVeille(veilleResult.data as VeilleDoc[]);
      } catch (error) {
        console.error("Dashboard error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  const statCards = [
    { label: "Codes SH", value: stats?.hs_codes.toLocaleString() || "0", icon: Package, color: "text-primary" },
    { label: "Tarifs", value: stats?.tariffs.toLocaleString() || "0", icon: DollarSign, color: "text-accent" },
    { label: "Documents", value: stats?.documents.toLocaleString() || "0", icon: FileText, color: "text-success" },
    { label: "Conversations", value: stats?.conversations.toLocaleString() || "0", icon: MessageSquare, color: "text-warning" },
  ];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold text-foreground">Tableau de bord</h1>
        <p className="text-muted-foreground mt-1">
          Vue d'ensemble de votre système DouaneAI
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-slide-up">
        {statCards.map((stat, index) => (
          <Card key={stat.label} style={{ animationDelay: `${index * 0.1}s` }}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg bg-muted ${stat.color}`}>
                  <stat.icon className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
        <CardHeader>
          <CardTitle>Conversations par jour</CardTitle>
          <CardDescription>Activité des 7 derniers jours</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} 
                />
                <Line
                  type="monotone"
                  dataKey="conversations"
                  stroke="hsl(var(--accent))"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(var(--accent))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Two columns */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.3s" }}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Alertes récentes
              </CardTitle>
              <CardDescription>Notifications non lues</CardDescription>
            </div>
            <Button variant="ghost" size="sm">
              Voir tout
            </Button>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aucune alerte en attente
              </p>
            ) : (
              <div className="space-y-4">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                  >
                    <Badge className={severityColors[alert.severity] || severityColors.info}>
                      {alert.severity === "error" || alert.severity === "high" ? "!" : "i"}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{alert.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(alert.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Verification */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.4s" }}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Veille en attente
              </CardTitle>
              <CardDescription>Documents à valider</CardDescription>
            </div>
            <Button variant="ghost" size="sm">
              Valider tout
            </Button>
          </CardHeader>
          <CardContent>
            {pendingVeille.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aucun document en attente
              </p>
            ) : (
              <div className="space-y-4">
                {pendingVeille.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {doc.category}
                        </Badge>
                        <Badge className={`text-xs ${importanceColors[doc.importance] || importanceColors.moyenne}`}>
                          {doc.importance}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
