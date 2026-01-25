import { Package, DollarSign, FileText, MessageSquare, AlertTriangle, Clock } from "lucide-react";
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

const stats = [
  { label: "Codes SH", value: "12,456", icon: Package, color: "text-primary" },
  { label: "Tarifs", value: "8,234", icon: DollarSign, color: "text-accent" },
  { label: "Documents", value: "156", icon: FileText, color: "text-success" },
  { label: "Conversations", value: "2,847", icon: MessageSquare, color: "text-warning" },
];

const chartData = [
  { date: "Lun", conversations: 45 },
  { date: "Mar", conversations: 62 },
  { date: "Mer", conversations: 58 },
  { date: "Jeu", conversations: 71 },
  { date: "Ven", conversations: 84 },
  { date: "Sam", conversations: 32 },
  { date: "Dim", conversations: 28 },
];

const recentAlerts = [
  { id: 1, severity: "error", title: "Nouveau tarif douanier détecté", date: "Il y a 2h" },
  { id: 2, severity: "warning", title: "Circulaire ADII en attente", date: "Il y a 5h" },
  { id: 3, severity: "info", title: "Veille automatique terminée", date: "Hier" },
];

const pendingVerification = [
  { id: 1, title: "Circulaire n°5432/2025", category: "Circulaire", importance: "haute" },
  { id: 2, title: "Modification tarif ch.87", category: "Tarif", importance: "moyenne" },
  { id: 3, title: "Accord AfCFTA update", category: "Accord", importance: "haute" },
];

const severityColors = {
  error: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  info: "bg-primary text-primary-foreground",
};

const importanceColors = {
  haute: "bg-destructive/10 text-destructive",
  moyenne: "bg-warning/10 text-warning",
  basse: "bg-success/10 text-success",
};

export default function AdminDashboard() {
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
        {stats.map((stat, index) => (
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
            <div className="space-y-4">
              {recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                >
                  <Badge className={severityColors[alert.severity as keyof typeof severityColors]}>
                    {alert.severity === "error" ? "!" : alert.severity === "warning" ? "?" : "i"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{alert.title}</p>
                    <p className="text-xs text-muted-foreground">{alert.date}</p>
                  </div>
                </div>
              ))}
            </div>
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
            <div className="space-y-4">
              {pendingVerification.map((doc) => (
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
                      <Badge className={`text-xs ${importanceColors[doc.importance as keyof typeof importanceColors]}`}>
                        {doc.importance}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
