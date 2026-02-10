import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// TESTS: Context Builder Module
// =============================================================================

// Re-implement pure functions from context-builder.ts for testing

interface TariffWithInheritance {
  found: boolean;
  code: string;
  code_clean: string;
  description: string;
  chapter: number;
  level: string;
  duty_rate: number | null;
  duty_rate_min?: number;
  duty_rate_max?: number;
  vat_rate: number;
  rate_source: "direct" | "inherited" | "range" | "not_found";
  children_count: number;
  is_prohibited: boolean;
  is_restricted: boolean;
  has_children_prohibited: boolean;
  has_children_restricted: boolean;
  legal_notes: string[];
  controls: Array<{ type: string; authority: string; inherited: boolean }>;
}

function formatTariffForRAG(tariff: TariffWithInheritance): string {
  let text = `## Code ${tariff.code}\n`;
  text += `**Description:** ${tariff.description}\n`;
  text += `**Niveau:** ${tariff.level} | **Chapitre:** ${tariff.chapter}\n\n`;

  if (tariff.rate_source === "range" && tariff.duty_rate_min !== undefined && tariff.duty_rate_max !== undefined) {
    text += `**DDI:** ${tariff.duty_rate_min}% à ${tariff.duty_rate_max}% (selon sous-position)\n`;
    text += `Ce code a ${tariff.children_count} sous-positions avec des taux différents. Précisez le code complet.\n`;
  } else if (tariff.duty_rate !== null) {
    text += `**DDI:** ${tariff.duty_rate}%`;
    if (tariff.rate_source === "inherited") {
      text += ` (hérité de ${tariff.children_count} sous-position(s))`;
    }
    text += `\n`;
  } else {
    text += `**DDI:** Non trouvé\n`;
  }
  text += `**TVA:** ${tariff.vat_rate}%\n\n`;

  if (tariff.is_prohibited) text += `**INTERDIT à l'importation**\n`;
  if (tariff.is_restricted) text += `**RESTREINT** - licence potentiellement requise\n`;
  if (tariff.has_children_prohibited) text += `Certaines sous-positions sont INTERDITES\n`;
  if (tariff.has_children_restricted) text += `Certaines sous-positions sont RESTREINTES\n`;

  if (tariff.controls.length > 0) {
    text += `\n**Contrôles requis:**\n`;
    tariff.controls.forEach((c) => {
      text += `- ${c.type} par ${c.authority}${c.inherited ? " [hérité du parent]" : ""}\n`;
    });
  }

  if (tariff.legal_notes.length > 0) {
    text += `\n**Notes légales:**\n`;
    tariff.legal_notes.forEach((n) => text += `> ${n}\n`);
  }

  return text;
}

function formatTariffNotesForRAG(notes: any[]): string {
  if (!notes || notes.length === 0) return "";

  const grouped = notes.reduce((acc: Record<string, any[]>, note: any) => {
    const key = note.chapter_number || "Général";
    if (!acc[key]) acc[key] = [];
    acc[key].push(note);
    return acc;
  }, {});

  let text = "## Notes et Définitions Tarifaires\n\n";

  for (const [chapter, chapterNotes] of Object.entries(grouped)) {
    text += `### Chapitre ${chapter}\n`;
    for (const note of chapterNotes as any[]) {
      const typeLabel = note.note_type === "definition" ? "📖 Définition" :
                        note.note_type === "chapter_note" ? "📋 Note" :
                        note.note_type === "exclusion" ? "⛔ Exclusion" :
                        note.note_type === "subheading_note" ? "📌 Note de sous-position" :
                        "ℹ️ Information";
      text += `**${typeLabel}**`;
      if (note.anchor) text += ` (${note.anchor})`;
      text += `:\n${note.note_text}\n\n`;
    }
  }

  return text;
}

// =============================================================================
// formatTariffForRAG Tests
// =============================================================================

Deno.test("formats direct rate tariff correctly", () => {
  const tariff: TariffWithInheritance = {
    found: true,
    code: "8471.30.00.10",
    code_clean: "8471300010",
    description: "Ordinateurs portables",
    chapter: 84,
    level: "10-digit",
    duty_rate: 2.5,
    vat_rate: 20,
    rate_source: "direct",
    children_count: 0,
    is_prohibited: false,
    is_restricted: false,
    has_children_prohibited: false,
    has_children_restricted: false,
    legal_notes: [],
    controls: [],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("8471.30.00.10"), true);
  assertEquals(result.includes("2.5%"), true);
  assertEquals(result.includes("20%"), true);
  assertEquals(result.includes("Ordinateurs portables"), true);
});

