"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Terminal as TerminalIcon, X, ChevronDown, Maximize2, Minimize2, Layers } from "lucide-react";

interface Props { logs: string[]; batchId: string | null; onClose: () => void; }

interface ThreadState {
  id: string; num: number;
  status: "idle" | "working" | "success" | "failed";
  task: string; detail: string;
  accountIdx: number; total: number; threadDone: number; threadAssigned: number;
}

function parse(raw: string) {
  const ts = raw.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)/);
  const time = ts ? ts[1] : null;
  const after = ts ? ts[2] : raw;
  const tm = after.match(/^\[T(\d+)\]\s*(.*)/);
  if (tm) return { time, msg: tm[2], thread: `T${tm[1]}` };
  return { time, msg: after, thread: null };
}

function derive(logs: string[]) {
  const tmap = new Map<string, ThreadState>();
  const sys: string[] = [];
  let batchTotal = 0;

  for (const raw of logs) {
    const { msg, thread } = parse(raw);
    if (!thread) {
      sys.push(raw);
      const m = msg.match(/Started.{0,5}(\d+)\s*account/i);
      if (m) batchTotal = parseInt(m[1]);
      continue;
    }
    if (!tmap.has(thread)) {
      const n = parseInt(thread.replace("T", ""));
      tmap.set(thread, { id: thread, num: n, status: "idle", task: "Waiting", detail: "", accountIdx: 0, total: 0, threadDone: 0, threadAssigned: 0 });
    }
    const t = tmap.get(thread)!;
    const am = msg.match(/Account\s+(\d+)\/(\d+)/);
    if (am) { t.accountIdx = parseInt(am[1]); t.total = parseInt(am[2]); }

    if (msg.includes("starting"))          { t.status = "working"; t.task = "Starting"; t.detail = ""; t.threadAssigned++; }
    else if (msg.includes("Email:"))       { t.task = "Creating email"; t.detail = "***"; }
    else if (msg.includes("Chrome"))       { t.task = "Launching browser"; t.detail = msg; }
    else if (msg.includes("Navigating"))   { t.task = "Navigating"; t.detail = ""; }
    else if (msg.includes("Filling form")) { t.task = "Filling form"; t.detail = ""; }
    else if (msg.includes("Submitting"))   { t.task = "Submitting"; t.detail = ""; }
    else if (msg.includes("Solving captcha")) { t.task = "Solving captcha"; t.detail = ""; }
    else if (msg.includes("Captcha solved"))  { t.task = "Captcha solved"; t.detail = "✓"; }
    else if (msg.includes("Verifying email")) { t.task = "Verifying email"; t.detail = ""; }
    else if (msg.includes("Email verified"))  { t.task = "Email verified"; t.detail = "✓"; }
    else if (msg.includes("Creating API key")) { t.task = "Creating API key"; t.detail = ""; }
    else if (msg.includes("✅")) { t.status = "success"; t.task = "Done"; t.threadDone++; t.detail = "success"; }
    else if (msg.includes("❌")) { t.status = "failed"; t.task = "Failed"; t.threadDone++; t.detail = msg.replace(/^❌\s*/, "").replace(/Account\s+\d+\/\d+\s*/, ""); }
    else if (msg.includes("Waiting")) { t.task = "Cooldown"; t.detail = msg; }
  }

  const threads = Array.from(tmap.values()).sort((a, b) => a.num - b.num);
  const maxTotal = threads.reduce((m, t) => Math.max(m, t.total), 0);
  const total = maxTotal || batchTotal || threads.length;
  return {
    threads, sys,
    summary: {
      total,
      done: threads.reduce((s, t) => s + t.threadDone, 0),
      success: threads.reduce((s, t) => s + (t.status === "success" ? t.threadDone : 0), 0),
      failed: threads.reduce((s, t) => s + (t.status === "failed" ? t.threadDone : 0), 0),
    },
  };
}

