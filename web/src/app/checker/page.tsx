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

  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) { router.push("/login"); return; }
      setAuthChecked(true);
      loadMasterKeys();
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadMasterKeys = async () => {
    try {
      const res = await fetch("/api/master-keys");
      const data = await res.json();
      setAccounts((data.keys || []).filter((k: MasterKey) => k.provider === "mimo"));
    } catch {}
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const arr = Array.isArray(data) ? data : [data];
        setAccounts(arr.filter((k: any) => k.cookies?.passToken || k.apiKey));
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

    // Submit to server → get queueId
    let queueId: string;
    try {
      const resp = await fetch("/api/checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await resp.json();
      if (data.error) {
        setStatusText(`Error: ${data.error}`);
        setChecking(false);
        return;
      }
      queueId = data.queueId;
      setProgress({ done: 0, total: data.total || accounts.length });
      setStatusText(`Queue: ${queueId} — checking...`);
    } catch (e: any) {
      setStatusText(`Submit failed: ${e.message}`);
      setChecking(false);
      return;
    }

    // Poll external API directly
    const STATUS_URL = `https://apikey.jimixz.tech/api/status/${queueId}`;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(STATUS_URL);
        const data = await resp.json();

        if (data.progress) {
          setProgress({ done: data.progress.done || 0, total: data.progress.total || 0 });
          setStatusText(`Checking... ${data.progress.done || 0}/${data.progress.total || 0}`);
        }

        if (data.status === "done" || data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);

          const rawResults = data.results || [];
          const normalized: CheckResult[] = rawResults.map((r: any) => {
            const bal = parseFloat(r.balance) || 0;
            const gift = parseFloat(r.giftBalance || r.gift || "0") || 0;
            const frozen = parseFloat(r.frozenBalance || r.frozen || "0") || 0;
            const cash = parseFloat(r.cashBalance || r.cash || "0") || 0;
            return {
              email: r.email,
              status: (r.status || "").toLowerCase() === "ok" ? "OK" : "Error",
              balance: bal || null,
              gift: gift || null,
              frozen: frozen || null,
              cash: cash || null,
              error: r.error || null,
            };
          });

          const totalBalance = normalized.reduce((s, r) => s + (parseFloat(String(r.balance)) || 0), 0);
          const totalGift = normalized.reduce((s, r) => s + (parseFloat(String(r.gift)) || 0), 0);
          const okCount = normalized.filter(r => r.status === "OK").length;
          const errCount = normalized.filter(r => r.status === "Error").length;

          setResults(normalized);
          setSummary({ totalBalance, totalGift, okCount, errCount });
          setStatusText(`Done — ${okCount} OK, ${errCount} failed`);
          setChecking(false);
        }

        if (data.status === "failed" || data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatusText(`Checker failed: ${data.error || "unknown"}`);
          setChecking(false);
        }
      } catch {}
    }, 2000);
  }, [accounts]);

  const usdToIdr = (usd: number) => Math.round(usd * 17900);
  const estTokens = (balanceUsd: number, pricePer1M: number) => Math.floor((balanceUsd / pricePer1M) * 1_000_000);
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/")} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <ShieldCheck className="w-6 h-6" />
            <h1 className="text-xl font-semibold">MiMo API Plan Checker</h1>
          </div>
          <span className="text-sm text-muted-foreground">{accounts.length} accounts</span>
        </div>

        <div className="flex gap-3">
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted/80 cursor-pointer text-sm transition-colors">
            <Upload className="w-4 h-4" /> Upload JSON
            <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
          </label>
          <button onClick={loadMasterKeys} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-sm transition-colors">
            <RefreshCw className="w-4 h-4" /> Load Master Keys
          </button>
        </div>

        <div className="rounded-xl border border-border/50 p-5 space-y-3">
          <h2 className="text-sm font-semibold">Model Pricing Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-muted/20">
              <div className="text-xs font-semibold text-blue-400 mb-2">PRO — mimo-v2.5 pro</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>Input (Cache Hit)<br/><span className="text-foreground font-mono">${PRICING.pro.cacheHit}</span></div>
                <div>Input (Cache Miss)<br/><span className="text-foreground font-mono">${PRICING.pro.cacheMiss}</span></div>
                <div>Output<br/><span className="text-foreground font-mono">${PRICING.pro.output}</span></div>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/20">
              <div className="text-xs font-semibold text-green-400 mb-2">STD — mimo-v2.5</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>Input (Cache Hit)<br/><span className="text-foreground font-mono">${PRICING.std.cacheHit}</span></div>
                <div>Input (Cache Miss)<br/><span className="text-foreground font-mono">${PRICING.std.cacheMiss}</span></div>
                <div>Output<br/><span className="text-foreground font-mono">${PRICING.std.output}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={runChecker} disabled={checking || accounts.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-50 transition-colors hover:opacity-90">
            {checking ? <><Loader2 className="w-4 h-4 animate-spin" /></> :
             results.length > 0 ? <><RefreshCw className="w-4 h-4" /></> :
             <><ShieldCheck className="w-4 h-4" /></>}
            {checking ? ` Checking ${progress.done}/${progress.total}...` :
             results.length > 0 ? " Check Again" :
             ` Start Check (${accounts.length})`}
          </button>
          {checking && (
            <div className="flex-1 space-y-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-foreground transition-all duration-500 rounded-full" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-xs text-muted-foreground text-right">{progressPct}% — {statusText}</div>
            </div>
          )}
          {!checking && statusText && !statusText.startsWith("Checking") && (
            <span className="text-sm text-muted-foreground">{statusText}</span>
          )}
        </div>

        {results.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" /> Total Balance</div>
                <div className="text-xl font-bold font-mono">${summary.totalBalance.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Est. Rp{usdToIdr(summary.totalBalance).toLocaleString()}</div>
              </div>
              <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Gift className="w-3.5 h-3.5" /> Total Gift</div>
                <div className="text-xl font-bold font-mono">${summary.totalGift.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 text-xs mb-1"><CheckCircle className="w-3.5 h-3.5" /> Berhasil</div>
                <div className="text-xl font-bold text-green-400">{summary.okCount}</div>
              </div>
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-xs mb-1"><XCircle className="w-3.5 h-3.5" /> Gagal</div>
                <div className="text-xl font-bold text-red-400">{summary.errCount}</div>
              </div>
            </div>

            {summary.totalBalance > 0 && (
              <div className="rounded-xl border border-border/50 p-5 space-y-3">
                <h2 className="text-sm font-semibold">Estimasi Remaining Token</h2>
                <p className="text-xs text-muted-foreground">Berdasarkan total balance ${summary.totalBalance.toFixed(2)} USD</p>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "PRO", color: "blue", price: PRICING.pro },
                    { label: "STD", color: "green", price: PRICING.std },
                    { label: "MIX", color: "purple", price: { cacheHit: (PRICING.pro.cacheHit + PRICING.std.cacheHit) / 2, cacheMiss: (PRICING.pro.cacheMiss + PRICING.std.cacheMiss) / 2, output: (PRICING.pro.output + PRICING.std.output) / 2 } },
                  ].map(m => (
                    <div key={m.label} className={`p-3 rounded-lg bg-${m.color}-500/5 border border-${m.color}-500/10`}>
                      <div className={`text-xs font-semibold text-${m.color}-400 mb-2`}>{m.label}</div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>Cache Hit: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.cacheHit))}</span></div>
                        <div>Cache Miss: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.cacheMiss))}</span></div>
                        <div>Output: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, m.price.output))}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/50 overflow-hidden">
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
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                          r.status === "OK" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        }`}>
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

            {results.some(r => r.error) && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-red-400">Detail Error</h3>
                {results.filter(r => r.error).map((r, i) => (
                  <div key={i} className="text-xs font-mono text-red-300">{r.email} — {r.error}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
