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
  
  // Split content into lines
  const lines = content.split('\n');
  
  let currentQuestion: { label: string; options: string[] } | null = null;
  let questionIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect question line (starts with ** and ends with ** or ?)
    // Pattern: **Question text** or **Question text ?**
    const questionMatch = line.match(/^\*\*([^*]+)\*\*\s*[-–]?\s*.*$/);
    if (questionMatch) {
      // Check if next lines have options (starting with -)
      const nextLinesAreOptions = [];
      for (let j = i + 1; j < lines.length && j < i + 10; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
          nextLinesAreOptions.push(nextLine.slice(2).trim());
        } else if (nextLine === '' || nextLine.startsWith('>')) {
          continue; // Skip empty lines or quote continuations
        } else if (nextLinesAreOptions.length > 0) {
          break; // Stop if we have options and hit non-option line
        }
      }
      
      if (nextLinesAreOptions.length >= 2) {
        // Save previous question if exists
        if (currentQuestion && currentQuestion.options.length >= 2) {
          questions.push({
            id: `q${questionIndex}`,
            label: currentQuestion.label,
            options: currentQuestion.options.filter(opt => opt.length > 0 && opt.length < 60),
          });
          questionIndex++;
        }
        
        currentQuestion = {
          label: questionMatch[1].replace(/\?$/, '').trim(),
          options: nextLinesAreOptions,
        };
      }
    }
  }
  
  // Add last question if exists
  if (currentQuestion && currentQuestion.options.length >= 2) {
    questions.push({
      id: `q${questionIndex}`,
      label: currentQuestion.label,
      options: currentQuestion.options.filter(opt => opt.length > 0 && opt.length < 60),
    });
  }
  
  // Fallback: Pattern for inline options after dash
  // e.g., "1. **Type spécifique** - Smartphone, téléphone basique, téléphone satellite ?"
  if (questions.length === 0) {
    const numberedPattern = /(\d+)\.\s*\*?\*?([^*\n-]+)\*?\*?\s*[-–:]\s*([^?\n]+)\?/g;
    let match;
    
    while ((match = numberedPattern.exec(content)) !== null) {
      const label = match[2].trim();
      const optionsText = match[3].trim();
      
      const options = optionsText
        .split(/,|(?:\s+ou\s+)/)
        .map(opt => opt.trim())
        .filter(opt => opt.length > 0 && opt.length < 60);
      
      if (options.length >= 2) {
        questions.push({
          id: `q${match[1]}`,
          label,
          options,
        });
      }
    }
  }
  
  return questions;
}

export function InteractiveQuestions({ questions, onAnswer, disabled }: InteractiveQuestionsProps) {
  if (questions.length === 0) return null;
  
  return (
    <div className="mt-4 pt-4 border-t border-border/20 space-y-3">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Sélectionnez une option
      </p>
      {questions.map((question) => (
        <div key={question.id} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {question.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onAnswer(question.id, option)}
                className={cn(
                  "h-auto py-2.5 px-4 text-sm whitespace-normal text-left rounded-xl",
                  "bg-background/50 hover:bg-accent/10 hover:text-accent-foreground",
                  "border-border/50 hover:border-accent/50",
                  "transition-all duration-200 hover:scale-[1.02] hover:shadow-sm",
                  "font-medium"
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
