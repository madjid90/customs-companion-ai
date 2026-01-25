import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search as SearchIcon, Filter, Loader2 } from "lucide-react";
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
import { hsCodesService, tariffsService, controlledService, countriesService, type HSCode, type CountryTariff, type ControlledProduct, type Country } from "@/lib/supabase-services";

interface HSCodeWithTariff extends HSCode {
  tariff?: CountryTariff | null;
  controlled?: ControlledProduct[] | null;
}

export default function Search() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState("");
  const [controlledOnly, setControlledOnly] = useState(searchParams.get("filter") === "controlled");
  const [selectedCode, setSelectedCode] = useState<HSCodeWithTariff | null>(null);
  const [results, setResults] = useState<HSCodeWithTariff[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  // Load countries on mount
  useEffect(() => {
    const loadCountries = async () => {
      const { data } = await countriesService.getAll();
      if (data) setCountries(data);
    };
    loadCountries();
    handleSearch();
  }, []);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      const { data, count } = await hsCodesService.search(query, {
        chapter: chapter ? parseInt(chapter) : undefined,
        limit: 20,
        offset: page * 20,
      });

      if (data) {
        // Enrich with tariffs
        const enriched = await Promise.all(
          data.map(async (code) => {
            const { data: tariff } = await tariffsService.getForCode('MA', code.code);
            const { data: controlled } = await controlledService.checkProduct('MA', code.code);
            return {
              ...code,
              tariff,
              controlled: controlled && controlled.length > 0 ? controlled : null,
            };
          })
        );

        // Filter controlled only if needed
        const filtered = controlledOnly 
          ? enriched.filter(c => c.controlled && c.controlled.length > 0)
          : enriched;

        setResults(filtered);
        setTotalCount(count || 0);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      handleSearch();
    }, 300);
    return () => clearTimeout(debounce);
  }, [query, chapter, controlledOnly, page]);

  const handleCodeClick = (code: HSCodeWithTariff) => {
    setSelectedCode(code);
  };

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
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  className="pl-10 h-12"
                />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-4 items-center">
                <Select value={chapter || "all"} onValueChange={(v) => { setChapter(v === "all" ? "" : v); setPage(0); }}>
                  <SelectTrigger className="w-40 h-12">
                    <SelectValue placeholder="Chapitre" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
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
                    onCheckedChange={(checked) => {
                      setControlledOnly(checked as boolean);
                      setPage(0);
                    }}
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
              <span>
                Résultats {isLoading ? "" : `(${results.length}${totalCount > 20 ? ` sur ${totalCount}` : ""})`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12">
                <SearchIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Aucun résultat trouvé</p>
              </div>
            ) : (
              <>
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
                    {results.map((code) => (
                      <TableRow
                        key={code.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCodeClick(code)}
                      >
                        <TableCell className="font-mono font-medium">
                          {code.code}
                        </TableCell>
                        <TableCell className="max-w-md truncate">{code.description_fr}</TableCell>
                        <TableCell className="text-center">{code.chapter_number}</TableCell>
                        <TableCell className="text-right">
                          {code.tariff ? `${code.tariff.duty_rate}%` : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {code.tariff ? `${code.tariff.vat_rate}%` : "-"}
                        </TableCell>
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

                {/* Pagination */}
                {totalCount > 20 && (
                  <div className="flex items-center justify-between p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      Précédent
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page + 1} sur {Math.ceil(totalCount / 20)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * 20 >= totalCount}
                    >
                      Suivant
                    </Button>
                  </div>
                )}
              </>
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
                  <p className="text-foreground mt-1">{selectedCode.description_fr}</p>
                  {selectedCode.description_en && (
                    <p className="text-muted-foreground text-sm mt-1">{selectedCode.description_en}</p>
                  )}
                </div>

                {selectedCode.legal_notes && (
                  <div>
                    <Label className="text-muted-foreground">Notes légales</Label>
                    <p className="text-sm text-foreground mt-1">{selectedCode.legal_notes}</p>
                  </div>
                )}

                {selectedCode.tariff && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <Label className="text-muted-foreground text-xs">Droit de douane (DDI)</Label>
                      <p className="text-2xl font-bold text-foreground">{selectedCode.tariff.duty_rate}%</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <Label className="text-muted-foreground text-xs">TVA</Label>
                      <p className="text-2xl font-bold text-foreground">{selectedCode.tariff.vat_rate}%</p>
                    </div>
                  </div>
                )}

                {selectedCode.controlled && selectedCode.controlled.length > 0 && (
                  <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-start gap-3">
                      <div>
                        <p className="font-medium text-destructive">
                          ⚠️ Produit soumis à contrôle
                        </p>
                        {selectedCode.controlled.map((ctrl, i) => (
                          <div key={i} className="mt-2 text-sm">
                            <p><strong>Type:</strong> {ctrl.control_type}</p>
                            <p><strong>Autorité:</strong> {ctrl.control_authority}</p>
                            {ctrl.standard_required && <p><strong>Norme:</strong> {ctrl.standard_required}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button 
                    className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                    onClick={() => {
                      setSelectedCode(null);
                      navigate(`/calculate?code=${selectedCode.code}`);
                    }}
                  >
                    Calculer les droits
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
