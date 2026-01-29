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
  const lines = content.split('\n');
  
  let questionIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Pattern 1: Question ending with ? followed by bold options
    // e.g., "Pourriez-vous me donner plus de détails ?" followed by "**Option 1**"
    if (line.endsWith('?') && !line.startsWith('-') && !line.startsWith('•') && !line.startsWith('**')) {
      const options: string[] = [];
      
      // Look for bold options in next lines
      for (let j = i + 1; j < lines.length && j < i + 15; j++) {
        const nextLine = lines[j].trim();
        
        // Match bold text: **Option text**
        const boldMatch = nextLine.match(/^\*\*([^*]+)\*\*$/);
        if (boldMatch) {
          const optionText = boldMatch[1].trim();
          if (optionText.length > 0 && optionText.length < 80) {
            options.push(optionText);
          }
        }
        // Match bullet points: - Option or • Option
        else if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
          const optionText = nextLine.slice(2).replace(/\*\*/g, '').trim();
          if (optionText.length > 0 && optionText.length < 80) {
            options.push(optionText);
          }
        }
        // Match numbered options: 1. Option
        else if (/^\d+\.\s+/.test(nextLine)) {
          const optionText = nextLine.replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').trim();
          if (optionText.length > 0 && optionText.length < 80) {
            options.push(optionText);
          }
        }
        // Stop if we hit empty line after collecting options, or non-option content
        else if (nextLine === '') {
          if (options.length > 0) continue;
        } else if (options.length >= 2) {
          break;
        }
      }
      
      if (options.length >= 2) {
        questions.push({
          id: `q${questionIndex}`,
          label: line.replace(/\?$/, '').trim(),
          options: options.slice(0, 6), // Max 6 options
        });
        questionIndex++;
      }
    }
    
    // Pattern 2: **Question text** followed by options
    const questionMatch = line.match(/^\*\*([^*]+)\*\*\s*[-–:]?\s*$/);
    if (questionMatch) {
      const options: string[] = [];
      
      for (let j = i + 1; j < lines.length && j < i + 15; j++) {
        const nextLine = lines[j].trim();
        
        if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
          const optionText = nextLine.slice(2).replace(/\*\*/g, '').trim();
          if (optionText.length > 0 && optionText.length < 80) {
            options.push(optionText);
          }
        } else if (/^\d+\.\s+/.test(nextLine)) {
          const optionText = nextLine.replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').trim();
          if (optionText.length > 0 && optionText.length < 80) {
            options.push(optionText);
          }
        } else if (nextLine === '') {
          if (options.length > 0) continue;
        } else if (options.length >= 2) {
          break;
        }
      }
      
      if (options.length >= 2) {
        questions.push({
          id: `q${questionIndex}`,
          label: questionMatch[1].replace(/\?$/, '').trim(),
          options: options.slice(0, 6),
        });
        questionIndex++;
      }
    }
  }
  
  // Fallback: inline options pattern
  if (questions.length === 0) {
    const inlinePattern = /([^.?!]+\?)\s*\n+((?:\*\*[^*]+\*\*\s*\n?)+)/g;
    let match;
    
    while ((match = inlinePattern.exec(content)) !== null) {
      const question = match[1].trim();
      const optionsBlock = match[2];
      const options = [...optionsBlock.matchAll(/\*\*([^*]+)\*\*/g)]
        .map(m => m[1].trim())
        .filter(opt => opt.length > 0 && opt.length < 80);
      
      if (options.length >= 2) {
        questions.push({
          id: `q${questionIndex}`,
          label: question.replace(/\?$/, '').trim(),
          options: options.slice(0, 6),
        });
        questionIndex++;
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
