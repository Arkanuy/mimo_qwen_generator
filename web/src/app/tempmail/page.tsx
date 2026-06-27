"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, RefreshCw, Copy, Check, ArrowLeft, X, Clock, User, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

interface TempmailMessage {
  id?: string;
  subject?: string;
  body?: string;
  text?: string;
  html?: string;
  from_address?: string;
  received_at?: string;
}

const PAGE_SIZE = 20;

export default function TempmailPage() {
  const router = useRouter();
  const [inboxes, setInboxes] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, TempmailMessage[]>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<{ addr: string; msg: TempmailMessage } | null>(null);
  const [expandedInbox, setExpandedInbox] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Reverse order: newest first
  const reversedInboxes = useMemo(() => [...inboxes].reverse(), [inboxes]);
  const totalPages = Math.ceil(reversedInboxes.length / PAGE_SIZE);
  const pagedInboxes = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return reversedInboxes.slice(start, start + PAGE_SIZE);
  }, [reversedInboxes, page]);

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
    if (expandedInbox === addr) { setExpandedInbox(null); return; }
    setExpandedInbox(addr);
    if (!messages[addr]) {
      try {
        const res = await fetch(`/api/tempmail/messages?addr=${encodeURIComponent(addr)}`, { credentials: "include" });
        const data = await res.json();
        setMessages(prev => ({ ...prev, [addr]: Array.isArray(data) ? data : [] }));
      } catch {}
    }
  };

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  };

  const stripHtml = (html: string) =>
    html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();

  useEffect(() => { fetchInboxes(); }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/")} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                <Mail className="w-5 h-5 text-purple-500" /> Tempmail Inbox
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sessionId ? `Session: ${sessionId.slice(0, 12)}...` : "No session"}
                {inboxes.length > 0 && ` · ${inboxes.length} inbox(es)`}
              </p>
            </div>
          </div>
          <button onClick={fetchInboxes} disabled={loading}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground bg-muted/50 border border-border/50 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {/* Empty state */}
        {inboxes.length === 0 && !loading && (
          <div className="text-center py-16 text-muted-foreground/50">
            <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No inboxes yet</p>
            <p className="text-xs mt-1">Start a batch to create temporary emails</p>
          </div>
        )}

        {/* Inbox list */}
        <div className="space-y-2">
          {pagedInboxes.map(addr => (
            <div key={addr} className="border border-border/30 rounded-xl overflow-hidden bg-card">
              {/* Inbox row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => fetchMessages(addr)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  <Mail className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-sm font-mono truncate">{addr}</span>
                  {messages[addr] && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">
                      {messages[addr].length}
                    </span>
                  )}
                </button>
                <button onClick={() => copyAddr(addr)} className="p-1.5 rounded-md hover:bg-muted/50 transition-colors shrink-0">
                  {copied === addr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                </button>
              </div>

              {/* Messages (lazy load on expand) */}
              <AnimatePresence>
                {expandedInbox === addr && messages[addr] && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border/20">
                    <div className="divide-y divide-border/10 max-h-72 overflow-y-auto">
                      {messages[addr].length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground/50">No messages</div>
                      )}
                      {messages[addr].map((msg, i) => (
                        <button key={i} onClick={() => setSelectedMsg({ addr, msg })}
                          className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors flex items-start gap-3">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{msg.subject || "(no subject)"}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {msg.received_at ? new Date(msg.received_at).toLocaleTimeString("en-US", { hour12: false }) : ""}
                              </span>
                            </div>
                            {msg.from_address && (
                              <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                                <User className="w-2.5 h-2.5" /> {msg.from_address}
                              </span>
                            )}
                            <p className="text-xs text-muted-foreground/50 mt-1 truncate">
                              {stripHtml(msg.body || msg.text || msg.html || "").substring(0, 120)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/20">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 border border-border/50 px-3 py-2 rounded-lg disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <span className="text-xs text-muted-foreground font-mono">
              Page {page} / {totalPages} · {inboxes.length} total
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 border border-border/50 px-3 py-2 rounded-lg disabled:opacity-30 transition-colors">
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Message Detail Modal */}
      <AnimatePresence>
        {selectedMsg && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedMsg(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border/40 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold truncate">{selectedMsg.msg.subject || "(no subject)"}</h3>
                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    {selectedMsg.msg.from_address && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" /> {selectedMsg.msg.from_address}</span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> {selectedMsg.addr}</span>
                    {selectedMsg.msg.received_at && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(selectedMsg.msg.received_at).toLocaleString()}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedMsg(null)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors ml-3">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <pre className="text-sm leading-relaxed whitespace-pre-wrap break-words font-mono">
                  {stripHtml(selectedMsg.msg.body || selectedMsg.msg.text || selectedMsg.msg.html || "(empty)")}
                </pre>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/30 shrink-0">
                <button onClick={() => navigator.clipboard.writeText(stripHtml(selectedMsg.msg.body || selectedMsg.msg.text || selectedMsg.msg.html || ""))}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 border border-border/50 px-3 py-2 rounded-lg transition-colors">
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button onClick={() => setSelectedMsg(null)} className="text-xs bg-foreground text-background px-4 py-2 rounded-lg font-medium">Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
