import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Edit2, 
  Save, 
  Trash2,
  Database,
  Loader2,
  Download,
  Upload,
  Handshake,
  Percent,
  Scale,
  Calendar,
  Building2,
  FileText
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

interface PreferentialRate {
  agreement_code: string;
  agreement_name: string;
  hs_code: string;
  preferential_rate: number;
  conditions?: string;
  origin_countries?: string[];
}

interface TradeAgreementMention {
  code: string;
  name: string;
  type: string;
  countries: string[];
  mentioned_benefits?: string[];
}

interface LegalReference {
  type: string;
  reference: string;
  title?: string;
  date?: string;
  context?: string;
}

interface ImportantDate {
  date: string;
  type: string;
  description: string;
}

interface IssuingAuthority {
  name: string;
  department?: string;
  signatory?: string;
}

interface ExtractionData {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  hs_codes_full?: HSCodeEntry[]; // Full HS codes with descriptions from Claude
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  trade_agreements?: TradeAgreementMention[];
  preferential_rates?: PreferentialRate[];
  // Champs enrichis pour documents réglementaires
  document_type?: "tariff" | "regulatory";
  document_reference?: string;
  publication_date?: string;
  effective_date?: string;
  expiry_date?: string;
  legal_references?: LegalReference[];
  important_dates?: ImportantDate[];
  issuing_authority?: IssuingAuthority;
  recipients?: string[];
  abrogates?: string[];
  modifies?: string[];
}

interface ExtractionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extractionData: ExtractionData | null;
  pdfId: string;
  pdfTitle: string;
  countryCode: string;
  onInsertComplete: () => void;
}

