"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { ShieldCheck, ArrowLeft, Loader2, CheckCircle, XCircle, AlertCircle, DollarSign, Gift, RefreshCw } from "lucide-react";

interface CheckResult {
  email: string;
  status: "OK" | "Error";
  balance: number | null;
  gift: number | null;
  frozen: number | null;
  cash: number | null;
  error?: string;
  apiKey?: string;
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
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState({ totalBalance: 0, totalGift: 0, okCount: 0, errCount: 0 });
  const [authChecked, setAuthChecked] = useState(false);
  const [masterKeys, setMasterKeys] = useState<MasterKey[]>([]);

  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) { router.push("/login"); return; }
      setAuthChecked(true);
      loadMasterKeys();
    });
  }, []);

  const loadMasterKeys = async () => {
    try {
      const res = await fetch("/api/master-keys");
      const data = await res.json();
      setMasterKeys(data.keys || []);
    } catch {}
  };

  const runChecker = useCallback(async () => {
    if (masterKeys.length === 0) return;
    setChecking(true);
    setResults([]);
    setProgress({ current: 0, total: masterKeys.length });
    setSummary({ totalBalance: 0, totalGift: 0, okCount: 0, errCount: 0 });

    // Check in batches of 10 to avoid overwhelming
    const batchSize = 10;
    const allResults: CheckResult[] = [];
    let totalBalance = 0, totalGift = 0, okCount = 0, errCount = 0;

    for (let i = 0; i < masterKeys.length; i += batchSize) {
      const batch = masterKeys.slice(i, i + batchSize);
      try {
        const res = await fetch("/api/checker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accounts: batch }),
        });
        const data = await res.json();
        allResults.push(...(data.results || []));
        totalBalance += data.totalBalance || 0;
        totalGift += data.totalGift || 0;
        okCount += data.okCount || 0;
        errCount += data.errCount || 0;
      } catch (e: any) {
        for (const k of batch) {
          allResults.push({ email: k.email, status: "Error", error: e.message, balance: null, gift: null, frozen: null, cash: null });
          errCount++;
        }
      }
      setResults([...allResults]);
      setProgress({ current: Math.min(i + batchSize, masterKeys.length), total: masterKeys.length });
      setSummary({ totalBalance, totalGift, okCount, errCount });
    }

    setChecking(false);
  }, [masterKeys]);

  const usdToIdr = (usd: number) => Math.round(usd * 17900);

  const estTokens = (balanceUsd: number, pricePer1M: number) => Math.floor((balanceUsd / pricePer1M) * 1_000_000);

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/")} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <ShieldCheck className="w-6 h-6" />
            <h1 className="text-xl font-semibold">MiMo API Plan Checker</h1>
          </div>
          <span className="text-sm text-muted-foreground">{masterKeys.length} accounts loaded</span>
        </div>

        {/* How it works */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
            <div className="text-2xl font-bold mb-1">1</div>
            <div className="text-xs text-muted-foreground">Auto-load from Master Keys</div>
          </div>
          <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
            <div className="text-2xl font-bold mb-1">2</div>
            <div className="text-xs text-muted-foreground">Check each account with progress</div>
          </div>
          <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
            <div className="text-2xl font-bold mb-1">3</div>
            <div className="text-xs text-muted-foreground">See balance, status, token estimates</div>
          </div>
        </div>

        {/* Model Pricing */}
        <div className="rounded-xl border border-border/50 p-5 space-y-4">
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
          <p className="text-[10px] text-muted-foreground">* Harga per 1M token dari mimo.mi.com</p>
        </div>

        {/* Run button + progress */}
        <div className="flex items-center gap-4">
          <button
            onClick={runChecker}
            disabled={checking || masterKeys.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-50 transition-colors hover:opacity-90"
          >
            {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking {progress.current}/{progress.total}...</> :
             results.length > 0 ? <><RefreshCw className="w-4 h-4" /> Check Again</> :
             <><ShieldCheck className="w-4 h-4" /> Start Check ({masterKeys.length})</>}
          </button>
          {checking && (
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-foreground transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          )}
        </div>

        {/* Summary Cards */}
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

            {/* Token Estimation */}
            {summary.totalBalance > 0 && (
              <div className="rounded-xl border border-border/50 p-5 space-y-3">
                <h2 className="text-sm font-semibold">Estimasi Remaining Token</h2>
                <p className="text-xs text-muted-foreground">Berdasarkan total balance ${summary.totalBalance.toFixed(2)} USD</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                    <div className="text-xs font-semibold text-blue-400 mb-2">PRO</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Cache Hit: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.pro.cacheHit))}</span></div>
                      <div>Cache Miss: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.pro.cacheMiss))}</span></div>
                      <div>Output: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.pro.output))}</span></div>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                    <div className="text-xs font-semibold text-green-400 mb-2">STD</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Cache Hit: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.std.cacheHit))}</span></div>
                      <div>Cache Miss: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.std.cacheMiss))}</span></div>
                      <div>Output: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, PRICING.std.output))}</span></div>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/10">
                    <div className="text-xs font-semibold text-purple-400 mb-2">MIX</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Cache Hit: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, (PRICING.pro.cacheHit + PRICING.std.cacheHit) / 2))}</span></div>
                      <div>Cache Miss: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, (PRICING.pro.cacheMiss + PRICING.std.cacheMiss) / 2))}</span></div>
                      <div>Output: <span className="text-foreground font-mono">{fmtNum(estTokens(summary.totalBalance, (PRICING.pro.output + PRICING.std.output) / 2))}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results Table */}
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

            {/* Error Details */}
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
