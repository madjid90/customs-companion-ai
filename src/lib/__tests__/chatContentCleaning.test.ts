import { describe, it, expect } from "vitest";

// =============================================================================
// TESTS: Chat content cleaning functions
// Re-implement the pure functions from Chat.tsx for testability
// =============================================================================

// Copy of cleanConfidenceFromContent from Chat.tsx (pure function)
const cleanConfidenceFromContent = (content: string): string => {
  let cleaned = content
    .replace(/^[🟢🟡🔴]\s*\*?\*?Confiance[^]*?\n/gim, '')
    .replace(/[🟢🟡🔴]\s*\*?\*?Confiance\s*(haute|moyenne|faible|élevée)[^]*?(?=\n\n|\n##|\n\*\*|$)/gim, '')
    .replace(/^\*?\*?Niveau de confiance\s*:\s*(élevé|moyen|faible)[^\n]*\n?/gim, '')
    .replace(/^\*?\*?Confiance\s*:\s*(haute|moyenne|faible|élevée)[^\n]*\n?/gim, '')
    .replace(/^[❓❔ℹ️🔍]\s*$/gm, '')
    .replace(/\n[❓❔]\s*\n/g, '\n')
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{203C}\u{2049}]|[\u{20E3}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[✅✓✔️❌❎⚠️ℹ️📁📂📄📥📜🔗💡🎯🚨]/gu, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/<a[^>]*href="[^"]*"[^>]*>([^<]*)<\/a>/gi, '$1')
    .replace(/https?:\/\/mefyrysrlmzzcsyyysqp\.supabase\.co[^\s)"']*/g, '')
    .replace(/📎\s*\*?\*?Sources?\*?\*?\s*:?[\s\S]*?(?=\n\n[^-\[]|\n##|$)/gi, '')
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/"[a-z_]+"\s*:\s*(?:"[^"]*"|[0-9.]+|null|true|false)\s*,?/gi, '')
    .replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
};

// Copy of removeInteractiveQuestions from Chat.tsx (pure function)
const removeInteractiveQuestions = (content: string): string => {
  const lines = content.split('\n');
  const resultLines: string[] = [];
  let skipUntilNextSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const originalLine = lines[i];
    
    const isQuestionLine = /^\*\*([^*]+)\*\*\s*[-–]?\s*.*$/.test(line);
    
    if (isQuestionLine) {
      let hasOptions = false;
      for (let j = i + 1; j < lines.length && j < i + 10; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
          hasOptions = true;
        } else if (nextLine === '') {
          continue;
        } else if (hasOptions) {
          break;
        }
      }
      
      if (hasOptions) {
        skipUntilNextSection = true;
        continue;
      }
    }
    
    if (skipUntilNextSection && (line.startsWith('- ') || line.startsWith('• '))) {
      continue;
    }
    
    if (skipUntilNextSection && line === '') {
      let nextContentLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextContentLine = lines[j].trim();
          break;
        }
      }
      if (!nextContentLine.startsWith('- ') && !nextContentLine.startsWith('• ')) {
        skipUntilNextSection = false;
      }
    }
    
    if (!skipUntilNextSection) {
      resultLines.push(originalLine);
    }
  }
  
  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

describe("cleanConfidenceFromContent", () => {
  it("removes confidence indicators with emojis", () => {
    const input = "🟢 **Confiance haute**\n\nLe code SH est 8471.30.";
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("Confiance");
    expect(result).toContain("Le code SH est 8471.30.");
  });

  it("removes all emojis from content", () => {
    const input = "✅ Le taux est de 25%";
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("✅");
    expect(result).toContain("Le taux est de 25%");
  });

  it("removes invented markdown links", () => {
    const input = "Voir [ce document](https://example.com/doc.pdf) pour plus d'informations.";
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("](https://");
    expect(result).toContain("ce document");
  });

  it("removes Supabase storage URLs", () => {
    const input = "Téléchargez ici: https://mefyrysrlmzzcsyyysqp.supabase.co/storage/v1/test.pdf";
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("supabase.co");
  });

  it("removes JSON blocks", () => {
    const input = "Voici la réponse.\n\n```json\n{\"key\": \"value\"}\n```\n\nSuite.";
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("```json");
    expect(result).toContain("Voici la réponse.");
  });

  it("removes HTML links", () => {
    const input = 'Voir <a href="https://example.com">ce lien</a> pour détails.';
    const result = cleanConfidenceFromContent(input);
    expect(result).not.toContain("<a");
    expect(result).toContain("ce lien");
  });

  it("collapses excessive newlines", () => {
    const input = "Ligne 1\n\n\n\n\nLigne 2";
    const result = cleanConfidenceFromContent(input);
    expect(result).toBe("Ligne 1\n\nLigne 2");
  });

  it("handles empty string", () => {
    expect(cleanConfidenceFromContent("")).toBe("");
  });

  it("preserves normal content", () => {
    const input = "Le DDI pour le code 8471.30.00.00 est de 2,5%.";
    const result = cleanConfidenceFromContent(input);
    expect(result).toBe(input);
  });
});

describe("removeInteractiveQuestions", () => {
  it("removes questions with options", () => {
    const input = `Voici ma réponse.

**Quel type de produit ?** Précisez:
- Option A
- Option B
- Option C

Suite du texte.`;
    const result = removeInteractiveQuestions(input);
    expect(result).toContain("Voici ma réponse.");
    expect(result).toContain("Suite du texte.");
    expect(result).not.toContain("Option A");
    expect(result).not.toContain("Option B");
  });

  it("preserves bold text without options", () => {
    const input = `**Important:** Le taux est de 25%.`;
    const result = removeInteractiveQuestions(input);
    expect(result).toContain("**Important:**");
    expect(result).toContain("25%");
  });

  it("handles empty string", () => {
    expect(removeInteractiveQuestions("")).toBe("");
  });

  it("preserves content without questions", () => {
    const input = "Le DDI est de 2,5%.\n\nLa TVA est de 20%.";
    const result = removeInteractiveQuestions(input);
    expect(result).toBe(input);
  });

  it("removes bullet lists attached to question headers", () => {
    const input = `Info importante.

**Sélectionnez le matériau:**
- Métal
- Plastique
• Bois

Fin.`;
    const result = removeInteractiveQuestions(input);
    expect(result).not.toContain("Métal");
    expect(result).not.toContain("Plastique");
    expect(result).not.toContain("Bois");
    expect(result).toContain("Fin.");
  });
});
