import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon, Filter, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

// Mock data for demonstration
const mockHSCodes = [
  { code: "8517.12", description: "Téléphones pour réseaux cellulaires", chapter: 85, ddi: 2.5, tva: 20, controlled: false },
  { code: "8471.30", description: "Machines automatiques de traitement de l'information portables", chapter: 84, ddi: 0, tva: 20, controlled: false },
  { code: "2204.21", description: "Vins de raisins frais en récipients ≤ 2 L", chapter: 22, ddi: 40, tva: 20, controlled: true },
  { code: "0201.10", description: "Viandes bovines fraîches ou réfrigérées, en carcasses", chapter: 2, ddi: 254, tva: 20, controlled: true },
  { code: "6110.20", description: "Chandails, pull-overs de coton", chapter: 61, ddi: 30, tva: 20, controlled: false },
];

interface HSCode {
  code: string;
  description: string;
  chapter: number;
  ddi: number;
  tva: number;
  controlled: boolean;
}

export default function Search() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState("");
  const [controlledOnly, setControlledOnly] = useState(searchParams.get("filter") === "controlled");
  const [selectedCode, setSelectedCode] = useState<HSCode | null>(null);

  const filteredCodes = mockHSCodes.filter((code) => {
    const matchesQuery = query === "" || 
      code.code.includes(query) || 
      code.description.toLowerCase().includes(query.toLowerCase());
    const matchesChapter = chapter === "" || code.chapter.toString() === chapter;
    const matchesControlled = !controlledOnly || code.controlled;
    return matchesQuery && matchesChapter && matchesControlled;
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-fade-in">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Recherche Code SH
          </h1>
          <p className="text-muted-foreground">
            Explorez la nomenclature douanière et trouvez les tarifs applicables
          </p>
        </div>

        {/* Search and Filters */}
        <Card className="mb-6 animate-slide-up">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search Input */}
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Rechercher par code ou description..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-10 h-12"
                />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-4 items-center">
                <Select value={chapter} onValueChange={setChapter}>
                  <SelectTrigger className="w-40 h-12">
                    <SelectValue placeholder="Chapitre" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Tous</SelectItem>
                    {Array.from({ length: 99 }, (_, i) => (
                      <SelectItem key={i + 1} value={(i + 1).toString()}>
                        Chapitre {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="controlled"
                    checked={controlledOnly}
                    onCheckedChange={(checked) => setControlledOnly(checked as boolean)}
                  />
                  <Label htmlFor="controlled" className="text-sm cursor-pointer">
                    Produits contrôlés uniquement
                  </Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <CardHeader className="border-b">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Résultats ({filteredCodes.length})</span>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Exporter
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCodes.length === 0 ? (
              <div className="text-center py-12">
                <SearchIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Aucun résultat trouvé</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24 text-center">Chapitre</TableHead>
                    <TableHead className="w-24 text-right">DDI %</TableHead>
                    <TableHead className="w-24 text-right">TVA %</TableHead>
                    <TableHead className="w-24 text-center">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCodes.map((code) => (
                    <TableRow
                      key={code.code}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedCode(code)}
                    >
                      <TableCell className="font-mono font-medium">
                        {code.code}
                      </TableCell>
                      <TableCell>{code.description}</TableCell>
                      <TableCell className="text-center">{code.chapter}</TableCell>
                      <TableCell className="text-right">{code.ddi}%</TableCell>
                      <TableCell className="text-right">{code.tva}%</TableCell>
                      <TableCell className="text-center">
                        {code.controlled ? (
                          <Badge variant="destructive" className="text-xs">
                            Contrôlé
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Libre
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detail Modal */}
        <Dialog open={!!selectedCode} onOpenChange={() => setSelectedCode(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <span className="font-mono text-xl">{selectedCode?.code}</span>
                {selectedCode?.controlled && (
                  <Badge variant="destructive">Produit contrôlé</Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            
            {selectedCode && (
              <div className="space-y-6">
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="text-foreground mt-1">{selectedCode.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <Label className="text-muted-foreground text-xs">Droit de douane (DDI)</Label>
                    <p className="text-2xl font-bold text-foreground">{selectedCode.ddi}%</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <Label className="text-muted-foreground text-xs">TVA</Label>
                    <p className="text-2xl font-bold text-foreground">{selectedCode.tva}%</p>
                  </div>
                </div>

                {selectedCode.controlled && (
                  <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive font-medium">
                      ⚠️ Ce produit est soumis à des contrôles spéciaux. 
                      Vérifiez les autorisations requises avant importation.
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button 
                    className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                    onClick={() => {
                      setSelectedCode(null);
                      window.location.href = `/calculate?code=${selectedCode.code}`;
                    }}
                  >
                    Calculer les droits
                  </Button>
                  <Button variant="outline">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
