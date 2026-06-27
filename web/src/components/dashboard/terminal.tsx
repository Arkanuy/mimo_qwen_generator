"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Terminal as TerminalIcon, X, ChevronDown, Copy, Check, Maximize2, Minimize2, Layers } from "lucide-react";

interface TerminalProps {
  logs: string[];
  batchId: string | null;
  onClose: () => void;
}

interface ThreadState {
  id: string;
  num: number;
  status: "idle" | "working" | "success" | "failed";
  task: string;
  detail: string;
  accountIdx: number;
  total: number;
  threadDone: number;
  threadAssigned: number;
}

/* ── Parse a single log line ─────────────────────── */
function parseLogLine(raw: string): { time: string | null; msg: string; thread: string | null } {
  // Strip timestamp [HH:MM:SS]
  const tsMatch = raw.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)/);
  const time = tsMatch ? tsMatch[1] : null;
  const afterTs = tsMatch ? tsMatch[2] : raw;

  // Strip thread tag [T1], [T2], etc.
  const tMatch = afterTs.match(/^\[T(\d+)\]\s*(.*)/);
  if (tMatch) return { time, msg: tMatch[2], thread: `T${tMatch[1]}` };

  return { time, msg: afterTs, thread: null };
}

/* ── Derive live thread states from flat log array ─ */
function derive(logs: string[]) {
  const threadMap = new Map<string, ThreadState>();
  const systemLines: string[] = [];
  let batchTotal = 0;

  for (const raw of logs) {
    const { time, msg, thread } = parseLogLine(raw);

    if (!thread) {
      systemLines.push(raw);
      // Only extract total from 'Started' message, not 'Launching'
      const m = msg.match(/Started.{0,5}(d+)s*account/i);
      if (m) batchTotal = parseInt(m[1]);
      continue;
    }

    if (!threadMap.has(thread)) {
      const num = parseInt(thread.replace('T', ''));
      threadMap.set(thread, { id: thread, num, status: 'idle', task: 'Waiting', detail: '', accountIdx: 0, total: 0, threadDone: 0, threadAssigned: 0 });
    }
    const t = threadMap.get(thread)!;

    const accMatch = msg.match(/Account\s+(\d+)\/(\d+)/);
    if (accMatch) {
      t.accountIdx = parseInt(accMatch[1]);
      t.total = parseInt(accMatch[2]);
    }

    if (msg.includes('starting'))       { t.status = 'working'; t.task = 'Starting'; t.detail = ''; t.threadAssigned++; }
    else if (msg.includes('Email:'))    { t.task = 'Creating email'; t.detail = msg.replace(/^Email:\s*/, ''); }
    else if (msg.includes('Chrome'))    { t.task = 'Launching browser'; t.detail = msg; }
    else if (msg.includes('Navigating')) { t.task = 'Navigating'; t.detail = ''; }
    else if (msg.includes('Filling form')) { t.task = 'Filling form'; t.detail = ''; }
    else if (msg.includes('Submitting')) { t.task = 'Submitting'; t.detail = ''; }
    else if (msg.includes('Solving captcha')) { t.task = 'Solving captcha'; t.detail = ''; }
    else if (msg.includes('Captcha solved')) { t.task = 'Captcha solved'; t.detail = '✓'; }
    else if (msg.includes('Verifying email')) { t.task = 'Verifying email'; t.detail = ''; }
    else if (msg.includes('Email verified')) { t.task = 'Email verified'; t.detail = '✓'; }
    else if (msg.includes('Creating API key')) { t.task = 'Creating API key'; t.detail = ''; }
    else if (msg.includes('API key error')) { t.task = 'API key error'; t.detail = msg.replace(/^API key error:\s*/, ''); }
    else if (msg.includes('Filling Ultraspeed')) { t.task = 'Ultraspeed form'; t.detail = ''; }
    else if (msg.includes('Ultraspeed error')) { t.task = 'Ultraspeed error'; t.detail = msg; }
    else if (msg.includes('✅')) { t.status = 'success'; t.task = 'Done'; t.threadDone++; t.detail = msg.replace(/^✅\s*/, '').replace(/Account\s+\d+\/\d+\s*/, ''); }
    else if (msg.includes('❌')) { t.status = 'failed'; t.task = 'Failed'; t.threadDone++; t.detail = msg.replace(/^❌\s*/, '').replace(/Account\s+\d+\/\d+\s*/, ''); }
    else if (msg.includes('Waiting')) { t.task = 'Cooldown'; t.detail = msg; }
  }

  const threads = Array.from(threadMap.values()).sort((a, b) => a.num - b.num);
  // Use thread totals if available, fallback to batchTotal
  const maxThreadTotal = threads.reduce((max, t) => Math.max(max, t.total), 0);
  const total = maxThreadTotal || batchTotal || threads.length;

  return {
    threads,
    systemLines,
    summary: { total, done: threads.reduce((s, t) => s + t.threadDone, 0), success: threads.reduce((s, t) => s + (t.status === "success" ? t.threadDone : 0), 0), failed: threads.reduce((s, t) => s + (t.status === "failed" ? t.threadDone : 0), 0) },
  };
}
const ACCENTS = [
  { bar: "bg-sky-400",     text: "text-sky-400",     bg: "bg-sky-500/8",     border: "border-sky-500/20" },
  { bar: "bg-violet-400",  text: "text-violet-400",  bg: "bg-violet-500/8",  border: "border-violet-500/20" },
  { bar: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-500/8",   border: "border-amber-500/20" },
  { bar: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
  { bar: "bg-rose-400",    text: "text-rose-400",    bg: "bg-rose-500/8",    border: "border-rose-500/20" },
  { bar: "bg-cyan-400",    text: "text-cyan-400",    bg: "bg-cyan-500/8",    border: "border-cyan-500/20" },
  { bar: "bg-orange-400",  text: "text-orange-400",  bg: "bg-orange-500/8",  border: "border-orange-500/20" },
  { bar: "bg-indigo-400",  text: "text-indigo-400",  bg: "bg-indigo-500/8",  border: "border-indigo-500/20" },
  { bar: "bg-lime-400",    text: "text-lime-400",    bg: "bg-lime-500/8",    border: "border-lime-500/20" },
  { bar: "bg-fuchsia-400", text: "text-fuchsia-400", bg: "bg-fuchsia-500/8", border: "border-fuchsia-500/20" },
  { bar: "bg-teal-400",    text: "text-teal-400",    bg: "bg-teal-500/8",    border: "border-teal-500/20" },
  { bar: "bg-red-300",     text: "text-red-300",     bg: "bg-red-400/8",     border: "border-red-400/20" },
  { bar: "bg-blue-300",    text: "text-blue-300",    bg: "bg-blue-400/8",    border: "border-blue-400/20" },
  { bar: "bg-green-300",   text: "text-green-300",   bg: "bg-green-400/8",   border: "border-green-400/20" },
  { bar: "bg-yellow-300",  text: "text-yellow-300",  bg: "bg-yellow-400/8",  border: "border-yellow-400/20" },
  { bar: "bg-pink-300",    text: "text-pink-300",    bg: "bg-pink-400/8",    border: "border-pink-400/20" },
  { bar: "bg-purple-300",  text: "text-purple-300",  bg: "bg-purple-400/8",  border: "border-purple-400/20" },
  { bar: "bg-cyan-300",    text: "text-cyan-300",    bg: "bg-cyan-400/8",    border: "border-cyan-400/20" },
  { bar: "bg-orange-300",  text: "text-orange-300",  bg: "bg-orange-400/8",  border: "border-orange-400/20" },
  { bar: "bg-indigo-300",  text: "text-indigo-300",  bg: "bg-indigo-400/8",  border: "border-indigo-400/20" },
];

function StatusDot({ s }: { s: ThreadState["status"] }) {
  if (s === "working") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (s === "success") return <span className="text-emerald-400 text-sm">✅</span>;
  if (s === "failed")  return <span className="text-red-400 text-sm">❌</span>;
  return <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />;
}

/* ── Component ───────────────────────────────────── */
export function LogTerminal({ logs, batchId, onClose }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [view, setView] = useState<"board" | "log">("board");

  const { threads, systemLines, summary } = useMemo(() => derive(logs), [logs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(logs.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  if (!batchId) return null;

  const hasThreads = threads.length > 1;
  const isRunning = threads.some(t => t.status === "working");

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`border border-border/40 rounded-xl overflow-hidden bg-[#0a0a0a] shadow-2xl shadow-black/40 ${expanded ? "fixed inset-2 sm:inset-4 z-50 flex flex-col" : ""}`}>

      {/* ── Title Bar ── */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 bg-[#111111] border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57] cursor-pointer" onClick={onClose} />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840] cursor-pointer" onClick={() => setExpanded(!expanded)} />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 pl-2 border-l border-white/[0.06] min-w-0">
            <TerminalIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-[10px] sm:text-xs font-medium text-zinc-400 shrink-0">terminal</span>
            {hasThreads && (
              <span className="text-[10px] text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded font-mono shrink-0 flex items-center gap-1">
                <Layers className="w-2.5 h-2.5" />{threads.length}T
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <div className="flex items-center bg-white/[0.04] rounded-md overflow-hidden mr-1">
            <button onClick={() => setView("board")}
              className={`px-1.5 sm:px-2 py-1 text-[9px] sm:text-[10px] font-mono transition-colors ${view === "board" ? "bg-white/[0.1] text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}>
              Board
            </button>
            <button onClick={() => setView("log")}
              className={`px-1.5 sm:px-2 py-1 text-[9px] sm:text-[10px] font-mono transition-colors ${view === "log" ? "bg-white/[0.1] text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}>
              Log
            </button>
          </div>
          <span className="text-[9px] sm:text-[10px] text-zinc-600 font-mono bg-white/[0.03] px-1.5 sm:px-2 py-0.5 rounded-md">{logs.length}</span>
          <button onClick={copyAll} className="p-1 sm:p-1.5 hover:bg-white/[0.06] rounded-md transition-colors">
            {copiedAll ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 sm:p-1.5 hover:bg-white/[0.06] rounded-md transition-colors hidden sm:block">
            {expanded ? <Minimize2 className="w-3.5 h-3.5 text-zinc-500" /> : <Maximize2 className="w-3.5 h-3.5 text-zinc-500" />}
          </button>
          <button onClick={onClose} className="p-1 sm:p-1.5 hover:bg-white/[0.06] rounded-md transition-colors">
            <X className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div ref={scrollRef} onScroll={handleScroll}
        className={`${expanded ? "flex-1 min-h-0" : "h-64 sm:h-80 md:h-[28rem]"} overflow-y-auto terminal-scroll`}>

        {view === "board" ? (
          <div className="p-3 sm:p-4 space-y-3">
            {/* Summary */}
            <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs font-mono text-zinc-500 pb-2 border-b border-white/[0.04]">
              <span>Total: <span className="text-zinc-300">{summary.total}</span></span>
              <span>Done: <span className="text-zinc-300">{summary.done}/{summary.total}</span></span>
              <span className="text-emerald-400">✓ {summary.success}</span>
              <span className="text-red-400">✗ {summary.failed}</span>
              {isRunning && <span className="text-amber-400 animate-pulse ml-auto">● Running</span>}
              {!isRunning && summary.done > 0 && <span className="text-zinc-400 ml-auto">Finished</span>}
            </div>

            {threads.length === 0 ? (
              <div className="text-center py-12 text-zinc-600">
                <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Waiting for threads…</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {threads.map(t => {
                  const ac = ACCENTS[(t.num - 1) % ACCENTS.length];
                  return (
                    <motion.div key={t.id} layout
                      className={`rounded-lg border ${ac.border} ${ac.bg} p-3 transition-colors`}>
                      {/* Header row */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <StatusDot s={t.status} />
                        <span className={`text-sm font-bold font-mono ${ac.text}`}>{t.id}</span>
                        {t.threadAssigned > 0 && (
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {t.threadDone}/{t.threadAssigned} of {t.total}
                          </span>
                        )}
                        {t.status === "working" && (
                          <div className="ml-auto flex items-center gap-1">
                            {[0, 150, 300].map(d => (
                              <div key={d} className={`w-1 h-1 rounded-full ${ac.bar} animate-bounce`} style={{ animationDelay: `${d}ms` }} />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Task line — this is what gets updated in place */}
                      <div className={`text-xs sm:text-sm font-medium ${
                        t.status === "success" ? "text-emerald-400"
                        : t.status === "failed" ? "text-red-400"
                        : "text-zinc-300"
                      }`}>
                        {t.task}
                      </div>

                      {/* Detail */}
                      {t.detail && (
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate max-w-full">
                          {t.detail}
                        </div>
                      )}

                      {/* Mini progress bar */}
                      {t.total > 0 && (
                        <div className="mt-2 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              t.status === "success" ? "bg-emerald-500/60"
                              : t.status === "failed" ? "bg-red-500/60"
                              : `${ac.bar}/60`
                            }`}
                            style={{ width: `${(t.threadDone / Math.max(t.threadAssigned, 1)) * 100}%` }}
                          />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* System log */}
            {systemLines.length > 0 && (
              <div className="pt-2 border-t border-white/[0.04]">
                <div className="text-[10px] text-zinc-600 font-mono mb-1 uppercase tracking-wider">System</div>
                {systemLines.map((raw, i) => {
                  const { time, msg } = parseLogLine(raw);
                  const color = msg.includes("🚀") || msg.includes("Done") ? "text-sky-400" : "text-zinc-500";
                  return (
                    <div key={i} className="text-[10px] sm:text-[11px] font-mono py-[1px]">
                      {time && <span className="text-zinc-700 mr-2">{time}</span>}
                      <span className={color}>{msg}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Raw Log ── */
          <div className="py-2 font-mono text-[10px] sm:text-[11px] leading-[1.9]">
            {logs.map((raw, i) => {
              const { time, msg, thread } = parseLogLine(raw);
              const c = msg.includes("✅") ? "text-emerald-400"
                : msg.includes("❌") ? "text-red-400"
                : msg.includes("🚀") || msg.includes("Done") ? "text-sky-400 font-semibold"
                : msg.includes("Email:") ? "text-cyan-400"
                : thread ? "text-zinc-400"
                : "text-zinc-500";
              return (
                <div key={i} className="flex items-start px-3 sm:px-4 py-[1px] hover:bg-white/[0.02]">
                  <span className="w-8 sm:w-10 shrink-0 text-right pr-2 sm:pr-3 text-zinc-700 select-none">{i + 1}</span>
                  {time && <span className="text-zinc-600 mr-2 shrink-0 hidden sm:inline">{time}</span>}
                  {thread && <span className="text-zinc-600 mr-1.5 shrink-0">[{thread}]</span>}
                  <span className={`${c} break-all`}>{msg}</span>
                </div>
              );
            })}
            <div className="flex items-center px-3 sm:px-4 py-[1px]">
              <span className="w-8 sm:w-10 shrink-0 text-right pr-2 sm:pr-3 text-zinc-700 select-none">{logs.length + 1}</span>
              <span className="inline-block w-2 h-4 bg-emerald-400/70 animate-pulse rounded-sm" />
            </div>
          </div>
        )}
      </div>

      {/* ── Status Bar ── */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 bg-[#111111] border-t border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[10px] text-zinc-600 font-mono">
          <span className="text-emerald-400">{summary.success} ok</span>
          <span className="text-zinc-700">│</span>
          <span className="text-red-400">{summary.failed} err</span>
          <span className="text-zinc-700">│</span>
          <span>{summary.done}/{summary.total} done</span>
        </div>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button onClick={() => { setAutoScroll(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }}
              className="flex items-center gap-1 text-[9px] sm:text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronDown className="w-3 h-3" /> bottom
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
