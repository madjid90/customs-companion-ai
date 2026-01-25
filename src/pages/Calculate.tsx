import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, AlertTriangle, FileDown, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { hsCodesService, tariffsService, controlledService, countriesService, calculateDuties, type Country, type ControlledProduct } from "@/lib/supabase-services";

interface CalculationResult {
  cifValue: number;
  dutyRate: number;
  dutyAmount: number;
  vatBase: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  controlled: ControlledProduct[] | null;
}

export default function Calculate() {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get("code") || "";

  const [hsCode, setHsCode] = useState(initialCode);
  const [hsCodeSearch, setHsCodeSearch] = useState("");
  const [hsCodeSuggestions, setHsCodeSuggestions] = useState<{ code: string; description_fr: string }[]>([]);
  const [description, setDescription] = useState("");
  const [cifValue, setCifValue] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [destCountry, setDestCountry] = useState("MA");
  const [countries, setCountries] = useState<Country[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [codePopoverOpen, setCodePopoverOpen] = useState(false);

  // Load countries on mount
  useEffect(() => {
    const loadCountries = async () => {
      const { data } = await countriesService.getAll();
      if (data) setCountries(data);
    };
    loadCountries();
  }, []);

  // Load initial code details
  useEffect(() => {
    if (initialCode) {
      loadCodeDetails(initialCode);
    }
  }, [initialCode]);

  // Autocomplete HS codes
  useEffect(() => {
    const searchCodes = async () => {
      if (hsCodeSearch.length < 2) {
        setHsCodeSuggestions([]);
        return;
      }
      setIsLoading(true);
      try {
        const { data } = await hsCodesService.autocomplete(hsCodeSearch, 10);
        if (data) setHsCodeSuggestions(data);
      } catch (error) {
        console.error("Autocomplete error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(searchCodes, 200);
    return () => clearTimeout(debounce);
  }, [hsCodeSearch]);

  const loadCodeDetails = async (code: string) => {
    const { data } = await hsCodesService.getByCode(code);
    if (data) {
      setDescription(data.description_fr);
    }
  };

  const handleCodeSelect = (code: string, desc: string) => {
    setHsCode(code);
    setDescription(desc);
    setCodePopoverOpen(false);
  };

  const handleCalculate = async () => {
    const cif = parseFloat(cifValue);
    if (isNaN(cif) || cif <= 0 || !hsCode) return;

    setIsCalculating(true);
    try {
      // Get tariff from database
      const { data: tariff } = await tariffsService.getForCode(destCountry, hsCode);
      
      const dutyRate = tariff?.duty_rate || 17.5;
      const vatRate = tariff?.vat_rate || 20;

      const calc = calculateDuties(cif, dutyRate, vatRate);

      // Check if controlled
      const { data: controlled } = await controlledService.checkProduct(destCountry, hsCode);

      setResult({
        ...calc,
        controlled: controlled && controlled.length > 0 ? controlled : null,
      });
    } catch (error) {
      console.error("Calculate error:", error);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleReset = () => {
    setHsCode("");
    setDescription("");
    setCifValue("");
    setOriginCountry("");
    setResult(null);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("fr-MA", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-fade-in">
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
            <Calculator className="h-8 w-8 text-accent" />
            Calculateur de droits de douane
          </h1>
          <p className="text-muted-foreground">
            Estimez les taxes et droits à payer sur vos importations
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Form */}
          <Card className="animate-slide-up">
            <CardHeader>
              <CardTitle>Informations produit</CardTitle>
              <CardDescription>
                Renseignez les détails de votre marchandise
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Code SH</Label>
                <Popover open={codePopoverOpen} onOpenChange={setCodePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-start font-normal h-12"
                    >
                      {hsCode || "Rechercher un code SH..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Tapez un code ou une description..."
                        value={hsCodeSearch}
                        onValueChange={setHsCodeSearch}
                      />
                      <CommandList>
                        {isLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        ) : (
                          <>
                            <CommandEmpty>Aucun code trouvé</CommandEmpty>
                            <CommandGroup>
                              {hsCodeSuggestions.map((item) => (
                                <CommandItem
                                  key={item.code}
                                  onSelect={() => handleCodeSelect(item.code, item.description_fr)}
                                  className="cursor-pointer"
                                >
                                  <span className="font-mono font-medium">{item.code}</span>
                                  <span className="ml-2 text-muted-foreground text-sm truncate">
                                    {item.description_fr}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {description && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <p className="text-sm text-foreground mt-1">{description}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cifValue">Valeur CIF (USD)</Label>
                <Input
                  id="cifValue"
                  type="number"
                  placeholder="Ex: 10000"
                  value={cifValue}
                  onChange={(e) => setCifValue(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="origin">Pays d'origine</Label>
                  <Select value={originCountry} onValueChange={setOriginCountry}>
                    <SelectTrigger id="origin">
                      <SelectValue placeholder="Sélectionnez" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name_fr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dest">Destination</Label>
                  <Select value={destCountry} onValueChange={setDestCountry}>
                    <SelectTrigger id="dest">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name_fr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleCalculate}
                className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
                disabled={!hsCode || !cifValue || !originCountry || isCalculating}
              >
                {isCalculating ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Calcul...
                  </>
                ) : (
                  <>
                    <Calculator className="h-5 w-5 mr-2" />
                    Calculer
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
            {result ? (
              <Card className="border-2 border-accent/20">
                <CardHeader className="bg-accent/5">
                  <CardTitle className="flex items-center justify-between">
                    <span>Résultat du calcul</span>
                    {result.controlled && (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Contrôlé
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Valeur CIF</span>
                    <span className="font-medium">{formatCurrency(result.cifValue)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      Droit de douane (DDI) - {result.dutyRate}%
                    </span>
                    <span className="font-medium">{formatCurrency(result.dutyAmount)}</span>
                  </div>

                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>Base TVA</span>
                    <span>{formatCurrency(result.vatBase)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      TVA - {result.vatRate}%
                    </span>
                    <span className="font-medium">{formatCurrency(result.vatAmount)}</span>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">TOTAL À PAYER</span>
                    <span className="text-2xl font-bold text-accent">
                      {formatCurrency(result.total)}
                    </span>
                  </div>

                  {result.controlled && (
                    <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-destructive">
                            Produit soumis à contrôle
                          </p>
                          {result.controlled.map((ctrl, i) => (
                            <div key={i} className="text-sm text-muted-foreground mt-1">
                              <p>Autorité: {ctrl.control_authority}</p>
                              {ctrl.required_norm && <p>Norme: {ctrl.required_norm}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <Button onClick={handleReset} variant="outline" className="flex-1">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Nouveau calcul
                    </Button>
                    <Button variant="outline" className="flex-1">
                      <FileDown className="h-4 w-4 mr-2" />
                      Exporter PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full flex items-center justify-center border-dashed">
                <CardContent className="text-center py-12">
                  <Calculator className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">
                    Remplissez le formulaire pour voir le calcul des droits
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
