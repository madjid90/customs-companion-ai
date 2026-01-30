import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ChatMessage, ChatTypingIndicator } from "@/components/chat/ChatMessage";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatHistory } from "@/components/chat/ChatHistory";
import { cn } from "@/lib/utils";
import type { UploadedFile } from "@/components/chat/ImageUploadButton";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "high" | "medium" | "low";
  feedback?: "up" | "down";
  conversationId?: string;
  context?: {
    hs_codes_found: number;
    tariffs_found: number;
    controlled_found: number;
    documents_found: number;
    pdfs_used: number;
  };
}

// Remove confidence indicators, emojis, and decorative icons from AI response content
const cleanConfidenceFromContent = (content: string): string => {
  let cleaned = content
    // Remove confidence indicators
    .replace(/^[🟢🟡🔴]\s*\*?\*?Confiance[^]*?\n/gim, '')
    .replace(/[🟢🟡🔴]\s*\*?\*?Confiance\s*(haute|moyenne|faible|élevée)[^]*?(?=\n\n|\n##|\n\*\*|$)/gim, '')
    .replace(/^\*?\*?Niveau de confiance\s*:\s*(élevé|moyen|faible)[^\n]*\n?/gim, '')
    .replace(/^\*?\*?Confiance\s*:\s*(haute|moyenne|faible|élevée)[^\n]*\n?/gim, '')
    .replace(/^[❓❔ℹ️🔍]\s*$/gm, '')
    .replace(/\n[❓❔]\s*\n/g, '\n')
    // Remove ALL emojis from the response
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{203C}\u{2049}]|[\u{20E3}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[✅✓✔️❌❎⚠️ℹ️📁📂📄📥📜🔗💡🎯🚨]/gu, '')
    // Remove raw JSON blocks that shouldn't be displayed
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/"[a-z_]+"\s*:\s*(?:"[^"]*"|[0-9.]+|null|true|false)\s*,?/gi, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
};

// Remove interactive question options from content (they're shown as buttons)
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

// Convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => {
    const stored = sessionStorage.getItem('chat_session_id');
    if (stored) return stored;
    const newId = crypto.randomUUID();
    sessionStorage.setItem('chat_session_id', newId);
    return newId;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Handle loading a previous session
  const handleSelectSession = useCallback((newSessionId: string, loadedMessages: Array<{ role: "user" | "assistant"; content: string; conversationId?: string }>) => {
    // Update session ID
    setSessionId(newSessionId);
    sessionStorage.setItem('chat_session_id', newSessionId);
    
    // Convert to Message format
    const formattedMessages: Message[] = loadedMessages.map((msg, index) => ({
      id: `${Date.now()}-${index}`,
      role: msg.role,
      content: msg.content,
      conversationId: msg.conversationId,
    }));
    
    setMessages(formattedMessages);
    setIsHistoryOpen(false);
  }, []);

  // Start a new conversation
  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    setSessionId(newId);
    sessionStorage.setItem('chat_session_id', newId);
    setMessages([]);
    setInput("");
    setIsHistoryOpen(false);
  }, []);

  const hasProcessedInitialQuery = useRef(false);
  useEffect(() => {
    if (initialQuery && messages.length === 0 && !hasProcessedInitialQuery.current) {
      hasProcessedInitialQuery.current = true;
      handleSend(initialQuery);
      setInput("");
    }
  }, [initialQuery]);

  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
          });
        }
      }
    };
    
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, isLoading]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if ((!messageText && uploadedFiles.length === 0) || isLoading) return;

    const imagesToSend: { type: "image"; base64: string; mediaType: string }[] = [];
    const pdfsToSend: { type: "pdf"; base64: string; fileName: string }[] = [];
    const documentNames: string[] = [];
    
    if (uploadedFiles.length > 0) {
      setIsUploading(true);
      for (const upload of uploadedFiles) {
        try {
          // Images go to vision API
          if (upload.type === "image" && upload.file.type.startsWith("image/")) {
            const base64 = await fileToBase64(upload.file);
            const mediaType = upload.file.type || "image/jpeg";
            imagesToSend.push({ type: "image", base64, mediaType });
          } 
          // PDFs go to Claude's native PDF support
          else if (upload.file.type === "application/pdf") {
            const base64 = await fileToBase64(upload.file);
            pdfsToSend.push({ type: "pdf", base64, fileName: upload.file.name });
          }
          // Other documents just get mentioned by name
          else {
            documentNames.push(upload.file.name);
          }
        } catch (err) {
          console.error("Failed to convert file:", err);
        }
      }
      setIsUploading(false);
    }
    
    // Build context message for non-analyzed documents
    let enhancedMessage = messageText;
    if (documentNames.length > 0) {
      const docList = documentNames.join(", ");
      enhancedMessage = messageText 
        ? `${messageText} (Documents mentionnés: ${docList})`
        : `J'ai des questions concernant ces documents: ${docList}`;
    }

    // Build display message
    let displayContent = enhancedMessage;
    if (pdfsToSend.length > 0 && !displayContent) {
      displayContent = `📄 Analyse de ${pdfsToSend.length} document(s) PDF`;
    } else if (pdfsToSend.length > 0) {
      displayContent = `${displayContent} (+ ${pdfsToSend.length} PDF)`;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: displayContent || (uploadedFiles.length > 0 ? `📎 ${uploadedFiles.length} fichier(s) uploadé(s)` : ""),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setUploadedFiles([]);
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
      
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          question: enhancedMessage || "Analyse ce document et donne-moi les informations pertinentes",
          sessionId,
          images: imagesToSend.length > 0 ? imagesToSend : undefined,
          pdfDocuments: pdfsToSend.length > 0 ? pdfsToSend : undefined,
          conversationHistory,
        },
      });

      if (error) throw error;
      if (!data || !data.response) throw new Error("Réponse invalide du serveur");

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        confidence: data.confidence as "high" | "medium" | "low",
        conversationId: data.conversationId,
        context: data.context,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error: any) {
      console.error("Chat error:", error);
      
      let errorMessage = "Une erreur est survenue. Veuillez réessayer.";
      if (error.message?.includes("429")) {
        errorMessage = "Trop de requêtes. Veuillez patienter quelques instants.";
      } else if (error.message?.includes("402")) {
        errorMessage = "Limite d'utilisation atteinte.";
      }

      toast({
        title: "Erreur",
        description: errorMessage,
        variant: "destructive",
      });

      const errorMessageObj: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${errorMessage}`,
        confidence: "low",
      };
      setMessages((prev) => [...prev, errorMessageObj]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFeedback = async (messageId: string, type: "up" | "down") => {
    const message = messages.find(m => m.id === messageId);
    if (!message?.conversationId) return;

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, feedback: type } : msg
      )
    );

    try {
      await supabase
        .from('conversations')
        .update({ rating: type === "up" ? 5 : 1 })
        .eq('id', message.conversationId);
    } catch (error) {
      console.error("Feedback error:", error);
    }
  };

  const handleFilesSelected = (files: UploadedFile[]) => {
    setUploadedFiles((prev) => [...prev, ...files]);
  };

  const handleRemoveFile = (index: number) => {
    const fileToRemove = uploadedFiles[index];
    if (fileToRemove?.type === "image" && fileToRemove.preview.startsWith("blob:")) {
      URL.revokeObjectURL(fileToRemove.preview);
    }
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    return () => {
      uploadedFiles.forEach((file) => {
        if (file.type === "image" && file.preview.startsWith("blob:")) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, [uploadedFiles]);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-gradient-to-b from-background to-muted/20">
      {/* History sidebar */}
      <ChatHistory
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
      />

      {/* Main chat area */}
      <div 
        className={cn(
          "flex flex-col flex-1 transition-all duration-300",
          isHistoryOpen ? "ml-72" : "ml-0"
        )}
      >
        {/* Chat messages area */}
        <ScrollArea ref={scrollRef} className="flex-1 px-3 md:px-4 py-4">
          <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
            {messages.length === 0 && (
              <ChatWelcome onQuestionClick={handleSend} />
            )}

            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isLastMessage={index === messages.length - 1 && message.role === "assistant"}
                isLoading={isLoading}
                onFeedback={handleFeedback}
                onAnswer={handleSend}
                cleanContent={cleanConfidenceFromContent}
                removeQuestions={removeInteractiveQuestions}
              />
            ))}

            {isLoading && <ChatTypingIndicator />}
          </div>
        </ScrollArea>

        {/* Input area */}
        <ChatInput
          input={input}
          onInputChange={setInput}
          onSend={() => handleSend()}
          onKeyDown={handleKeyDown}
          isLoading={isLoading}
          isUploading={isUploading}
          uploadedFiles={uploadedFiles}
          onFilesSelected={handleFilesSelected}
          onRemoveFile={handleRemoveFile}
        />
      </div>
    </div>
  );
}
