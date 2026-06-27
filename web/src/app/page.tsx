"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { BatchTable } from "@/components/dashboard/batch-table";
import { LogTerminal } from "@/components/dashboard/terminal";
import { ConfigPanel } from "@/components/dashboard/config-panel";
import { Activity, Layers, Cpu, LogOut, Users, Mail } from "lucide-react";
import { getMe, logout } from "@/lib/auth";

const API = "";

interface BatchResult {
  email: string; password: string; apiKey: string | null;
  passToken: string | null; cUserId: string | null; userId: string | null;
  status: "success" | "failed"; ultraspeed: boolean; error: string | null; created_at: string;
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

export default function Dashboard() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) {
        router.push("/login");
      } else {
        setRole(r.role || null);
        // public users can stay on admin page if they want
        setAuthChecked(true);
      }
    });
  }, [router]);

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/batches`, { credentials: "include" });
      const data = await res.json();
      setBatches(data);
      setIsRunning(data.some((b: Batch) => b.status === "running"));
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    fetchBatches();
    const interval = setInterval(fetchBatches, 2000);
    return () => clearInterval(interval);
  }, [fetchBatches, authChecked]);

  useEffect(() => {
    if (!selectedBatch) return;
    const es = new EventSource(`${API}/api/logs?id=${selectedBatch}`, { withCredentials: true } as EventSourceInit);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.batch) setBatches(prev => prev.map(b => b.id === data.batch.id ? data.batch : b));
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [selectedBatch]);

  const handleStart = async (config: {
    count: number; headless: boolean; threads: number; seedCode: string;
    password: string; captchaProvider: string; captchaApiKey: string; tempmailUrl: string;
  }) => {
    try {
      const res = await fetch(`${API}/api/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(config),
      });
      const batch = await res.json();
      setSelectedBatch(batch.id);
      fetchBatches();
    } catch (e) {
      console.error("Failed to start batch:", e);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await fetch(`${API}/api/batch`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ id, action: "stop" }),
      });
      fetchBatches();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API}/api/batch`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ id }),
      });
      if (selectedBatch === id) setSelectedBatch(null);
      fetchBatches();
    } catch {}
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const selectedBatchData = batches.find(b => b.id === selectedBatch);
  const liveLogs = selectedBatchData?.logs || [];

  const totalSuccess = batches.reduce((s, b) => s + b.progress.success, 0);
  const totalFailed = batches.reduce((s, b) => s + b.progress.failed, 0);
  const runningCount = batches.filter(b => b.status === "running").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">MiMo Register</h1>
              <span className="text-[10px] text-orange-400 font-mono bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-lg">Admin</span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground ml-[22px]">Xiaomi MiMo Auto-Registration Dashboard</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" /><span className="font-mono">{batches.length}</span><span className="hidden sm:inline">batches</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm text-green-400">
              <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4" /><span className="font-mono">{totalSuccess}</span><span className="hidden sm:inline">success</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm text-red-400">
              <Cpu className="w-3.5 h-3.5 sm:w-4 sm:h-4" /><span className="font-mono">{totalFailed}</span><span className="hidden sm:inline">failed</span>
            </div>
            {runningCount > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-1 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />{runningCount} running
              </div>
            )}
            <button onClick={() => router.push("/tempmail")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/50 border border-border/50 px-3 py-1.5 rounded-lg">
              <Mail className="w-3 h-3" /> Tempmail
            </button>
            <button onClick={() => router.push("/status")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/50 border border-border/50 px-3 py-1.5 rounded-lg">
              <Users className="w-3 h-3" /> Public
            </button>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/50 border border-border/50 px-3 py-1.5 rounded-lg">
              <LogOut className="w-3 h-3" /> Logout
            </button>
          </div>
        </div>

        {/* Config Panel */}
        <div className="relative border border-border/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-card mb-4 sm:mb-6">
          <div className="flex items-center gap-2 mb-4 sm:mb-5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <h2 className="text-sm font-medium">New Batch</h2>
          </div>
          <ConfigPanel onStart={handleStart} isRunning={isRunning} />
        </div>

        {/* Batch List */}
        <div className="relative border border-border/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-card mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-foreground/50" />
              <h2 className="text-sm font-medium">Batches</h2>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono border border-border/30">{batches.length}</span>
            </div>
            {isRunning && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Processing
              </div>
            )}
          </div>
          <BatchTable batches={batches} selectedBatch={selectedBatch} onSelect={setSelectedBatch} onStop={handleStop} onDelete={handleDelete} />


          {/* Terminal right below batch table */}
          <AnimatePresence>
            {selectedBatch && (
              <LogTerminal logs={liveLogs} batchId={selectedBatch} onClose={() => setSelectedBatch(null)} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
