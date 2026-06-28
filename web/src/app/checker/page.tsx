"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { ShieldCheck, ArrowLeft, Loader2, CheckCircle, XCircle, DollarSign, Gift, RefreshCw, Upload } from "lucide-react";

interface CheckResult {
  email: string;
  status: string;
  balance: number | null;
  gift: number | null;
  frozen: number | null;
  cash: number | null;
  error?: string;
}

interface MasterKey {
  email: string;
  password: string;
  apiKey: string;
  cookies: { passToken: string | null; cUserId: string | null; userId: string | null };
  provider: string;
  created_at: string;
}

interface CheckerResponse {
  queueId?: string;
  total?: number;
  error?: string;
}

interface PollResponse {
  status?: string;
  progress?: { done?: number; total?: number };
  results?: Array<{
    email: string;
    status?: string;
    balance?: string | number;
    giftBalance?: string | number;
    gift?: string | number;
    frozenBalance?: string | number;
    frozen?: string | number;
    cashBalance?: string | number;
    cash?: string | number;
    error?: string;
  }>;
}

interface MasterKeysResponse {
  keys?: MasterKey[];
}

const PRICING = {
  pro: { cacheHit: 0.0036, cacheMiss: 0.435, output: 0.87 },
  std: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
};

function fmtNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' miliar';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' juta';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' ribu';
  return n.toLocaleString();
}

function estTokens(balance: number, pricePerToken: number): number {
  return Math.floor(balance / pricePerToken);
}

