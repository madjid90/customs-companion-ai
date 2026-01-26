import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload } from "lucide-react";

interface WcoDecision {
  title: string;
  reference: string;
  date: string;
  hs_code: string;
  description: string;
  url: string;
}

interface WcoHtmlImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Parse WCO Trade Tools HTML to extract decisions
function parseWcoHtml(html: string): WcoDecision[] {
  const decisions: WcoDecision[] = [];
  
  // Look for table rows containing decision data
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];
    
    const cellRegexLocal = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegexLocal.exec(rowContent)) !== null) {
      let cellText = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(cellText);
    }
    
    // Extract links from the row
    let url = '';
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>/i;
    const linkMatch = linkRegex.exec(rowContent);
    if (linkMatch) {
      url = linkMatch[1];
      if (url.startsWith('/')) {
        url = `https://www.wcotradetools.org${url}`;
      }
    }
    
    if (cells.length >= 2) {
      // Try to identify HS code pattern
      const hsCodePattern = /\b(\d{4}(?:\.\d{2})?(?:\.\d{2})?)\b/;
      let hsCode = '';
      for (const cell of cells) {
        const match = hsCodePattern.exec(cell);
        if (match) {
          hsCode = match[1].replace(/\./g, '');
          break;
        }
      }
      
      // Try to identify date pattern
      const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{2}[\/\-]\d{2})/;
      let date = '';
      for (const cell of cells) {
        const match = datePattern.exec(cell);
        if (match) {
          date = match[0];
          break;
        }
      }
      
      if (cells[0] && cells[0].length > 5) {
        decisions.push({
          title: cells[0].substring(0, 200),
          reference: cells[1] || '',
          date: date,
          hs_code: hsCode,
          description: cells.slice(2).join(' ').substring(0, 500),
          url: url
        });
      }
    }
  }
  
  return decisions;
}

export function WcoHtmlImportDialog({ open, onOpenChange }: WcoHtmlImportDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [htmlContent, setHtmlContent] = useState("");
  const [parsedDecisions, setParsedDecisions] = useState<WcoDecision[]>([]);
  const [step, setStep] = useState<"input" | "preview">("input");

  const importMutation = useMutation({
    mutationFn: async (decisions: WcoDecision[]) => {
      let newCount = 0;
      
      for (const decision of decisions) {
        // Check if already exists
        const { data: existing } = await supabase
          .from("veille_documents")
          .select("id")
          .eq("title", decision.title)
          .eq("source_name", "WCO Trade Tools")
          .maybeSingle();

        if (!existing) {
          const { error } = await supabase
            .from("veille_documents")
            .insert({
              title: decision.title,
              source_name: "WCO Trade Tools",
              source_url: decision.url || "https://www.wcotradetools.org/en/valuation/decisions",
              category: "valuation_decision",
              publication_date: decision.date || null,
              importance: "haute",
              summary: decision.description,
              content: `Reference: ${decision.reference}\nHS Code: ${decision.hs_code}\n\n${decision.description}`,
              mentioned_hs_codes: decision.hs_code ? [decision.hs_code] : [],
              confidence_score: 0.95,
              collected_by: "manual_wco_import",
            });

          if (!error) {
            newCount++;
          }
        }
      }
      
      return { total: decisions.length, new: newCount };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["veille-documents"] });
      toast({
        title: "Import réussi",
        description: `${result.new} nouvelles décisions importées sur ${result.total} trouvées.`,
      });
      handleClose();
    },
    onError: (error) => {
      toast({
        title: "Erreur d'import",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleParse = () => {
    const decisions = parseWcoHtml(htmlContent);
    setParsedDecisions(decisions);
    setStep("preview");
  };

  const handleImport = () => {
    if (parsedDecisions.length > 0) {
      importMutation.mutate(parsedDecisions);
    }
  };

  const handleClose = () => {
    setHtmlContent("");
    setParsedDecisions([]);
    setStep("input");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Import manuel WCO Trade Tools
          </DialogTitle>
          <DialogDescription>
            Le site WCO bloque les requêtes automatiques. Copiez le HTML de la page des décisions depuis votre navigateur.
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg text-sm space-y-2">
              <p className="font-medium">Instructions :</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Connectez-vous sur <a href="https://www.wcotradetools.org/en/user/login" target="_blank" rel="noopener noreferrer" className="text-primary underline">wcotradetools.org</a></li>
                <li>Naviguez vers la page des décisions de valeur</li>
                <li>Faites clic droit → "Afficher le code source" ou Ctrl+U</li>
                <li>Copiez tout le HTML (Ctrl+A puis Ctrl+C)</li>
                <li>Collez-le ci-dessous</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="html-content">Code source HTML</Label>
              <Textarea
                id="html-content"
                value={htmlContent}
                onChange={(e) => setHtmlContent(e.target.value)}
                placeholder="Collez le HTML ici..."
                className="min-h-[200px] font-mono text-xs"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button 
                onClick={handleParse} 
                disabled={!htmlContent.trim() || htmlContent.length < 100}
              >
                Analyser le HTML
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="font-medium">
                {parsedDecisions.length} décisions trouvées
              </p>
            </div>

            {parsedDecisions.length > 0 ? (
              <>
                <div className="max-h-[300px] overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Titre</th>
                        <th className="p-2 text-left">Référence</th>
                        <th className="p-2 text-left">Code SH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedDecisions.slice(0, 20).map((decision, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2 max-w-[300px] truncate">{decision.title}</td>
                          <td className="p-2">{decision.reference}</td>
                          <td className="p-2">{decision.hs_code || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedDecisions.length > 20 && (
                    <p className="p-2 text-center text-muted-foreground text-sm">
                      ... et {parsedDecisions.length - 20} autres
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setStep("input")}>
                    Retour
                  </Button>
                  <Button 
                    onClick={handleImport} 
                    disabled={importMutation.isPending}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {importMutation.isPending ? "Import..." : `Importer ${parsedDecisions.length} décisions`}
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Aucune décision trouvée dans ce HTML.</p>
                <p className="text-sm">Vérifiez que vous avez copié la bonne page.</p>
                <Button variant="outline" onClick={() => setStep("input")} className="mt-4">
                  Retour
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
