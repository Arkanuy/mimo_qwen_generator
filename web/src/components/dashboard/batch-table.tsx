"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Square, Terminal, Eye, X, Copy, Check,
  Activity, HardDrive, Clock, Zap, AlertCircle, CheckCircle2
} from "lucide-react";

interface BatchResult {
  email: string; password: string; apiKey: string | null;
  passToken: string | null; cUserId: string | null; userId: string | null;
  status: "success" | "failed"; ultraspeed: boolean; error: string | null; created_at: string;
}

interface Batch {
  id: string;
  config: { count: number; headless: boolean; threads: number; seedCode: string }; generator?: string;
  status: "idle" | "running" | "completed" | "stopped" | "error";
  progress: { current: number; total: number; success: number; failed: number };
  results: BatchResult[];
  logs: string[];
  startedAt: string | null;
  completedAt: string | null;
}

interface BatchTableProps {
  batches: Batch[];
  selectedBatch: string | null;
  onSelect: (id: string | null) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}

const API = "";

function StatusBadge({ status }: { status: Batch["status"] }) {
  const m: Record<string, { bg: string; text: string; border: string; label: string }> = {
    running:   { bg: "bg-green-500/10",  text: "text-green-400",  border: "border-green-500/30",  label: "Running" },
    completed: { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/30",   label: "Completed" },
    stopped:   { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", label: "Stopped" },
    error:     { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/30",    label: "Error" },
    idle:      { bg: "bg-muted/50",      text: "text-muted-foreground", border: "border-border/30", label: "Idle" },
  };
  const s = m[status] || m.idle;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-medium ${s.bg} ${s.border} ${s.text}`}>
      {s.label}
    </span>
  );
}

function ProgressBar({ current, total, status }: { current: number; total: number; status: string }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden border border-border/30 min-w-[60px]">
        <motion.div
          className={`h-full rounded-full ${status === "running" ? "bg-green-500/70" : status === "error" ? "bg-red-500/70" : "bg-foreground/60"}`}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{current}/{total}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 hover:bg-muted/80 rounded transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

function DownloadBtn({ id, type, label }: { id: string; type: "txt" | "json"; label: string }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); window.open(`${API}/api/download?id=${id}&type=${type}`, "_blank"); }}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 hover:bg-muted/80 text-foreground border border-border/50 rounded-lg text-xs font-medium transition-colors active:scale-[0.97]">
      <Download className="w-3 h-3" />{label}
    </button>
  );
}

/* ── Detail Overlay ────────────────────────────────────────── */
function BatchDetailOverlay({ batch, onClose, onStop }: {
  batch: Batch; onClose: () => void; onStop: (id: string) => void;
}) {
  const [tab, setTab] = useState<"logs" | "results">("logs");
  const logs = batch.logs;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      className="absolute inset-0 bg-background/80 backdrop-blur-md flex flex-col rounded-2xl z-20 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border/30 bg-gradient-to-r from-muted/40 to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <Activity className={`w-5 h-5 shrink-0 ${batch.status === "running" ? "text-green-400 animate-pulse" : "text-muted-foreground"}`} />
          <h3 className="text-base sm:text-lg font-bold text-foreground">Batch Detail</h3>
          <StatusBadge status={batch.status} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {batch.status === "running" && (
            <button onClick={() => onStop(batch.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium transition-colors">
              <Square className="w-3 h-3" /> Stop
            </button>
          )}
          <DownloadBtn id={batch.id} type="txt" label="apiKey.txt" />
          <DownloadBtn id={batch.id} type="json" label="results.json" />
          <button onClick={onClose}
            className="w-8 h-8 bg-background/80 hover:bg-background rounded-full flex items-center justify-center border border-border/50">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-border/20">
        <div className="bg-muted/30 rounded-xl p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1"><Zap className="w-3 h-3 text-green-400" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Success</span></div>
          <span className="text-xl font-bold font-mono text-green-400">{batch.progress.success}</span>
        </div>
        <div className="bg-muted/30 rounded-xl p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1"><AlertCircle className="w-3 h-3 text-red-400" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</span></div>
          <span className="text-xl font-bold font-mono text-red-400">{batch.progress.failed}</span>
        </div>
        <div className="bg-muted/30 rounded-xl p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1"><HardDrive className="w-3 h-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Progress</span></div>
          <span className="text-xl font-bold font-mono text-foreground">{batch.progress.current}/{batch.progress.total}</span>
        </div>
        <div className="bg-muted/30 rounded-xl p-3 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1"><Clock className="w-3 h-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Started</span></div>
          <span className="text-sm font-medium text-foreground">{batch.startedAt ? new Date(batch.startedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button onClick={() => setTab("logs")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === "logs" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          <Terminal className="w-3 h-3 inline mr-1.5" />Logs ({logs.length})
        </button>
        <button onClick={() => setTab("results")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === "results" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          <CheckCircle2 className="w-3 h-3 inline mr-1.5" />Results ({batch.results.length})
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 p-4 overflow-hidden min-h-0">
        {tab === "logs" ? (
          <div className="h-full bg-black/60 rounded-xl border border-border/30 overflow-hidden">
            <div className="h-full overflow-y-auto p-4 font-mono text-[11px] leading-[1.8] terminal-scroll">
              {logs.length === 0
                ? <div className="text-muted-foreground/40 flex items-center gap-2"><Terminal className="w-4 h-4" /> Waiting for logs…</div>
                : logs.map((l, i) => (
                    <div key={i} className={
                      l.includes("✅") || l.includes("✓") ? "text-green-400"
                      : l.includes("❌") || l.includes("Fatal") ? "text-red-400"
                      : l.includes("⚠") ? "text-yellow-400"
                      : l.includes("---") ? "text-blue-400 font-semibold"
                      : l.includes("Email:") ? "text-cyan-400"
                      : l.includes("Done") ? "text-green-300 font-semibold"
                      : "text-zinc-400"
                    }>{l}</div>
                  ))
              }
              <div className="h-1" />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto space-y-2 pr-1">
            {batch.results.length === 0
              ? <div className="text-center py-16 text-muted-foreground"><CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-30" /><p className="text-sm">No results yet.</p></div>
              : batch.results.map((r, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className={`bg-muted/40 border rounded-xl p-3.5 ${r.status === "success" ? "border-green-500/20" : "border-red-500/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{r.email || "—"}</div>
                          {r.apiKey && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px] sm:max-w-[320px]">{r.apiKey}</span>
                              <CopyButton text={r.apiKey} />
                            </div>
                          )}
                          {r.error && <div className="text-[10px] text-red-400 mt-1">{r.error}</div>}
                        </div>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-medium ${
                        r.status === "success" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
                      }`}>{r.status}</span>
                    </div>
                  </motion.div>
                ))
            }
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ── Main Batch Table ──────────────────────────────────────── */
export function BatchTable({ batches, selectedBatch, onSelect, onStop, onDelete }: BatchTableProps) {
  const selected = batches.find(b => b.id === selectedBatch);

  if (batches.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Terminal className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm">No batches yet. Configure and start a batch above.</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-2">
      <AnimatePresence mode="popLayout">
        {batches.map((batch, idx) => (
          <motion.div key={batch.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04 } }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
            className="relative">
            <motion.div
              onClick={() => onSelect(selectedBatch === batch.id ? null : batch.id)}
              className={`relative bg-muted/40 border rounded-xl p-4 cursor-pointer transition-colors overflow-hidden ${
                selectedBatch === batch.id ? "border-foreground/30 bg-muted/60" : "border-border/40 hover:border-border/70"
              }`}
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              {/* Gradient */}
              <div className={`absolute inset-0 pointer-events-none bg-gradient-to-l ${
                batch.status === "running" ? "from-green-500/[0.06]" : batch.status === "completed" ? "from-blue-500/[0.06]"
                : batch.status === "error" ? "from-red-500/[0.06]" : batch.status === "stopped" ? "from-yellow-500/[0.06]" : "from-transparent"
              } to-transparent`} style={{ backgroundSize: "25% 100%", backgroundPosition: "right", backgroundRepeat: "no-repeat" }} />

              <div className="relative">
                {/* ── Desktop Row ── */}
                <div className="hidden md:flex items-center gap-6">
                  {/* Number */}
                  <div className="w-10 shrink-0">
                    <span className="text-2xl font-bold text-muted-foreground/60">{String(idx + 1).padStart(2, "0")}</span>
                  </div>

                  {/* Status */}
                  <div className="w-24 shrink-0">
                    <StatusBadge status={batch.status} />
                    {batch.generator === "qwencloud" && (
                      <span className="text-[9px] text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded font-mono">Qwen</span>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="flex-1 min-w-[140px] max-w-[260px]">
                    <ProgressBar current={batch.progress.current} total={batch.progress.total} status={batch.status} />
                  </div>

                  {/* Results */}
                  <div className="w-20 shrink-0 flex items-center gap-1.5">
                    <span className="text-sm font-mono text-green-400 font-medium">{batch.progress.success}</span>
                    <span className="text-muted-foreground text-xs">/</span>
                    <span className="text-sm font-mono text-red-400 font-medium">{batch.progress.failed}</span>
                  </div>

                  {/* Started */}
                  <div className="w-20 shrink-0">
                    <span className="text-xs text-muted-foreground font-mono">
                      {batch.startedAt ? new Date(batch.startedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {batch.status === "running" && (
                      <button onClick={e => { e.stopPropagation(); onStop(batch.id); }}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors" title="Stop">
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <DownloadBtn id={batch.id} type="txt" label="apiKey.txt" />
                    <DownloadBtn id={batch.id} type="json" label="results.json" />
                    <button onClick={e => { e.stopPropagation(); onSelect(batch.id); }}
                      className="p-2 rounded-lg bg-muted hover:bg-muted/80 border border-border/50 transition-colors" title="Details">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {(batch.status !== "running" && batch.status !== "idle") && (
                      <button onClick={e => { e.stopPropagation(); onDelete(batch.id); }}
                        className="p-2 rounded-lg bg-muted hover:bg-red-500/10 border border-border/50 hover:border-red-500/30 transition-colors group" title="Delete">
                        <X className="w-3.5 h-3.5 text-muted-foreground group-hover:text-red-400" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Mobile Card ── */}
                <div className="md:hidden space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg font-bold text-muted-foreground/60">{String(idx + 1).padStart(2, "0")}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {batch.status === "running" && (
                        <button onClick={e => { e.stopPropagation(); onStop(batch.id); }}
                          className="p-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30">
                          <Square className="w-3 h-3" />
                        </button>
                      )}
                      <DownloadBtn id={batch.id} type="txt" label="apiKey.txt" />
                      <DownloadBtn id={batch.id} type="json" label="results.json" />
                      <button onClick={e => { e.stopPropagation(); onSelect(batch.id); }}
                        className="p-1.5 rounded-md bg-muted hover:bg-muted/80 border border-border/50">
                        <Eye className="w-3 h-3" />
                      </button>
                      {(batch.status !== "running" && batch.status !== "idle") && (
                        <button onClick={e => { e.stopPropagation(); onDelete(batch.id); }}
                          className="p-1.5 rounded-md bg-muted hover:bg-red-500/10 border border-border/50">
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                  <ProgressBar current={batch.progress.current} total={batch.progress.total} status={batch.status} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-mono">✓ {batch.progress.success}</span>
                      <span className="text-red-400 font-mono">✗ {batch.progress.failed}</span>
                    </div>
                    <span className="font-mono">{batch.startedAt ? new Date(batch.startedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Overlay removed — LogTerminal handles all batch detail views */}
    </div>
  );
}