const ACCENTS = [
  { bar: "bg-sky-400", text: "text-sky-400", bg: "bg-sky-500/8", border: "border-sky-500/20" },
  { bar: "bg-violet-400", text: "text-violet-400", bg: "bg-violet-500/8", border: "border-violet-500/20" },
  { bar: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-500/8", border: "border-amber-500/20" },
  { bar: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
  { bar: "bg-rose-400", text: "text-rose-400", bg: "bg-rose-500/8", border: "border-rose-500/20" },
  { bar: "bg-cyan-400", text: "text-cyan-400", bg: "bg-cyan-500/8", border: "border-cyan-500/20" },
  { bar: "bg-orange-400", text: "text-orange-400", bg: "bg-orange-500/8", border: "border-orange-500/20" },
  { bar: "bg-indigo-400", text: "text-indigo-400", bg: "bg-indigo-500/8", border: "border-indigo-500/20" },
  { bar: "bg-lime-400", text: "text-lime-400", bg: "bg-lime-500/8", border: "border-lime-500/20" },
  { bar: "bg-fuchsia-400", text: "text-fuchsia-400", bg: "bg-fuchsia-500/8", border: "border-fuchsia-500/20" },
];

function Dot({ s }: { s: ThreadState["status"] }) {
  if (s === "working") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (s === "success") return <span className="text-emerald-400 text-xs leading-none">✓</span>;
  if (s === "failed") return <span className="text-red-400 text-xs leading-none">✗</span>;
  return <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />;
}

export function PublicTerminal({ logs, batchId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"board" | "log">("board");

  const { threads, sys, summary } = useMemo(() => derive(logs), [logs]);
  const running = threads.some(t => t.status === "working");

  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!ref.current) return;
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  if (!batchId) return null;

  const containerClass = expanded
    ? "fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] sm:inset-3 md:inset-4 rounded-none sm:rounded-xl"
    : "relative flex flex-col";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`border border-border/40 rounded-xl overflow-hidden bg-[#0a0a0a] shadow-2xl shadow-black/40 ${containerClass}`}>

      {/* Title Bar */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-[#111111] border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57] cursor-pointer" onClick={onClose} />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840] cursor-pointer" onClick={() => setExpanded(!expanded)} />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 pl-2 border-l border-white/[0.06] min-w-0 overflow-hidden">
            <TerminalIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-[10px] sm:text-xs font-medium text-zinc-400 shrink-0">public</span>
            {threads.length > 1 && (
              <span className="text-[10px] text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded font-mono shrink-0 flex items-center gap-1">
                <Layers className="w-2.5 h-2.5" />{threads.length}T
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center bg-white/[0.04] rounded-md overflow-hidden">
            <button onClick={() => setView("board")}
              className={`px-2 py-1 text-[9px] sm:text-[10px] font-mono transition-colors ${view === "board" ? "bg-white/[0.1] text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}>
              Board
            </button>
            <button onClick={() => setView("log")}
              className={`px-2 py-1 text-[9px] sm:text-[10px] font-mono transition-colors ${view === "log" ? "bg-white/[0.1] text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}>
              Log
            </button>
          </div>
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-white/[0.06] rounded-md transition-colors hidden sm:block">
            {expanded ? <Minimize2 className="w-3.5 h-3.5 text-zinc-500" /> : <Maximize2 className="w-3.5 h-3.5 text-zinc-500" />}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/[0.06] rounded-md transition-colors">
            <X className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 bg-[#0d0d0d] border-b border-white/[0.04] shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-mono text-zinc-500 shrink-0">
          <span>Total: <span className="text-zinc-300">{summary.total}</span></span>
          <span className="text-zinc-700">·</span>
          <span>Done: <span className="text-zinc-300">{summary.done}/{summary.total}</span></span>
          <span className="text-zinc-700">·</span>
          <span className="text-emerald-400">✓ {summary.success}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-red-400">✗ {summary.failed}</span>
        </div>
        {running && <span className="text-[10px] text-amber-400 animate-pulse ml-auto shrink-0">● Running</span>}
        {!running && summary.done > 0 && <span className="text-[10px] text-zinc-500 ml-auto shrink-0">Finished</span>}
      </div>

      {/* Body */}
      <div ref={ref} onScroll={handleScroll}
        className={`${expanded ? "flex-1 min-h-0" : "max-h-[50vh] sm:max-h-[32rem]"} overflow-y-auto`}
        style={{ scrollbarWidth: "thin", scrollbarColor: "#333 transparent" }}>

        {view === "board" ? (
          <div className="p-3 sm:p-4 space-y-3">
            {threads.length === 0 ? (
              <div className="text-center py-12 text-zinc-600">
                <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Waiting for threads…</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {threads.map(t => {
                  const ac = ACCENTS[(t.num - 1) % ACCENTS.length];
                  return (
                    <motion.div key={t.id} layout className={`rounded-lg border ${ac.border} ${ac.bg} p-2.5 sm:p-3 transition-colors min-w-0`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Dot s={t.status} />
                        <span className={`text-xs sm:text-sm font-bold font-mono ${ac.text}`}>{t.id}</span>
                        {t.threadAssigned > 0 && (
                          <span className="text-[10px] text-zinc-500 font-mono truncate">
                            {t.threadDone > 0 && `${t.threadDone}/${t.threadAssigned}`}
                          </span>
                        )}
                        {t.status === "working" && (
                          <div className="ml-auto flex items-center gap-0.5 shrink-0">
                            {[0, 150, 300].map(d => <div key={d} className={`w-1 h-1 rounded-full ${ac.bar} animate-bounce`} style={{ animationDelay: `${d}ms` }} />)}
                          </div>
                        )}
                      </div>
                      <div className={`text-xs sm:text-sm font-medium truncate ${t.status === "success" ? "text-emerald-400" : t.status === "failed" ? "text-red-400" : "text-zinc-300"}`}>{t.task}</div>
                      {t.detail && <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">{t.detail}</div>}
                      {t.total > 0 && (
                        <div className="mt-2 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${t.status === "success" ? "bg-emerald-500/60" : t.status === "failed" ? "bg-red-500/60" : ac.bar + "/60"}`}
                            style={{ width: `${(t.threadDone / Math.max(t.threadAssigned, 1)) * 100}%` }} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
            {sys.length > 0 && (
              <div className="pt-2 border-t border-white/[0.04]">
                {sys.map((raw, i) => { const { time, msg } = parse(raw); return <div key={i} className="text-[10px] font-mono text-zinc-500 py-0.5 break-all">{time && <span className="text-zinc-700 mr-2">{time}</span>}{msg}</div>; })}
              </div>
            )}
          </div>
        ) : (
          <div className="py-2 font-mono text-[10px] sm:text-[11px] leading-relaxed">
            {logs.map((raw, i) => {
              const { time, msg } = parse(raw);
              return (
                <div key={i} className="flex items-start px-3 sm:px-4 py-0.5 hover:bg-white/[0.02] gap-1 sm:gap-2">
                  <span className="w-7 sm:w-10 shrink-0 text-right pr-1 sm:pr-2 text-zinc-700 select-none">{i + 1}</span>
                  {time && <span className="text-zinc-600 shrink-0 hidden sm:inline">{time}</span>}
                  <span className="text-zinc-400 break-all min-w-0">{msg}</span>
                </div>
              );
            })}
            <div className="flex items-center px-3 sm:px-4 py-0.5">
              <span className="w-7 sm:w-10 shrink-0 text-right pr-1 sm:pr-2 text-zinc-700 select-none">{logs.length + 1}</span>
              <span className="inline-block w-2 h-4 bg-emerald-400/70 animate-pulse rounded-sm" />
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 bg-[#111111] border-t border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[10px] text-zinc-600 font-mono">
          <span className="text-emerald-400">{summary.success} ok</span>
          <span className="text-zinc-700">│</span>
          <span className="text-red-400">{summary.failed} err</span>
          <span className="text-zinc-700">│</span>
          <span>{summary.done}/{summary.total} done</span>
        </div>
        {!autoScroll && (
          <button onClick={() => { setAutoScroll(true); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }}
            className="flex items-center gap-1 text-[9px] sm:text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
            <ChevronDown className="w-3 h-3" /> bottom
          </button>
        )}
      </div>
    </motion.div>
  );
}
