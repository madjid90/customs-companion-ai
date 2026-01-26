import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Bot, User, ThumbsUp, ThumbsDown, Loader2, Sparkles, Database, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { ImageUploadButton, type UploadedFile } from "@/components/chat/ImageUploadButton";
import { InteractiveQuestions, parseQuestionsFromResponse } from "@/components/chat/InteractiveQuestions";

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

const confidenceConfig = {
  high: { icon: "🟢", label: "Confiance haute", className: "text-success" },
  medium: { icon: "🟡", label: "Confiance moyenne", className: "text-warning" },
  low: { icon: "🔴", label: "Confiance faible", className: "text-destructive" },
};

// Convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
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
  const [sessionId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (initialQuery && messages.length === 0) {
      handleSend(initialQuery);
      setInput("");
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if ((!messageText && uploadedFiles.length === 0) || isLoading) return;

    // Convert uploaded files to base64 for sending
    const imagesToSend: { type: "image"; base64: string; mediaType: string }[] = [];
    if (uploadedFiles.length > 0) {
      setIsUploading(true);
      for (const upload of uploadedFiles) {
        try {
          const base64 = await fileToBase64(upload.file);
          const mediaType = upload.file.type || "image/jpeg";
          imagesToSend.push({ type: "image", base64, mediaType });
        } catch (err) {
          console.error("Failed to convert file:", err);
        }
      }
      setIsUploading(false);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText || (uploadedFiles.length > 0 ? `📎 ${uploadedFiles.length} fichier(s) uploadé(s)` : ""),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setUploadedFiles([]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { 
          question: messageText || "Identifie ce produit et donne-moi le code SH approprié", 
          sessionId,
          images: imagesToSend.length > 0 ? imagesToSend : undefined,
        },
      });

      if (error) throw error;

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
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const suggestedQuestions = [
    "Comment classifier un smartphone ?",
    "Quels sont les droits de douane sur les voitures au Maroc ?",
    "Le code 8517.12 est-il contrôlé ?",
    "Calculer les droits pour 10000 USD de textiles",
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Chat messages area */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-12 animate-fade-in">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-accent/10 mb-6">
                <Bot className="h-10 w-10 text-accent" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Bienvenue sur DouaneAI
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-8">
                Posez votre question sur la classification douanière, les tarifs, 
                ou les réglementations commerciales.
              </p>

              {/* Suggested questions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
                {suggestedQuestions.map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="text-left h-auto py-3 px-4 justify-start whitespace-normal"
                    onClick={() => handleSend(q)}
                  >
                    <Sparkles className="h-4 w-4 mr-2 text-accent flex-shrink-0" />
                    <span className="text-sm text-left">{q}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-4 animate-slide-up",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-accent" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-5 py-4",
                  message.role === "user"
                    ? "bg-chat-user text-chat-user-foreground rounded-br-md"
                    : "bg-chat-ai text-chat-ai-foreground rounded-bl-md"
                )}
              >
                {message.role === "assistant" && !message.content.startsWith("⚠️") ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>,
                        ul: ({ children }) => <ul className="my-2 space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="my-2 space-y-1 list-decimal pl-4">{children}</ol>,
                        li: ({ children }) => <li className="text-sm">{children}</li>,
                        p: ({ children }) => <p className="text-sm leading-relaxed my-2">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-3">
                            <table className="min-w-full text-sm border-collapse">{children}</table>
                          </div>
                        ),
                        th: ({ children }) => <th className="border border-border px-2 py-1 bg-muted font-medium text-left">{children}</th>,
                        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    
                    {/* Interactive questions - only show for the last assistant message */}
                    {messages[messages.length - 1]?.id === message.id && (
                      <InteractiveQuestions
                        questions={parseQuestionsFromResponse(message.content)}
                        onAnswer={(questionId, answer) => {
                          handleSend(answer);
                        }}
                        disabled={isLoading}
                      />
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>
                )}

                {message.role === "assistant" && !message.content.startsWith("⚠️") && (
                  <div className="mt-4 pt-3 border-t border-border/50">
                    {/* Context info */}
                    {message.context && (message.context.hs_codes_found > 0 || message.context.tariffs_found > 0 || message.context.controlled_found > 0) && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {message.context.hs_codes_found > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
                            <Database className="h-3 w-3" />
                            {message.context.hs_codes_found} codes SH
                          </span>
                        )}
                        {message.context.tariffs_found > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
                            <Database className="h-3 w-3" />
                            {message.context.tariffs_found} tarifs
                          </span>
                        )}
                        {message.context.controlled_found > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-warning/20 text-warning px-2 py-1 rounded-full">
                            <AlertTriangle className="h-3 w-3" />
                            {message.context.controlled_found} contrôles
                          </span>
                        )}
                        {message.context.pdfs_used > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
                            <FileText className="h-3 w-3" />
                            {message.context.pdfs_used} PDFs
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      {message.confidence && (
                        <span className={cn("text-xs flex items-center gap-1", confidenceConfig[message.confidence].className)}>
                          {confidenceConfig[message.confidence].icon} {confidenceConfig[message.confidence].label}
                        </span>
                      )}
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7",
                            message.feedback === "up" && "text-success bg-success/10"
                          )}
                          onClick={() => handleFeedback(message.id, "up")}
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7",
                            message.feedback === "down" && "text-destructive bg-destructive/10"
                          )}
                          onClick={() => handleFeedback(message.id, "down")}
                        >
                          <ThumbsDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {message.role === "user" && (
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4 animate-fade-in">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-accent" />
              </div>
              <div className="bg-chat-ai text-chat-ai-foreground rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Recherche dans la base de données et analyse...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-card p-4">
        <div className="max-w-3xl mx-auto">
          {/* Uploaded files preview */}
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted/50 rounded-lg">
              {uploadedFiles.map((upload, index) => (
                <div
                  key={index}
                  className="relative group flex items-center gap-2 bg-background rounded-md p-2 pr-8 border"
                >
                  {upload.type === "image" ? (
                    <img
                      src={upload.preview}
                      alt="Preview"
                      className="w-12 h-12 object-cover rounded"
                    />
                  ) : (
                    <div className="w-12 h-12 flex items-center justify-center bg-muted rounded">
                      <FileText className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                    {upload.file.name}
                  </span>
                  <button
                    onClick={() => handleRemoveFile(index)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    disabled={isLoading || isUploading}
                  >
                    <span className="sr-only">Remove</span>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex items-end gap-2">
            <ImageUploadButton
              onFilesSelected={handleFilesSelected}
              uploadedFiles={[]}
              onRemoveFile={handleRemoveFile}
              disabled={isLoading}
              isUploading={isUploading}
            />
            <div className="relative flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={uploadedFiles.length > 0 
                  ? "Décrivez votre produit ou posez une question..." 
                  : "Posez votre question sur la douane..."}
                className="min-h-[56px] max-h-32 pr-14 resize-none"
                rows={1}
              />
              <Button
                onClick={() => handleSend()}
                disabled={(!input.trim() && uploadedFiles.length === 0) || isLoading || isUploading}
                size="icon"
                className="absolute right-2 bottom-2 h-10 w-10 bg-accent hover:bg-accent/90"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            📷 Uploadez une photo de produit, facture ou fiche technique pour une classification automatique.
          </p>
        </div>
      </div>
    </div>
  );
}
