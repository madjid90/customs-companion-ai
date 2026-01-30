import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Question {
  id: string;
  label: string;
  options: string[];
}

// Clean markdown from option text for display
const cleanMarkdown = (text: string): string => {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold **text**
    .replace(/\*([^*]+)\*/g, '$1')     // Remove italic *text*
    .replace(/__([^_]+)__/g, '$1')     // Remove bold __text__
    .replace(/_([^_]+)_/g, '$1')       // Remove italic _text_
    .replace(/`([^`]+)`/g, '$1')       // Remove code `text`
    .trim();
};

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
  
  let questionIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Check if this line is followed by a list of options (lines starting with -)
    const options: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j].trim();
      if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
        const optionText = nextLine.slice(2).trim();
        // Filter out very long options or empty ones
        if (optionText.length > 0 && optionText.length < 80) {
          options.push(optionText);
        }
      } else if (nextLine === '') {
        continue; // Skip empty lines between options
      } else {
        break; // Stop when we hit a non-option line
      }
    }
    
    // If we found at least 2 options and the current line looks like a question
    if (options.length >= 2) {
      // Check various question patterns:
      // 1. Line ends with ?
      // 2. Line is in bold: **Question**
      // 3. Line contains a colon before options
      const isQuestion = 
        line.endsWith('?') || 
        line.match(/^\*\*[^*]+\*\*/) ||
        (line.includes(':') && !line.startsWith('-'));
      
      if (isQuestion) {
        // Extract clean question label
        let label = line
          .replace(/^\*\*|\*\*$/g, '') // Remove bold markers
          .replace(/\?$/, '') // Remove trailing ?
          .replace(/:$/, '') // Remove trailing :
          .trim();
        
        // Don't add if label is too short or too long
        if (label.length > 5 && label.length < 200) {
          questions.push({
            id: `q${questionIndex}`,
            label,
            options: options.slice(0, 6), // Max 6 options
          });
          questionIndex++;
          
          // Skip past the options we just processed
          i = i + options.length;
        }
      }
    }
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
    <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-border/20 space-y-2 md:space-y-3">
      <p className="text-[10px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Sélectionnez une option
      </p>
      {questions.map((question) => (
        <div key={question.id} className="space-y-1.5 md:space-y-2">
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {question.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onAnswer(question.id, option)}
                className={cn(
                  "h-auto py-2 md:py-2.5 px-3 md:px-4 text-xs md:text-sm whitespace-normal text-left rounded-lg md:rounded-xl",
                  "bg-background/50 hover:bg-accent/10 hover:text-accent-foreground",
                  "border-border/50 hover:border-accent/50 active:scale-[0.98]",
                  "transition-all duration-200 hover:scale-[1.02] hover:shadow-sm",
                  "font-medium max-w-full"
                )}
              >
                {cleanMarkdown(option)}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
