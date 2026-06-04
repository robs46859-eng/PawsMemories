import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Mic, MicOff, RefreshCw, Sparkles, Volume2, Award } from "lucide-react";
import { authedFetch } from "../api";

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  createdAt: Date;
}

interface RandyChatProps {
  onUnlockAchievement?: (id: string) => void;
  isDarkMode?: boolean;
}

export default function RandyChat({ onUnlockAchievement, isDarkMode }: RandyChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "initial",
      role: "model",
      text: "Woof! Welcome, friend! 🐾 I'm Randy, your golden retriever puppy guide! Need a tip on sculpting Clay style memories, taking the best pet camera photo, or claiming your achievements? Ask me anything! *wags tail*",
      createdAt: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  // Microphone / Speech Recognition status
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // Handle Speech Recognition
  const toggleSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice speech recognition is not supported in this browser version. Try Chrome or Safari!");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputValue((prev) => (prev ? prev + " " + transcript : transcript));
          // Unlock achievement for speech dictation use!
          if (onUnlockAchievement) {
            onUnlockAchievement("voice_use");
          }
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech Recognition Error:", e);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.error(err);
      setIsListening(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue;
    setInputValue("");
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-user`,
        role: "user",
        text: userText,
        createdAt: new Date(),
      },
    ]);
    setIsLoading(true);

    try {
      // Map previous messages to simple { role, text } history for server
      const chatHistory = messages.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await authedFetch("/api/randy-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history: chatHistory }),
      });

      if (!res.ok) {
        throw new Error("Failed to contact Randy's chat server.");
      }

      const data = await res.json();
      if (data.success && data.text) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-randy`,
            role: "model",
            text: data.text,
            createdAt: new Date(),
          },
        ]);
        
        // Unlock chatterbox achievement
        if (onUnlockAchievement) {
          onUnlockAchievement("randy_chat");
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-error`,
          role: "model",
          text: "Bow-wow... *barks with confusion* My signal leash got caught on something. Could you try sending that again?",
          createdAt: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-22 right-5 z-55 flex flex-col items-end pointer-events-none">
      
      {/* Expanded chat window */}
      {isOpen && (
        <div className="w-80 h-100 mb-3 bg-surface-container-low border border-outline-variant/50 rounded-3xl shadow-xl flex flex-col overflow-hidden pointer-events-auto animate-slide-up">
          {/* Header */}
          <div className="bg-primary/10 px-4 py-3 border-b border-outline-variant/30 flex justify-between items-center bg-radial from-amber-50 to-amber-100/30">
            <div className="flex items-center gap-2">
              <span className="text-2xl animate-bounce">🦮</span>
              <div>
                <h4 className="text-xs font-black text-on-surface flex items-center gap-1">
                  Randy the Vet AI Guide
                  <Sparkles size={11} className="text-orange-600 animate-pulse animate-duration-1000" />
                </h4>
                <p className="text-[9px] text-primary font-bold uppercase tracking-wider">Online &amp; Tail Wagging</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-on-surface-variant hover:text-on-surface p-1 rounded-full hover:bg-outline-variant/20 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages Area */}
          <div ref={scrollRef} className="flex-grow p-4 overflow-y-auto space-y-3.5 hide-scrollbar">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                }`}
              >
                <div
                  className={`px-3 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-white rounded-tr-none"
                      : "bg-surface-container-highest text-on-surface rounded-tl-none border border-outline-variant/20"
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[8px] text-on-surface-variant/65 mt-1 px-1">
                  {msg.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-on-surface-variant animate-pulse py-1">
                <RefreshCw size={12} className="animate-spin text-orange-600" />
                <span className="font-semibold italic">Randy is typing / sniffing...</span>
              </div>
            )}
          </div>

          {/* Input Panel */}
          <form onSubmit={handleSendMessage} className="p-3 border-t border-outline-variant/20 bg-surface-container">
            <div className="flex items-center gap-1.5 bg-white border border-outline-variant/40 rounded-xl p-1.5 pr-2 shadow-inner">
              <input
                type="text"
                placeholder={isListening ? "Listening... Speak now!" : "Ask Randy anything..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isListening}
                className="flex-grow px-2 py-1 text-xs focus:outline-none bg-transparent disabled:opacity-50"
              />
              
              {/* Mic Indicator button */}
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  isListening 
                    ? "bg-red-500 text-white animate-pulse" 
                    : "text-on-surface-variant hover:bg-outline-variant/20"
                }`}
                title={isListening ? "Stop listening" : "Dictate your message with microphone"}
              >
                {isListening ? <MicOff size={13} /> : <Mic size={13} />}
              </button>

              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="p-1.5 bg-primary text-white rounded-lg hover:bg-primary/95 disabled:opacity-30 transition-all cursor-pointer shadow-sm"
              >
                <Send size={12} />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Sparkly Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-gradient-to-tr from-amber-500 to-orange-400 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer pointer-events-auto relative group glow-orange-shadow"
      >
        {isOpen ? (
          <X size={24} className="animate-duration-300" />
        ) : (
          <>
            <span className="text-2xl animate-bounce">🦮</span>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white rounded-full text-[8.5px] font-extrabold flex items-center justify-center animate-pulse border border-white">
              AI
            </div>
            {/* tooltip */}
            <span className="absolute right-16 scale-0 group-hover:scale-100 transition-all duration-200 bg-slate-900/90 text-white text-[10px] py-1 px-2.5 rounded-xl font-bold whitespace-nowrap shadow border border-slate-700">
              Chat with Randy 🐾
            </span>
          </>
        )}
      </button>
    </div>
  );
}
