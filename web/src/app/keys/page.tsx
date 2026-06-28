"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/auth";
import { Key, Download, Copy, Check, Trash2, Search, ArrowLeft } from "lucide-react";

interface MasterKey {
  email: string;
  password: string;
  apiKey: string;
  cookies: { passToken: string | null; cUserId: string | null; userId: string | null };
  provider: string;
  created_at: string;
}

export default function KeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<MasterKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    getMe().then(r => {
      if (!r.ok) { router.push("/login"); return; }
      setAuthChecked(true);
      loadKeys();
    });
  }, []);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/master-keys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch {}
    setLoading(false);
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyAll = () => {
    const text = filteredKeys.map(k => k.apiKey).join("\n");
    navigator.clipboard.writeText(text);
    setCopied("all");
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredKeys = keys.filter(k =>
    !search || k.email.includes(search) || k.apiKey.includes(search)
  );

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
            <Key className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Master API Keys</h1>
            <span className="text-sm text-muted-foreground">({filteredKeys.length} keys)</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyAll} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors">
              {copied === "all" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === "all" ? "Copied!" : "Copy All"}
            </button>
            <a href="/api/master-keys/download?format=txt" className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors">
              <Download className="w-4 h-4" /> TXT
            </a>
            <a href="/api/master-keys/download?format=json" className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors">
              <Download className="w-4 h-4" /> JSON
            </a>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by email or API key..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading...</div>
        ) : filteredKeys.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No API keys found</div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">API Key</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Provider</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredKeys.map((k, i) => (
                  <tr key={k.email} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{k.email}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <span className="text-foreground/80">{k.apiKey.substring(0, 12)}...{k.apiKey.substring(k.apiKey.length - 6)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${k.provider === "mimo" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"}`}>
                        {k.provider}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(k.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => copyKey(k.apiKey)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Copy API Key">
                        {copied === k.apiKey ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </td>
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
