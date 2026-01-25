import { Link } from "react-router-dom";
import { Package, Calculator, Search, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Package,
    title: "Classifier un produit",
    description: "Trouvez le code SH approprié pour vos marchandises",
    href: "/chat",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Calculator,
    title: "Calculer les droits",
    description: "Estimez les taxes et droits de douane à payer",
    href: "/calculate",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: Search,
    title: "Rechercher un code SH",
    description: "Explorez la nomenclature douanière complète",
    href: "/search",
    color: "bg-success/10 text-success",
  },
  {
    icon: AlertTriangle,
    title: "Produits contrôlés",
    description: "Vérifiez les restrictions et autorisations requises",
    href: "/search?filter=controlled",
    color: "bg-destructive/10 text-destructive",
  },
];

export function FeatureCards() {
  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
            Comment puis-je vous aider ?
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Sélectionnez un service pour commencer ou posez directement votre question
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <Link key={feature.href} to={feature.href}>
              <Card 
                className="h-full group cursor-pointer transition-all duration-300 hover:shadow-card-lg hover:-translate-y-1 border-border/50"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <CardContent className="p-6">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${feature.color} mb-4 transition-transform group-hover:scale-110`}>
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
