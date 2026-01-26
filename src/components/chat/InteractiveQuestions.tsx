import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Question {
  id: string;
  label: string;
  options: string[];
}

interface InteractiveQuestionsProps {
  questions: Question[];
  onAnswer: (questionId: string, answer: string) => void;
  disabled?: boolean;
}

// Parse AI response to extract questions with options
export function parseQuestionsFromResponse(content: string): Question[] {
  const questions: Question[] = [];
  
  // Pattern 1: Numbered questions with options after dash
  // e.g., "1. **Type spécifique** - Smartphone, téléphone basique, téléphone satellite ?"
  const numberedPattern = /(\d+)\.\s*\*?\*?([^*\n-]+)\*?\*?\s*[-–:]\s*([^?\n]+)\?/g;
  let match;
  
  while ((match = numberedPattern.exec(content)) !== null) {
    const label = match[2].trim();
    const optionsText = match[3].trim();
    
    // Split options by comma or "ou"
    const options = optionsText
      .split(/,|(?:\s+ou\s+)/)
      .map(opt => opt.trim())
      .filter(opt => opt.length > 0 && opt.length < 50);
    
    if (options.length >= 2) {
      questions.push({
        id: `q${match[1]}`,
        label,
        options,
      });
    }
  }
  
  // Pattern 2: Questions starting with emoji or bullet
  // e.g., "• Pays d'origine - Chine, Vietnam, Inde ?"
  const bulletPattern = /[•●▪]\s*\*?\*?([^*\n-]+)\*?\*?\s*[-–:]\s*([^?\n]+)\?/g;
  
  while ((match = bulletPattern.exec(content)) !== null) {
    const label = match[1].trim();
    const optionsText = match[2].trim();
    
    const options = optionsText
      .split(/,|(?:\s+ou\s+)/)
      .map(opt => opt.trim())
      .filter(opt => opt.length > 0 && opt.length < 50);
    
    if (options.length >= 2) {
      questions.push({
        id: `qb${questions.length}`,
        label,
        options,
      });
    }
  }
  
  return questions;
}

export function InteractiveQuestions({ questions, onAnswer, disabled }: InteractiveQuestionsProps) {
  if (questions.length === 0) return null;
  
  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Cliquez pour répondre :
      </p>
      {questions.map((question) => (
        <div key={question.id} className="space-y-2">
          <p className="text-sm font-medium text-foreground">{question.label}</p>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onAnswer(question.id, option)}
                className={cn(
                  "h-auto py-2 px-3 text-xs whitespace-normal text-left",
                  "hover:bg-accent hover:text-accent-foreground",
                  "border-accent/30 hover:border-accent"
                )}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
