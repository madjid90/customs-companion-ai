import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Bot, User, ThumbsUp, ThumbsDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "high" | "medium" | "low";
  feedback?: "up" | "down";
  conversationId?: string;
}

const confidenceIcons = {
  high: "🟢",
  medium: "🟡",
  low: "🔴",
};

const confidenceLabels = {
  high: "Confiance haute",
  medium: "Confiance moyenne",
  low: "Confiance faible",
};

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
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
    if (!messageText || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { question: messageText, sessionId },
      });

      if (error) throw error;

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        confidence: data.confidence as "high" | "medium" | "low",
        conversationId: data.conversationId,
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

      // Add error message to chat
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

    // Update feedback in database
    try {
      await supabase
        .from('conversations')
        .update({ rating: type === "up" ? 5 : 1 })
        .eq('id', message.conversationId);
    } catch (error) {
      console.error("Feedback error:", error);
    }
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {suggestedQuestions.map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="text-left h-auto py-3 px-4 justify-start"
                    onClick={() => handleSend(q)}
                  >
                    <Sparkles className="h-4 w-4 mr-2 text-accent flex-shrink-0" />
                    <span className="text-sm">{q}</span>
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
                  "max-w-[80%] rounded-2xl px-4 py-3",
                  message.role === "user"
                    ? "bg-chat-user text-chat-user-foreground rounded-br-md"
                    : "bg-chat-ai text-chat-ai-foreground rounded-bl-md"
                )}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.content}
                </p>

                {message.role === "assistant" && !message.content.startsWith("⚠️") && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                    {message.confidence && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        {confidenceIcons[message.confidence]} {confidenceLabels[message.confidence]}
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
                  <span>DouaneAI analyse votre question...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-card p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Posez votre question sur la douane..."
              className="min-h-[56px] max-h-32 pr-14 resize-none"
              rows={1}
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="absolute right-2 bottom-2 h-10 w-10 bg-accent hover:bg-accent/90"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            DouaneAI utilise la base de données officielle. Vérifiez toujours les informations importantes.
          </p>
        </div>
      </div>
    </div>
  );
}
