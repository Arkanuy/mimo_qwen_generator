"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Inbox, ChevronDown, ChevronRight, RefreshCw, Copy, Check } from "lucide-react";

interface TempmailMessage {
  id?: string;
  subject?: string;
  body?: string;
  text?: string;
  from_address?: string;
  received_at?: string;
}

export function TempmailViewer() {
  const [inboxes, setInboxes] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, TempmailMessage[]>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchInboxes = async () => {
    setLoading(true);
    try {
      const sRes = await fetch("/api/tempmail/session", { credentials: "include" });
      const sData = await sRes.json();
      setSessionId(sData.sessionId);

      const res = await fetch("/api/tempmail/inboxes", { credentials: "include" });
      const data = await res.json();
      if (Array.isArray(data)) {
        setInboxes(data.map((i: { address?: string } | string) => typeof i === "string" ? i : i.address || String(i)));
      } else if (data.addresses) {
        setInboxes(data.addresses);
      }
    } catch {}
    setLoading(false);
  };

  const fetchMessages = async (addr: string) => {
    try {
      const res = await fetch(`/api/tempmail/messages?addr=${encodeURIComponent(addr)}`, { credentials: "include" });
      const data = await res.json();
      setMessages(prev => ({ ...prev, [addr]: Array.isArray(data) ? data : [] }));
    } catch {}
  };

  const toggleInbox = (addr: string) => {
    if (expanded === addr) { setExpanded(null); return; }
    setExpanded(addr);
    if (!messages[addr]) fetchMessages(addr);
  };

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  };

  useEffect(() => {
    if (open) fetchInboxes();
  }, [open]);

  return (
    <div className="relative border border-border/30 rounded-xl sm:rounded-2xl bg-card overflow-hidden">
      <div onClick={() => setOpen(!open)} role="button" tabIndex={0}
        className="w-full flex items-center justify-between p-4 sm:p-6 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <h2 className="text-sm font-medium">Tempmail Inbox</h2>
          {inboxes.length > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono border border-border/30">{inboxes.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sessionId && (
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:block">
              session: {sessionId.slice(0, 8)}...
            </span>
          )}
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{inboxes.length} inbox(es)</span>
                <button onClick={fetchInboxes} disabled={loading}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>

              {inboxes.length === 0 && !loading && (
                <div className="text-xs text-muted-foreground/50 py-4 text-center">No inboxes yet. Start a batch to create emails.</div>
              )}

              {inboxes.map(addr => (
                <div key={addr} className="border border-border/30 rounded-lg overflow-hidden">
                  <div onClick={() => toggleInbox(addr)} role="button" tabIndex={0}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-mono truncate">{addr}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); copyAddr(addr); }}
                        className="p-1 rounded hover:bg-muted/50 transition-colors">
                        {copied === addr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                      </button>
                      {messages[addr] && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded font-mono">{messages[addr].length}</span>
                      )}
                      {expanded === addr ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  </div>

                  <AnimatePresence>
                    {expanded === addr && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border/20">
                        <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                          {!messages[addr] && <div className="text-xs text-muted-foreground/50">Loading...</div>}
                          {messages[addr] && messages[addr].length === 0 && (
                            <div className="text-xs text-muted-foreground/50">No messages yet</div>
                          )}
                          {(messages[addr] || []).map((msg, i) => (
                            <div key={i} className="bg-muted/30 rounded-md p-2.5 border border-border/20">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-foreground truncate">{msg.subject || "(no subject)"}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                                  {msg.received_at ? new Date(msg.received_at).toLocaleTimeString("en-US", { hour12: false }) : ""}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all line-clamp-3">
                                {(msg.body || msg.text || "").replace(/<[^>]*>/g, "").substring(0, 200)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
