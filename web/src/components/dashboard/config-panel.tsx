"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Settings, Loader2, Monitor, Eye, ChevronDown, ChevronUp, Zap, Cloud, Globe } from "lucide-react";

interface BatchConfig {
  generator: "mimo" | "qwencloud";
  count: number;
  headless: boolean;
  threads: number;
  seedCode: string;
  password: string;
  captchaProvider: string;
  captchaApiKey: string;
  tempmailUrl: string;
  country: string;
  proxies: string;
}

interface ConfigPanelProps {
  onStart: (config: BatchConfig) => void;
  isRunning: boolean;
}

/* ── Custom Select ──────────────────────────────────── */
function CustomSelect({ value, onChange, options }: {
  value: number; onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono flex items-center justify-between gap-2 focus:outline-none focus:border-foreground/30 transition-colors hover:bg-muted/70">
        <span>{selected?.label || `${value}`}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border/50 rounded-xl shadow-lg shadow-black/20 overflow-hidden">
            {options.map(opt => (
              <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2.5 text-sm font-mono text-left transition-colors ${
                  opt.value === value ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}>{opt.label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Generator Toggle ──────────────────────────────── */
function GeneratorToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center bg-muted/30 border border-border/40 rounded-xl overflow-hidden">
      <button type="button" onClick={() => onChange("mimo")}
        className={`flex items-center gap-1.5 px-3 h-10 text-xs font-medium transition-colors ${
          value === "mimo" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        }`}>
        <Zap className="w-3.5 h-3.5" /> MiMo
      </button>
      <button type="button" onClick={() => onChange("qwencloud")}
        className={`flex items-center gap-1.5 px-3 h-10 text-xs font-medium transition-colors ${
          value === "qwencloud" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        }`}>
        <Cloud className="w-3.5 h-3.5" /> QwenCloud
      </button>
    </div>
  );
}

export function ConfigPanel({ onStart, isRunning }: ConfigPanelProps) {
  const [config, setConfig] = useState<BatchConfig>({
    generator: "mimo",
    count: 3,
    headless: true,
    threads: 1,
    seedCode: "T8K299",
    password: "Arkan123!",
    captchaProvider: "capmonster",
    captchaApiKey: "fb46ddaf60bad7dbc5066308a5b73349",
    tempmailUrl: "https://tempik.hindiabelanda.my.id/api",
    country: "",
    proxies: "",
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const isMimo = config.generator === "mimo";

  const update = <K extends keyof BatchConfig>(key: K, value: BatchConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const proxyCount = config.proxies.split("\n").filter(l => l.trim().includes(":")).length;

  return (
    <div className="space-y-4">
      {/* Generator Toggle */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Generator</label>
        <GeneratorToggle value={config.generator} onChange={v => update("generator", v as "mimo" | "qwencloud")} />
      </div>

      {/* Primary Controls */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${isMimo ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-3`}>
        {/* Account Count */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Accounts</label>
          <input type="number" min={1} max={9999} value={config.count} onChange={e => update("count", Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
        </div>

        {/* Threads */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Threads</label>
          <input type="number" min={1} max={20} value={config.threads} onChange={e => update("threads", Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
        </div>

        {/* Headless */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Browser</label>
          <button type="button" onClick={() => update("headless", !config.headless)}
            className={`w-full h-10 px-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              config.headless ? "bg-muted/50 border-border/50 text-muted-foreground" : "bg-foreground/10 border-foreground/20 text-foreground"
            }`}>
            {config.headless ? <Eye className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            {config.headless ? "Headless" : "Visible"}
          </button>
        </div>

        {/* Seed Code (MiMo only) */}
        {isMimo && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Invite Code</label>
            <input type="text" value={config.seedCode} onChange={e => update("seedCode", e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
          </div>
        )}

        {/* Start Button */}
        <div className={`space-y-1.5 ${isMimo ? "col-span-2 sm:col-span-3 lg:col-span-1" : "col-span-2 sm:col-span-3 lg:col-span-1"}`}>
          <label className="text-[10px] font-medium text-transparent uppercase tracking-wider hidden lg:block">&nbsp;</label>
          <motion.button onClick={() => onStart(config)} disabled={isRunning}
            className="w-full h-10 px-4 rounded-xl bg-foreground text-background font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.97]"
            whileTap={{ scale: 0.97 }}>
            {isRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              : <><Play className="w-4 h-4" /> Start Batch</>}
          </motion.button>
        </div>
      </div>

      {/* Advanced Toggle */}
      <button onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Settings className="w-3 h-3" />
        {showAdvanced ? "Hide" : "Show"} advanced settings
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {showAdvanced && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className={`grid grid-cols-1 ${isMimo ? "sm:grid-cols-2" : "sm:grid-cols-2"} gap-3 pt-1`}>
              {isMimo ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Password</label>
                    <input type="text" value={config.password} onChange={e => update("password", e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Captcha Provider</label>
                    <CustomSelect value={config.captchaProvider === "capmonster" ? 0 : 1}
                      onChange={v => update("captchaProvider", v === 0 ? "capmonster" : "2captcha")}
                      options={[{ value: 0, label: "CapMonster" }, { value: 1, label: "2Captcha" }]} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Captcha API Key</label>
                    <input type="password" value={config.captchaApiKey} onChange={e => update("captchaApiKey", e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tempmail API</label>
                    <input type="text" value={config.tempmailUrl} onChange={e => update("tempmailUrl", e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Country (optional)</label>
                    <input type="text" value={config.country} placeholder="Indonesia"
                      onChange={e => update("country", e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tempmail API</label>
                    <input type="text" value={config.tempmailUrl} onChange={e => update("tempmailUrl", e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors" />
                  </div>
                </>
              )}
            </div>

            {/* Proxy List — common for both generators */}
            <div className="space-y-1.5 pt-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Proxy List
                </label>
                {proxyCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{proxyCount} proxy loaded</span>
                )}
              </div>
              <textarea
                value={config.proxies}
                onChange={e => update("proxies", e.target.value)}
                placeholder={"ip:port:user:pass\nip:port:user:pass\nip:port (no auth)"}
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl bg-muted/50 border border-border/50 text-sm font-mono focus:outline-none focus:border-foreground/30 transition-colors resize-none placeholder:text-muted-foreground/40"
              />
              <p className="text-[10px] text-muted-foreground/60">
                One proxy per line. Format: <code className="text-foreground/60">ip:port:user:pass</code> or <code className="text-foreground/60">ip:port</code>. Proxy is tested before use; falls back to direct if all fail.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
