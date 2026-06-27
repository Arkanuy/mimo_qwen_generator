"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Layers, Cpu, Eye, Terminal as TerminalIcon, Wifi, WifiOff, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { PublicTerminal } from "@/components/dashboard/public-terminal";

const API = "";

interface BatchResult {
  email: string; status: "success" | "failed"; error: string | null; created_at: string; ultraspeed: boolean;
}

interface Batch {
  id: string;
  config: { count: number; headless: boolean; threads: number; seedCode: string };
  status: "idle" | "running" | "completed" | "stopped" | "error";
  progress: { current: number; total: number; success: number; failed: number };
  results: BatchResult[];
  logs: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export default function StatusPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin (for showing admin link)
  useEffect(() => {
    getMe().then(r => {
      if (r.ok && r.role === "admin") setIsAdmin(true);
    });
  }, []);

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/batch`);
      const data = await res.json();
      setBatches(data);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
    const interval = setInterval(fetchBatches, 2000);
    return () => clearInterval(interval);
  }, [fetchBatches]);

  useEffect(() => {
    if (!selectedBatch) return;
    const es = new EventSource(`${API}/api/logs?id=${selectedBatch}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.batch) setBatches(prev => prev.map(b => b.id === data.batch.id ? data.batch : b));
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [selectedBatch]);

  const totalSuccess = batches.reduce((s, b) => s + b.progress.success, 0);
  const totalFailed = batches.reduce((s, b) => s + b.progress.failed, 0);
  const runningCount = batches.filter(b => b.status === "running").length;
  const selectedBatchData = batches.find(b => b.id === selectedBatch);

  const StatusBadge = ({ status }: { status: Batch["status"] }) => {
    const m: Record<string, { bg: string; text: string; border: string; label: string }> = {
      running: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30", label: "Running" },
      completed: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", label: "Completed" },
      stopped: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", label: "Stopped" },
      error: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", label: "Error" },
      idle: { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border/30", label: "Idle" },
    };
    const s = m[status] || m.idle;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-medium ${s.bg} ${s.border} ${s.text}`}>{s.label}</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">MiMo Register</h1>
              <span className="text-[10px] text-sky-400 font-mono bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-lg">Status</span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground ml-[22px]">Worker Status & Monitoring</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              {connected
                ? <><Wifi className="w-3 h-3 text-green-400" /><span className="text-green-400">Live</span></>
                : <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400">Offline</span></>
              }
            </div>
            {isAdmin && (
              <button onClick={() => router.push("/")}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/50 border border-border/50 px-3 py-1.5 rounded-lg">
                <Shield className="w-3 h-3" /> Admin Panel
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { icon: <Layers className="w-4 h-4 text-muted-foreground" />, label: "Total Batches", value: batches.length, cls: "text-foreground" },
            { icon: <Activity className="w-4 h-4 text-green-400" />, label: "Running", value: runningCount, cls: "text-green-400" },
            { icon: <Cpu className="w-4 h-4 text-green-400" />, label: "Total Success", value: totalSuccess, cls: "text-green-400" },
            { icon: <Cpu className="w-4 h-4 text-red-400" />, label: "Total Failed", value: totalFailed, cls: "text-red-400" },
          ].map((s, i) => (
            <div key={i} className="bg-card border border-border/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</span></div>
              <span className={`text-2xl font-bold font-mono ${s.cls}`}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Batch List */}
        <div className="relative border border-border/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-card mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-foreground/50" />
              <h2 className="text-sm font-medium">Workers</h2>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono border border-border/30">{batches.length}</span>
            </div>
          </div>

          {batches.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <TerminalIcon className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No workers running.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {batches.map((batch, idx) => (
                  <motion.div key={batch.id} layout
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04 } }}
                    exit={{ opacity: 0, scale: 0.97 }}>
                    <div onClick={() => setSelectedBatch(selectedBatch === batch.id ? null : batch.id)}
                      className={`relative bg-muted/40 border rounded-xl p-4 cursor-pointer transition-colors overflow-hidden ${
                        selectedBatch === batch.id ? "border-foreground/30 bg-muted/60" : "border-border/40 hover:border-border/70"
                      }`}>
                      <div className={`absolute inset-0 pointer-events-none bg-gradient-to-l ${
                        batch.status === "running" ? "from-green-500/[0.06]" : batch.status === "completed" ? "from-blue-500/[0.06]"
                        : batch.status === "error" ? "from-red-500/[0.06]" : "from-transparent"
                      } to-transparent`} style={{ backgroundSize: "25% 100%", backgroundPosition: "right", backgroundRepeat: "no-repeat" }} />
                      <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-bold text-muted-foreground/60">{String(idx + 1).padStart(2, "0")}</span>
                          <StatusBadge status={batch.status} />
                          {batch.status === "running" && <span className="text-[10px] text-green-400 animate-pulse">●</span>}
                        </div>
                        <div className="flex-1 min-w-[120px] max-w-[260px]">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden border border-border/30">
                              <motion.div className={`h-full rounded-full ${batch.status === "running" ? "bg-green-500/70" : "bg-foreground/60"}`}
                                initial={{ width: 0 }} animate={{ width: `${batch.progress.total > 0 ? (batch.progress.current / batch.progress.total) * 100 : 0}%` }} />
                            </div>
                            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{batch.progress.current}/{batch.progress.total}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="text-green-400 font-mono">✓ {batch.progress.success}</span>
                          <span className="text-red-400 font-mono">✗ {batch.progress.failed}</span>
                          <span className="font-mono">{batch.startedAt ? new Date(batch.startedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
                          <Eye className="w-3 h-3 opacity-50" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Terminal */}
        <AnimatePresence>
          {selectedBatchData && (
            <PublicTerminal logs={selectedBatchData.logs} batchId={selectedBatchData.id} onClose={() => setSelectedBatch(null)} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
