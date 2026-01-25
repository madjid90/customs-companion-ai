import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, AlertTriangle, FileDown, RefreshCw } from "lucide-react";
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

// Mock data
const mockHSCodes = [
  { code: "8517.12", description: "Téléphones pour réseaux cellulaires", ddi: 2.5, tva: 20, controlled: false },
  { code: "8471.30", description: "Machines automatiques de traitement de l'information", ddi: 0, tva: 20, controlled: false },
  { code: "2204.21", description: "Vins de raisins frais en récipients ≤ 2 L", ddi: 40, tva: 20, controlled: true, authority: "ADII" },
];

const countries = [
  { code: "MA", name: "Maroc" },
  { code: "FR", name: "France" },
  { code: "CN", name: "Chine" },
  { code: "US", name: "États-Unis" },
  { code: "ES", name: "Espagne" },
];

interface CalculationResult {
  cifValue: number;
  ddi: number;
  ddiAmount: number;
  tvaBase: number;
  tva: number;
  tvaAmount: number;
  total: number;
  controlled: boolean;
  authority?: string;
}

export default function Calculate() {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get("code") || "";

  const [hsCode, setHsCode] = useState(initialCode);
  const [description, setDescription] = useState("");
  const [cifValue, setCifValue] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [destCountry, setDestCountry] = useState("MA");
  const [result, setResult] = useState<CalculationResult | null>(null);

  useEffect(() => {
    if (hsCode) {
      const found = mockHSCodes.find((c) => c.code === hsCode);
      if (found) {
        setDescription(found.description);
      }
    }
  }, [hsCode]);

  const handleCalculate = () => {
    const cif = parseFloat(cifValue);
    if (isNaN(cif) || cif <= 0) return;

    const hsData = mockHSCodes.find((c) => c.code === hsCode);
    const ddiRate = hsData?.ddi || 17.5;
    const tvaRate = hsData?.tva || 20;

    const ddiAmount = cif * (ddiRate / 100);
    const tvaBase = cif + ddiAmount;
    const tvaAmount = tvaBase * (tvaRate / 100);
    const total = cif + ddiAmount + tvaAmount;

    setResult({
      cifValue: cif,
      ddi: ddiRate,
      ddiAmount,
      tvaBase,
      tva: tvaRate,
      tvaAmount,
      total,
      controlled: hsData?.controlled || false,
      authority: hsData?.authority,
    });
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
                <Label htmlFor="hsCode">Code SH</Label>
                <Select value={hsCode} onValueChange={setHsCode}>
                  <SelectTrigger id="hsCode">
                    <SelectValue placeholder="Sélectionnez ou saisissez un code" />
                  </SelectTrigger>
                  <SelectContent>
                    {mockHSCodes.map((code) => (
                      <SelectItem key={code.code} value={code.code}>
                        {code.code} - {code.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dest">Pays de destination</Label>
                  <Select value={destCountry} onValueChange={setDestCountry}>
                    <SelectTrigger id="dest">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleCalculate}
                className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
                disabled={!hsCode || !cifValue || !originCountry}
              >
                <Calculator className="h-5 w-5 mr-2" />
                Calculer
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
                      Droit de douane (DDI) - {result.ddi}%
                    </span>
                    <span className="font-medium">{formatCurrency(result.ddiAmount)}</span>
                  </div>

                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>Base TVA</span>
                    <span>{formatCurrency(result.tvaBase)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">
                      TVA - {result.tva}%
                    </span>
                    <span className="font-medium">{formatCurrency(result.tvaAmount)}</span>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">TOTAL À PAYER</span>
                    <span className="text-2xl font-bold text-accent">
                      {formatCurrency(result.total)}
                    </span>
                  </div>

                  {result.controlled && result.authority && (
                    <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-destructive">
                            Produit soumis à contrôle
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Autorité compétente: {result.authority}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Une autorisation préalable peut être requise.
                          </p>
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