export default function ExtractionPreviewDialog({
  open,
  onOpenChange,
  extractionData,
  pdfId,
  pdfTitle,
  countryCode,
  onInsertComplete
}: ExtractionPreviewDialogProps) {
  const { toast } = useToast();
  const [isInserting, setIsInserting] = useState(false);
  const [hsCodes, setHsCodes] = useState<HSCodeEntry[]>([]);
  const [tariffLines, setTariffLines] = useState<TariffLine[]>([]);
  const [editingHsIndex, setEditingHsIndex] = useState<number | null>(null);
  const [editingTariffIndex, setEditingTariffIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize state when dialog opens - prefer hs_codes_full for descriptions
  useState(() => {
    if (extractionData) {
      const hsSource = extractionData.hs_codes_full || extractionData.hs_codes || [];
      setHsCodes(hsSource);
      setTariffLines(extractionData.tariff_lines || []);
    }
  });

  // Reset state when extraction data changes - prefer hs_codes_full for descriptions
  const hsCodesSource = extractionData?.hs_codes_full || extractionData?.hs_codes || [];
  if (extractionData && hsCodes.length === 0 && hsCodesSource.length > 0) {
    setHsCodes([...hsCodesSource]);
  }
  if (extractionData && tariffLines.length === 0 && extractionData.tariff_lines?.length > 0) {
    setTariffLines([...extractionData.tariff_lines]);
  }

  const validateNationalCode = (code: string): { valid: boolean; error?: string } => {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length !== 10) {
      return { valid: false, error: `${cleaned.length}/10 chiffres` };
    }
    return { valid: true };
  };

  const validateHsCode = (code: string): { valid: boolean; error?: string } => {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length !== 6) {
      return { valid: false, error: `${cleaned.length}/6 chiffres` };
    }
    return { valid: true };
  };

  const updateHsCode = (index: number, field: keyof HSCodeEntry, value: string) => {
    setHsCodes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Auto-sync code_clean from code
      if (field === "code") {
        updated[index].code_clean = value.replace(/\D/g, "");
      }
      return updated;
    });
  };

  const updateTariffLine = (index: number, field: keyof TariffLine, value: string | number) => {
    setTariffLines(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Auto-sync hs_code_6 from national_code
      if (field === "national_code") {
        const cleaned = String(value).replace(/\D/g, "");
        updated[index].hs_code_6 = cleaned.substring(0, 6);
      }
      return updated;
    });
  };

  const deleteHsCode = (index: number) => {
    setHsCodes(prev => prev.filter((_, i) => i !== index));
  };

  const deleteTariffLine = (index: number) => {
    setTariffLines(prev => prev.filter((_, i) => i !== index));
  };

  const getValidCounts = () => {
    const validHs = hsCodes.filter(hs => validateHsCode(hs.code_clean).valid).length;
    const validTariff = tariffLines.filter(t => validateNationalCode(t.national_code).valid).length;
    return { validHs, validTariff };
  };

  const handleInsert = async () => {
    setIsInserting(true);

    try {
      // Filter only valid entries
      const validHsCodes = hsCodes.filter(hs => validateHsCode(hs.code_clean).valid);
      const validTariffLines = tariffLines.filter(t => validateNationalCode(t.national_code).valid);

      // DEDUPLICATE HS codes by code (keep last occurrence)
      const uniqueHsMap = new Map<string, typeof validHsCodes[0]>();
      validHsCodes.forEach(hs => uniqueHsMap.set(hs.code, hs));
      const uniqueHsCodes = Array.from(uniqueHsMap.values());

      // DEDUPLICATE tariff lines by country_code + national_code (keep last occurrence)
      const uniqueTariffMap = new Map<string, typeof validTariffLines[0]>();
      validTariffLines.forEach(line => {
        const key = `${countryCode}:${line.national_code}`;
        uniqueTariffMap.set(key, line);
      });
      const uniqueTariffLines = Array.from(uniqueTariffMap.values());

      // Insert HS codes
      if (uniqueHsCodes.length > 0) {
        // Safely parse chapter number - must be a valid integer
        const rawChapterNumber = extractionData?.chapter_info?.number;
        const chapterNumber = typeof rawChapterNumber === 'number' && Number.isInteger(rawChapterNumber) 
          ? rawChapterNumber 
          : null;
        const chapterTitle = extractionData?.chapter_info?.title || null;

        const hsRows = uniqueHsCodes.map(hsCode => {
          // Extract chapter from code_clean - ensure it's a valid 2-digit number
          let derivedChapter: number | null = null;
          if (hsCode.code_clean && /^\d{2,}/.test(hsCode.code_clean)) {
            const parsed = parseInt(hsCode.code_clean.slice(0, 2), 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 99) {
              derivedChapter = parsed;
            }
          }
          
          return {
            code: hsCode.code,
            code_clean: hsCode.code_clean,
            description_fr: hsCode.description,
            chapter_number: chapterNumber || derivedChapter,
            chapter_title_fr: chapterTitle,
            is_active: true,
            level: hsCode.level || "subheading",
            parent_code: hsCode.code_clean?.length === 6 ? hsCode.code_clean.slice(0, 4) : null,
          };
        });

        const { error: hsError } = await supabase
          .from("hs_codes")
          .upsert(hsRows, { 
            onConflict: "code",
            ignoreDuplicates: false 
          });

        if (hsError) {
          console.error("HS codes insert error:", hsError);
          throw new Error(`Erreur codes SH: ${hsError.message}`);
        }
      }

      // Insert tariff lines
      if (uniqueTariffLines.length > 0) {
        const tariffRows = uniqueTariffLines.map(line => ({
          country_code: countryCode,
          hs_code_6: line.hs_code_6,
          national_code: line.national_code,
          description_local: line.description,
          duty_rate: line.duty_rate,
          vat_rate: 20,
          unit_code: line.unit || null,
          is_active: true,
          source: `PDF: ${pdfTitle}`,
        }));

        const { error: tariffError } = await supabase
          .from("country_tariffs")
          .upsert(tariffRows, { 
            onConflict: "country_code,national_code",
            ignoreDuplicates: false 
          });

        if (tariffError) {
          console.error("Tariff insert error:", tariffError);
          throw new Error(`Erreur tarifs: ${tariffError.message}`);
        }
      }

      // Save extraction record (upsert pour éviter les doublons si un record existe déjà)
      const { error: extractionError } = await supabase
        .from("pdf_extractions")
        .upsert([{
          pdf_id: pdfId,
          summary: extractionData?.summary || "",
          key_points: extractionData?.key_points || [],
          mentioned_hs_codes: uniqueHsCodes.map(h => h.code_clean),
          detected_tariff_changes: JSON.parse(JSON.stringify(uniqueTariffLines)),
          extracted_data: JSON.parse(JSON.stringify({
            chapter_info: extractionData?.chapter_info || null,
            tariff_lines_count: uniqueTariffLines.length,
            hs_codes_count: uniqueHsCodes.length,
          })),
          extraction_model: "claude-sonnet-4-20250514",
          extraction_confidence: 0.90,
        }], { onConflict: "pdf_id" });

      if (extractionError) {
        console.error("Extraction save error:", extractionError);
      }

      // Update PDF document
      await supabase
        .from("pdf_documents")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          related_hs_codes: uniqueHsCodes.map(h => h.code_clean),
        })
        .eq("id", pdfId);

      toast({
        title: "✅ Données insérées avec succès",
        description: `${uniqueHsCodes.length} codes SH et ${uniqueTariffLines.length} lignes tarifaires`,
      });

      onInsertComplete();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Insert error:", error);
      toast({
        title: "Erreur d'insertion",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsInserting(false);
    }
  };

  const { validHs, validTariff } = getValidCounts();

  // ===== CSV EXPORT =====
  const exportToCSV = () => {
    // Build CSV content with BOM for Excel compatibility
    const BOM = '\uFEFF';
    const headers = ['national_code', 'hs_code_6', 'description', 'duty_rate', 'unit'];
    const rows = tariffLines.map(line => [
      line.national_code,
      line.hs_code_6,
      `"${(line.description || '').replace(/"/g, '""')}"`,
      line.duty_rate.toString(),
      line.unit || ''
    ]);
    
    const csvContent = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `extraction_${pdfTitle.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "📥 Export CSV",
      description: `${tariffLines.length} lignes exportées. Ouvrez dans Excel, corrigez, puis réimportez.`,
    });
  };

  // ===== CSV IMPORT =====
  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        // Remove BOM if present
        const cleanText = text.replace(/^\uFEFF/, '');
        const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
        
        // Skip header row
        const dataLines = lines.slice(1);
        
        const importedTariffs: TariffLine[] = dataLines.map(line => {
          // Handle both comma and semicolon as delimiters
          const parts = line.includes(';') ? parseCSVLine(line, ';') : parseCSVLine(line, ',');
          
          return {
            national_code: parts[0]?.trim() || '',
            hs_code_6: parts[1]?.trim() || '',
            description: parts[2]?.trim().replace(/^"|"$/g, '') || '',
            duty_rate: parseFloat(parts[3]?.trim()) || 0,
            unit: parts[4]?.trim() || undefined,
          };
        }).filter(t => t.national_code); // Filter out empty rows

        setTariffLines(importedTariffs);
        
        toast({
          title: "📤 Import CSV réussi",
          description: `${importedTariffs.length} lignes importées. Vérifiez et insérez en base.`,
        });
      } catch (err) {
        console.error("CSV parse error:", err);
        toast({
          title: "Erreur d'import",
          description: "Format CSV invalide. Utilisez le format exporté.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file, 'UTF-8');
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Parse CSV line handling quoted fields
  const parseCSVLine = (line: string, delimiter: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    
    return result;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Prévisualisation de l'extraction
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{pdfTitle}</p>
        </DialogHeader>

        {extractionData?.summary && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <strong>Résumé:</strong> {extractionData.summary}
          </div>
        )}

        <Tabs defaultValue="tariffs" className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between shrink-0">
            <TabsList>
              <TabsTrigger value="tariffs" className="flex items-center gap-2">
                Lignes tarifaires
                <Badge variant={validTariff === tariffLines.length ? "default" : "destructive"} className="text-xs">
                  {validTariff}/{tariffLines.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="hscodes" className="flex items-center gap-2">
                Codes SH
                <Badge variant={validHs === hsCodes.length ? "default" : "destructive"} className="text-xs">
                  {validHs}/{hsCodes.length}
                </Badge>
              </TabsTrigger>
              {(extractionData?.trade_agreements?.length || 0) > 0 && (
                <TabsTrigger value="agreements" className="flex items-center gap-2">
                  <Handshake className="h-4 w-4" />
                  Accords
                  <Badge className="text-xs">
                    {extractionData?.trade_agreements?.length || 0}
                  </Badge>
                </TabsTrigger>
              )}
              {(extractionData?.preferential_rates?.length || 0) > 0 && (
                <TabsTrigger value="preferential" className="flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  Taux préf.
                  <Badge className="text-xs">
                    {extractionData?.preferential_rates?.length || 0}
                  </Badge>
                </TabsTrigger>
              )}
              {/* Onglet Références légales pour documents réglementaires */}
              {((extractionData?.legal_references?.length || 0) > 0 || 
                (extractionData?.important_dates?.length || 0) > 0 ||
                extractionData?.issuing_authority ||
                extractionData?.document_reference) && (
                <TabsTrigger value="regulatory" className="flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  Réglementaire
                  <Badge className="text-xs bg-primary/20 text-primary">
                    {(extractionData?.legal_references?.length || 0) + (extractionData?.important_dates?.length || 0)}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
            
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-1">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => fileInputRef.current?.click()}
                className="gap-1"
              >
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCSVImport}
                className="hidden"
              />
            </div>
          </div>

          <TabsContent value="tariffs" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[50px]">État</TableHead>
                    <TableHead className="w-[140px]">Code national</TableHead>
                    <TableHead className="w-[100px]">HS 6</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[80px]">DDI %</TableHead>
                    <TableHead className="w-[60px]">Unité</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tariffLines.map((line, index) => {
                    const validation = validateNationalCode(line.national_code);
                    const isEditing = editingTariffIndex === index;

                    return (
                      <TableRow key={index} className={!validation.valid ? "bg-destructive/5" : ""}>
                        <TableCell>
                          {validation.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : (
                            <span title={validation.error}>
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={line.national_code}
                              onChange={(e) => updateTariffLine(index, "national_code", e.target.value)}
                              className="h-8 font-mono text-xs"
                              placeholder="0401101100"
                            />
                          ) : (
                            <code className={`text-xs ${!validation.valid ? "text-destructive" : ""}`}>
                              {line.national_code}
                            </code>
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs text-muted-foreground">{line.hs_code_6}</code>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={line.description}
                              onChange={(e) => updateTariffLine(index, "description", e.target.value)}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <span className="text-xs line-clamp-2">{line.description}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              type="number"
                              value={line.duty_rate}
                              onChange={(e) => updateTariffLine(index, "duty_rate", parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs w-16"
                            />
                          ) : (
                            <span className="text-xs font-medium">{line.duty_rate}%</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{line.unit || "-"}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {isEditing ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingTariffIndex(null)}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingTariffIndex(index)}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteTariffLine(index)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="hscodes" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[50px]">État</TableHead>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead className="w-[100px]">Code clean</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px]">Niveau</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hsCodes.map((hsCode, index) => {
                    const validation = validateHsCode(hsCode.code_clean);
                    const isEditing = editingHsIndex === index;

                    return (
                      <TableRow key={index} className={!validation.valid ? "bg-destructive/5" : ""}>
                        <TableCell>
                          {validation.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : (
                            <span title={validation.error}>
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={hsCode.code}
                              onChange={(e) => updateHsCode(index, "code", e.target.value)}
                              className="h-8 font-mono text-xs"
                              placeholder="0401.10"
                            />
                          ) : (
                            <code className="text-xs">{hsCode.code}</code>
                          )}
                        </TableCell>
                        <TableCell>
                          <code className={`text-xs ${!validation.valid ? "text-destructive" : "text-muted-foreground"}`}>
                            {hsCode.code_clean}
                          </code>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={hsCode.description}
                              onChange={(e) => updateHsCode(index, "description", e.target.value)}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <span className="text-xs line-clamp-2">{hsCode.description}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {hsCode.level}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {isEditing ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingHsIndex(null)}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingHsIndex(index)}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteHsCode(index)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* Trade Agreements Tab */}
          <TabsContent value="agreements" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead>Nom de l'accord</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead>Pays concernés</TableHead>
                    <TableHead>Avantages mentionnés</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(extractionData?.trade_agreements || []).map((agreement, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {agreement.code}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {agreement.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {agreement.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {agreement.countries.join(", ")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {agreement.mentioned_benefits?.join("; ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!extractionData?.trade_agreements || extractionData.trade_agreements.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Aucun accord commercial détecté dans ce document
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* Preferential Rates Tab */}
          <TabsContent value="preferential" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[100px]">Accord</TableHead>
                    <TableHead className="w-[120px]">Code SH</TableHead>
                    <TableHead className="w-[100px]">Taux préf.</TableHead>
                    <TableHead>Conditions</TableHead>
                    <TableHead>Pays d'origine</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(extractionData?.preferential_rates || []).map((rate, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {rate.agreement_code}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{rate.hs_code}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rate.preferential_rate === 0 ? "default" : "outline"} className="text-xs">
                          {rate.preferential_rate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {rate.conditions || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rate.origin_countries?.join(", ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!extractionData?.preferential_rates || extractionData.preferential_rates.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Aucun taux préférentiel détecté dans ce document
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* Regulatory Info Tab */}
          <TabsContent value="regulatory" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[400px]">
              <div className="space-y-6 pr-4">
                {/* En-tête du document */}
                {(extractionData?.document_reference || extractionData?.issuing_authority) && (
                  <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Informations du document
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {extractionData?.document_reference && (
                        <div>
                          <span className="text-muted-foreground">Référence:</span>
                          <p className="font-medium">{extractionData.document_reference}</p>
                        </div>
                      )}
                      {extractionData?.issuing_authority?.name && (
                        <div>
                          <span className="text-muted-foreground">Autorité émettrice:</span>
                          <p className="font-medium flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {extractionData.issuing_authority.name}
                          </p>
                          {extractionData.issuing_authority.department && (
                            <p className="text-xs text-muted-foreground">{extractionData.issuing_authority.department}</p>
                          )}
                        </div>
                      )}
                      {extractionData?.publication_date && (
                        <div>
                          <span className="text-muted-foreground">Date de publication:</span>
                          <p className="font-medium">{extractionData.publication_date}</p>
                        </div>
                      )}
                      {extractionData?.effective_date && (
                        <div>
                          <span className="text-muted-foreground">Date d'application:</span>
                          <p className="font-medium text-success">{extractionData.effective_date}</p>
                        </div>
                      )}
                      {extractionData?.expiry_date && (
                        <div>
                          <span className="text-muted-foreground">Date d'expiration:</span>
                          <p className="font-medium text-destructive">{extractionData.expiry_date}</p>
                        </div>
                      )}
                    </div>
                    {(extractionData?.recipients?.length || 0) > 0 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Destinataires:</span>
                        <p className="font-medium">{extractionData?.recipients?.join(", ")}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Références légales */}
                {(extractionData?.legal_references?.length || 0) > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Scale className="h-4 w-4" />
                      Références légales ({extractionData?.legal_references?.length})
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-[100px]">Type</TableHead>
                            <TableHead>Référence</TableHead>
                            <TableHead>Titre</TableHead>
                            <TableHead className="w-[100px]">Contexte</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractionData?.legal_references?.map((ref, index) => (
                            <TableRow key={index}>
                              <TableCell>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {ref.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {ref.reference}
                                {ref.date && (
                                  <span className="text-muted-foreground ml-2">({ref.date})</span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {ref.title || "-"}
                              </TableCell>
                              <TableCell>
                                {ref.context && (
                                  <Badge variant="secondary" className="text-xs">
                                    {ref.context}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Dates importantes */}
                {(extractionData?.important_dates?.length || 0) > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Dates importantes ({extractionData?.important_dates?.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {extractionData?.important_dates?.map((d, index) => (
                        <div key={index} className="p-3 border rounded-lg bg-card">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant={
                              d.type === "application" ? "default" :
                              d.type === "expiration" ? "destructive" :
                              d.type === "limite" ? "secondary" :
                              "outline"
                            } className="text-xs capitalize">
                              {d.type}
                            </Badge>
                            <span className="font-mono text-sm font-medium">{d.date}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{d.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Modifications et abrogations */}
                {((extractionData?.abrogates?.length || 0) > 0 || (extractionData?.modifies?.length || 0) > 0) && (
                  <div className="space-y-3">
                    <h4 className="font-medium">Relations avec d'autres textes</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {(extractionData?.abrogates?.length || 0) > 0 && (
                        <div className="p-3 border border-destructive/30 rounded-lg bg-destructive/5">
                          <p className="text-xs text-destructive font-medium mb-2">Abroge:</p>
                          <ul className="space-y-1">
                            {extractionData?.abrogates?.map((ref, i) => (
                              <li key={i} className="text-sm">{ref}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(extractionData?.modifies?.length || 0) > 0 && (
                        <div className="p-3 border border-warning/30 rounded-lg bg-warning/5">
                          <p className="text-xs text-warning font-medium mb-2">Modifie:</p>
                          <ul className="space-y-1">
                            {extractionData?.modifies?.map((ref, i) => (
                              <li key={i} className="text-sm">{ref}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Message vide si pas de données */}
                {!extractionData?.document_reference && 
                 !extractionData?.issuing_authority &&
                 (extractionData?.legal_references?.length || 0) === 0 &&
                 (extractionData?.important_dates?.length || 0) === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Scale className="h-12 w-12 mb-4 opacity-30" />
                    <p>Aucune information réglementaire détectée</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex-1 text-sm text-muted-foreground">
            {validHs + validTariff < hsCodes.length + tariffLines.length && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-4 w-4" />
                {hsCodes.length + tariffLines.length - validHs - validTariff} entrées invalides seront ignorées
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button 
            onClick={handleInsert} 
            disabled={isInserting || (validHs === 0 && validTariff === 0)}
            className="gap-2"
          >
            {isInserting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Insertion...
              </>
            ) : (
              <>
                <Database className="h-4 w-4" />
                Insérer {validHs + validTariff} entrées
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
