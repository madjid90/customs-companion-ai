import { Package, MapPin, FileText, Calculator, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface CollectedInfo {
  product?: string;
  country?: string;
  hsCode?: string;
  value?: string;
  origin?: string;
  purpose?: string;
  characteristics?: string[];
}

// Extract collected information from conversation
export function extractConversationSummary(messages: Message[]): CollectedInfo {
  const info: CollectedInfo = {};
  const characteristics: string[] = [];

  for (const msg of messages) {
    const content = msg.content.toLowerCase();
    
    // Product detection - look for product mentions in user messages
    if (msg.role === "user") {
      // Check for product keywords
      const productPatterns = [
        /(?:je veux|j'importe|classifier|classifie|produit|article|marchandise)[:\s]+([^?.!]+)/i,
        /^(?!comment|quel|quels|quelle|est-ce|pourquoi|où|qui)([^?.!]{5,50})$/i,
      ];
      
      for (const pattern of productPatterns) {
        const match = msg.content.match(pattern);
        if (match && match[1] && match[1].length > 3 && match[1].length < 100) {
          const potentialProduct = match[1].trim();
          // Avoid question words and common phrases
          if (!potentialProduct.match(/^(comment|quel|est-ce|pour|avec|dans|sur|les|des|une?|le|la)/i)) {
            info.product = potentialProduct;
          }
        }
      }

      // Country detection
      const countryPatterns = [
        /(?:au|vers|pour|depuis|en|du|de)\s+(maroc|france|algérie|tunisie|sénégal|côte d'ivoire|egypte|usa|états-unis|chine|inde|allemagne|espagne|italie|belgique|turquie|émirats|dubai)/i,
        /(maroc|france|algérie|tunisie|sénégal|côte d'ivoire|egypte|usa|états-unis|chine|inde|allemagne|espagne|italie|belgique|turquie|émirats|dubai)/i,
      ];
      
      for (const pattern of countryPatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          info.country = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
          break;
        }
      }

      // Value detection
      const valueMatch = msg.content.match(/(\d+[\s,.]?\d*)\s*(usd|eur|€|\$|mad|dh|dollars?|euros?)/i);
      if (valueMatch) {
        info.value = valueMatch[0];
      }

      // Origin detection
      const originMatch = msg.content.match(/(?:origine|originaire|provenance|fabriqué|made in)[:\s]+([a-zéèàùâêîôû]+)/i);
      if (originMatch) {
        info.origin = originMatch[1].charAt(0).toUpperCase() + originMatch[1].slice(1);
      }

      // Purpose detection
      const purposePatterns = [
        /(?:pour|destiné|usage)[:\s]+(commerc|person|professionn|industriel|revente|usage personnel)/i,
      ];
      for (const pattern of purposePatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          info.purpose = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        }
      }

      // Collect characteristics from answers
      if (msg.content.length < 100 && !msg.content.includes("?")) {
        const answer = msg.content.trim();
        if (answer && !answer.match(/^(oui|non|ok|merci|bonjour|salut)/i)) {
          characteristics.push(answer);
        }
      }
    }

    // HS Code detection from assistant responses
    if (msg.role === "assistant") {
      const hsCodeMatch = msg.content.match(/\b(\d{4}[.\s]?\d{2}(?:[.\s]?\d{2})?(?:[.\s]?\d{2})?)\b/);
      if (hsCodeMatch) {
        info.hsCode = hsCodeMatch[1].replace(/\s/g, ".");
      }

      // Extract product from assistant confirmation
      const productConfirmMatch = msg.content.match(/(?:produit|article|marchandise)[:\s]*\*?\*?([^*\n.]{5,50})\*?\*?/i);
      if (productConfirmMatch && !info.product) {
        info.product = productConfirmMatch[1].trim();
      }
    }
  }

  // Keep only unique and meaningful characteristics
  if (characteristics.length > 0) {
    info.characteristics = [...new Set(characteristics)].slice(0, 5);
  }

  return info;
}

interface ConversationSummaryProps {
  messages: Message[];
}

export function ConversationSummary({ messages }: ConversationSummaryProps) {
  const info = extractConversationSummary(messages);
  
  // Don't show if no meaningful info collected
  const hasInfo = info.product || info.country || info.hsCode || info.value || (info.characteristics && info.characteristics.length > 0);
  
  if (!hasInfo || messages.length < 2) {
    return null;
  }

  const items = [
    { icon: Package, label: "Produit", value: info.product, color: "text-primary" },
    { icon: MapPin, label: "Destination", value: info.country, color: "text-accent" },
    { icon: FileText, label: "Code SH", value: info.hsCode, color: "text-success" },
    { icon: Calculator, label: "Valeur", value: info.value, color: "text-warning" },
  ].filter(item => item.value);

  return (
    <Card className="mx-auto max-w-3xl mb-4 bg-muted/30 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-foreground">Résumé de la conversation</span>
          <Badge variant="secondary" className="text-xs">
            {messages.filter(m => m.role === "user").length} échanges
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {items.map((item, index) => (
            <div key={index} className="flex items-start gap-2">
              <item.icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", item.color)} />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium text-foreground truncate" title={item.value}>
                  {item.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {info.characteristics && info.characteristics.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Informations collectées</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {info.characteristics.map((char, index) => (
                <Badge key={index} variant="outline" className="text-xs font-normal">
                  {char}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