export default function CheckerPage() {
  const router = useRouter();
  const [results, setResults] = useState<CheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [statusText, setStatusText] = useState("");
  const [summary, setSummary] = useState({ totalBalance: 0, totalGift: 0, okCount: 0, errCount: 0 });
  const [authChecked, setAuthChecked] = useState(false);
  const [accounts, setAccounts] = useState<MasterKey[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMasterKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/master-keys");
      const data: MasterKeysResponse = await res.json();
      setAccounts((data.keys || []).filter((k: MasterKey) => k.provider === "mimo"));
    } catch {}
  }, []);

  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) { router.push("/login"); return; }
      setAuthChecked(true);
      loadMasterKeys();
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [router, loadMasterKeys]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const arr = Array.isArray(data) ? data : [data];
        setAccounts(arr.filter((k: { cookies?: { passToken?: string }; apiKey?: string }) => k.cookies?.passToken || k.apiKey));
      } catch { alert("Invalid JSON"); }
    };
    reader.readAsText(file);
  };

  const runChecker = useCallback(async () => {
    if (accounts.length === 0) return;
    setChecking(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    setSummary({ totalBalance: 0, totalGift: 0, okCount: 0, errCount: 0 });
    setStatusText("Submitting...");

    let queueId: string;
    try {
      const resp = await fetch("/api/checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data: CheckerResponse = await resp.json();
      if (data.error) {
        setStatusText(`Error: ${data.error}`);
        setChecking(false);
        return;
      }
      queueId = data.queueId!;
      setProgress({ done: 0, total: data.total || accounts.length });
      setStatusText(`Queue: ${queueId} — checking...`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusText(`Submit failed: ${msg}`);
      setChecking(false);
      return;
    }

    const STATUS_URL = `https://apikey.jimixz.tech/api/status/${queueId}`;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(STATUS_URL);
        const data: PollResponse = await resp.json();

        if (data.progress) {
          setProgress({ done: data.progress.done || 0, total: data.progress.total || 0 });
          setStatusText(`Checking... ${data.progress.done || 0}/${data.progress.total || 0}`);
        }

        if (data.status === "done" || data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);

          const rawResults = data.results || [];
          const normalized: CheckResult[] = rawResults.map((r) => {
            const bal = parseFloat(String(r.balance)) || 0;
            const gift = parseFloat(String(r.giftBalance || r.gift || "0")) || 0;
            const frozen = parseFloat(String(r.frozenBalance || r.frozen || "0")) || 0;
            const cash = parseFloat(String(r.cashBalance || r.cash || "0")) || 0;
            return {
              email: r.email,
              status: (r.status || "").toLowerCase() === "ok" ? "OK" : "Error",
              balance: bal || null,
              gift: gift || null,
              frozen: frozen || null,
              cash: cash || null,
              error: r.error || undefined,
            };
          });

          setResults(normalized);
          const ok = normalized.filter(r => r.status === "OK");
          const totalBal = ok.reduce((s, r) => s + (r.balance || 0), 0);
          const totalGift = ok.reduce((s, r) => s + (r.gift || 0), 0);
          setSummary({ totalBalance: totalBal, totalGift, okCount: ok.length, errCount: normalized.length - ok.length });
          setChecking(false);
          setStatusText(`Done — ${ok.length} OK, ${normalized.length - ok.length} failed`);
        }
      } catch {}
    }, 3000);
  }, [accounts]);

  if (!authChecked) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push("/")} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <h1 className="text-lg sm:text-xl font-semibold">API Key Checker</h1>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-border/50 p-4 sm:p-5 space-y-4 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-border/60 hover:border-border cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
              <Upload className="w-4 h-4" />
              <span>Upload JSON</span>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
            <span className="text-xs text-muted-foreground">{accounts.length} account(s) loaded</span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={runChecker} disabled={checking || accounts.length === 0}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {checking ? "Checking..." : "Run Checker"}
            </button>
            {checking && <span className="text-xs text-muted-foreground self-center">{statusText}</span>}
          </div>

          {/* Progress */}
          {checking && progress.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.done}/{progress.total}</span>
                <span>{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 sm:mb-6">
              <div className="rounded-xl border border-border/50 p-3 sm:p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground"><DollarSign className="w-3.5 h-3.5" /><span className="text-[10px] sm:text-xs uppercase tracking-wider">Total Balance</span></div>
                <div className="text-lg sm:text-xl font-bold font-mono">${summary.totalBalance.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-border/50 p-3 sm:p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground"><Gift className="w-3.5 h-3.5" /><span className="text-[10px] sm:text-xs uppercase tracking-wider">Total Gift</span></div>
                <div className="text-lg sm:text-xl font-bold font-mono">${summary.totalGift.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-border/50 p-3 sm:p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-green-400 text-xs"><CheckCircle className="w-3.5 h-3.5" /> OK</div>
                <div className="text-lg sm:text-xl font-bold text-green-400">{summary.okCount}</div>
              </div>
              <div className="rounded-xl border border-border/50 p-3 sm:p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-red-400 text-xs"><XCircle className="w-3.5 h-3.5" /> Gagal</div>
                <div className="text-lg sm:text-xl font-bold text-red-400">{summary.errCount}</div>
              </div>
            </div>

            {/* Token Estimation */}
            {summary.totalBalance > 0 && (
              <div className="rounded-xl border border-border/50 p-4 sm:p-5 space-y-3 mb-4 sm:mb-6">
                <h2 className="text-sm font-semibold">Estimasi Remaining Token</h2>
                <p className="text-xs text-muted-foreground">Berdasarkan total balance ${summary.totalBalance.toFixed(2)} USD</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "PRO", price: PRICING.pro },
                    { label: "STD", price: PRICING.std },
                    { label: "MIX", price: { cacheHit: (PRICING.pro.cacheHit + PRICING.std.cacheHit) / 2, cacheMiss: (PRICING.pro.cacheMiss + PRICING.std.cacheMiss) / 2, output: (PRICING.pro.output + PRICING.std.output) / 2 } },
                  ].map(m => (
                    <div key={m.label} className="p-3 rounded-lg bg-muted/30 border border-border/30">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">{m.label}</div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between"><span>Cache Hit</span><span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.cacheHit))}</span></div>
                        <div className="flex justify-between"><span>Cache Miss</span><span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.cacheMiss))}</span></div>
                        <div className="flex justify-between"><span>Output</span><span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.output))}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results Table — Desktop */}
            <div className="hidden sm:block rounded-xl border border-border/50 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gift</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Frozen</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{r.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${r.status === "OK" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                          {r.status === "OK" ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{r.balance != null ? `$${Number(r.balance).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{r.gift != null ? `$${Number(r.gift).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{r.frozen != null ? `$${Number(r.frozen).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{r.cash != null ? `$${Number(r.cash).toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Results — Mobile Cards */}
            <div className="sm:hidden space-y-2 mb-4">
              {results.map((r, i) => (
                <div key={i} className="rounded-xl border border-border/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${r.status === "OK" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                      {r.status === "OK" ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {r.status}
                    </span>
                  </div>
                  <div className="font-mono text-xs break-all">{r.email}</div>
                  {r.status === "OK" && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between"><span className="text-muted-foreground">Balance</span><span className="font-mono">{r.balance != null ? `$${Number(r.balance).toFixed(2)}` : "—"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Gift</span><span className="font-mono">{r.gift != null ? `$${Number(r.gift).toFixed(2)}` : "—"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Frozen</span><span className="font-mono">{r.frozen != null ? `$${Number(r.frozen).toFixed(2)}` : "—"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Cash</span><span className="font-mono">{r.cash != null ? `$${Number(r.cash).toFixed(2)}` : "—"}</span></div>
                    </div>
                  )}
                  {r.error && <div className="text-xs text-red-400 font-mono">{r.error}</div>}
                </div>
              ))}
            </div>

            {/* Error Details */}
            {results.some(r => r.error) && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-red-400">Detail Error</h3>
                {results.filter(r => r.error).map((r, i) => (
                  <div key={i} className="text-xs font-mono text-red-300 break-all">{r.email} — {r.error}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