Deno.test("formats range rate tariff with children info", () => {
  const tariff: TariffWithInheritance = {
    found: true,
    code: "8471.30",
    code_clean: "847130",
    description: "Machines de traitement",
    chapter: 84,
    level: "6-digit",
    duty_rate: null,
    duty_rate_min: 2.5,
    duty_rate_max: 40,
    vat_rate: 20,
    rate_source: "range",
    children_count: 5,
    is_prohibited: false,
    is_restricted: false,
    has_children_prohibited: false,
    has_children_restricted: false,
    legal_notes: [],
    controls: [],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("2.5% à 40%"), true);
  assertEquals(result.includes("5 sous-positions"), true);
});

Deno.test("shows prohibited flag", () => {
  const tariff: TariffWithInheritance = {
    found: true, code: "2903.00", code_clean: "290300", description: "Produit interdit",
    chapter: 29, level: "6-digit", duty_rate: 25, vat_rate: 20, rate_source: "direct",
    children_count: 0, is_prohibited: true, is_restricted: false,
    has_children_prohibited: false, has_children_restricted: false,
    legal_notes: [], controls: [],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("INTERDIT"), true);
});

Deno.test("shows controls", () => {
  const tariff: TariffWithInheritance = {
    found: true, code: "0702.00", code_clean: "070200", description: "Tomates",
    chapter: 7, level: "6-digit", duty_rate: 40, vat_rate: 0, rate_source: "direct",
    children_count: 0, is_prohibited: false, is_restricted: false,
    has_children_prohibited: false, has_children_restricted: false,
    legal_notes: [],
    controls: [{ type: "Sanitaire", authority: "ONSSA", inherited: false }],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("Sanitaire"), true);
  assertEquals(result.includes("ONSSA"), true);
});

Deno.test("shows inherited rate source", () => {
  const tariff: TariffWithInheritance = {
    found: true, code: "8471.30", code_clean: "847130", description: "Test",
    chapter: 84, level: "6-digit", duty_rate: 2.5, vat_rate: 20, rate_source: "inherited",
    children_count: 3, is_prohibited: false, is_restricted: false,
    has_children_prohibited: false, has_children_restricted: false,
    legal_notes: [], controls: [],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("hérité"), true);
  assertEquals(result.includes("3"), true);
});

Deno.test("shows legal notes", () => {
  const tariff: TariffWithInheritance = {
    found: true, code: "8471.30", code_clean: "847130", description: "Test",
    chapter: 84, level: "6-digit", duty_rate: 25, vat_rate: 20, rate_source: "direct",
    children_count: 0, is_prohibited: false, is_restricted: false,
    has_children_prohibited: false, has_children_restricted: false,
    legal_notes: ["Note importante du chapitre 84"],
    controls: [],
  };

  const result = formatTariffForRAG(tariff);
  assertEquals(result.includes("Note importante du chapitre 84"), true);
});

// =============================================================================
// formatTariffNotesForRAG Tests
// =============================================================================

Deno.test("returns empty string for no notes", () => {
  assertEquals(formatTariffNotesForRAG([]), "");
  assertEquals(formatTariffNotesForRAG(null as any), "");
});

Deno.test("formats chapter notes correctly", () => {
  const notes = [
    { chapter_number: 84, note_type: "chapter_note", note_text: "Ce chapitre comprend...", anchor: "Note 1" },
  ];
  const result = formatTariffNotesForRAG(notes);
  assertEquals(result.includes("Chapitre 84"), true);
  assertEquals(result.includes("Note"), true);
  assertEquals(result.includes("Ce chapitre comprend"), true);
});

Deno.test("groups notes by chapter", () => {
  const notes = [
    { chapter_number: 84, note_type: "definition", note_text: "Définition A" },
    { chapter_number: 85, note_type: "exclusion", note_text: "Exclusion B" },
    { chapter_number: 84, note_type: "chapter_note", note_text: "Note C" },
  ];
  const result = formatTariffNotesForRAG(notes);
  assertEquals(result.includes("Chapitre 84"), true);
  assertEquals(result.includes("Chapitre 85"), true);
  assertEquals(result.includes("Définition A"), true);
  assertEquals(result.includes("Exclusion B"), true);
});

Deno.test("uses correct type labels", () => {
  const notes = [
    { chapter_number: 1, note_type: "definition", note_text: "test" },
    { chapter_number: 1, note_type: "exclusion", note_text: "test2" },
  ];
  const result = formatTariffNotesForRAG(notes);
  assertEquals(result.includes("Définition"), true);
  assertEquals(result.includes("Exclusion"), true);
});
