"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { ShieldCheck, ArrowLeft, Loader2, CheckCircle, XCircle, AlertCircle, Upload } from "lucide-react";

interface CheckResult {
  apiKey: string;
  status: "valid" | "invalid" | "error" | "unknown";
  code?: number;
  error?: string;
}

export default function CheckerPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadFromMaster, setLoadFromMaster] = useState(false);

  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) { router.push("/login"); return; }
      setAuthChecked(true);
    });
  }, []);

  const loadMasterKeys = async () => {
    try {
      const res = await fetch("/api/master-keys");
      const data = await res.json();
      const keys = (data.keys || []).map((k: any) => k.apiKey).join("\n");
      setInput(keys);
      setLoadFromMaster(true);
    } catch {}
  };

  const checkKeys = async () => {
    const keys = input.split("\n").map(l => l.trim()).filter(l => l && l.startsWith("sk-"));
    if (keys.length === 0) return;
    setChecking(true);
    setResults([]);
    try {
      const res = await fetch("/api/checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch (e: any) {
      setResults(keys.map(k => ({ apiKey: k, status: "error", error: e.message })));
    }
    setChecking(false);
  };

  const validCount = results.filter(r => r.status === "valid").length;
  const invalidCount = results.filter(r => r.status === "invalid").length;
  const errorCount = results.filter(r => r.status === "error" || r.status === "unknown").length;

  const keyCount = input.split("\n").filter(l => l.trim().startsWith("sk-")).length;

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/")} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ShieldCheck className="w-6 h-6" />
          <h1 className="text-xl font-semibold">API Key Checker</h1>
        </div>

        {/* Input */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">
              Paste API keys (one per line) — {keyCount} key{keyCount !== 1 ? "s" : ""} detected
            </label>
            <button onClick={loadMasterKeys} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Load from Master Keys
            </button>
          </div>
          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); setLoadFromMaster(false); }}
            placeholder={"sk-xxxxxxxxxxxx\nsk-xxxxxxxxxxxx\nsk-xxxxxxxxxxxx"}
            rows={8}
            className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 resize-none"
          />
          <button
            onClick={checkKeys}
            disabled={checking || keyCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-50 transition-colors hover:opacity-90"
          >
            {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</> : <><ShieldCheck className="w-4 h-4" /> Check {keyCount} Key{keyCount !== 1 ? "s" : ""}</>}
          </button>
        </div>

        {/* Stats */}
        {results.length > 0 && (
          <div className="flex gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-400">{validCount} Valid</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">{invalidCount} Invalid</span>
            </div>
            {errorCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertCircle className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-yellow-400">{errorCount} Error</span>
              </div>
            )}
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">API Key</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Error</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.apiKey.substring(0, 20)}...</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                        r.status === "valid" ? "bg-green-500/10 text-green-400" :
                        r.status === "invalid" ? "bg-red-500/10 text-red-400" :
                        "bg-yellow-500/10 text-yellow-400"
                      }`}>
                        {r.status === "valid" ? <CheckCircle className="w-3 h-3" /> :
                         r.status === "invalid" ? <XCircle className="w-3 h-3" /> :
                         <AlertCircle className="w-3 h-3" />}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.code || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.error || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
