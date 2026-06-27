"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Power, RotateCcw } from "lucide-react";

export interface Server {
  id: string;
  number: string;
  serviceName: string;
  osType: "windows" | "linux" | "ubuntu";
  serviceLocation: string;
  countryCode: "de" | "us" | "fr" | "jp";
  ip: string;
  dueDate: string;
  cpuPercentage: number;
  status: "active" | "paused" | "inactive";
}

interface ServerManagementTableProps {
  title?: string;
  servers?: Server[];
  onStatusChange?: (serverId: string, newStatus: Server["status"]) => void;
  className?: string;
}

const defaultServers: Server[] = [
  { id: "1", number: "01", serviceName: "VPS-2 (Windows)", osType: "windows", serviceLocation: "Frankfurt, Germany", countryCode: "de", ip: "198.51.100.211", dueDate: "14 Oct 2027", cpuPercentage: 80, status: "active" },
  { id: "2", number: "02", serviceName: "VPS-1 (Windows)", osType: "windows", serviceLocation: "Frankfurt, Germany", countryCode: "de", ip: "203.0.113.158", dueDate: "14 Oct 2027", cpuPercentage: 90, status: "active" },
  { id: "3", number: "03", serviceName: "VPS-1 (Ubuntu)", osType: "ubuntu", serviceLocation: "Paris, France", countryCode: "fr", ip: "192.0.2.37", dueDate: "27 Jun 2027", cpuPercentage: 50, status: "paused" },
  { id: "4", number: "04", serviceName: "Cloud Server (Ubuntu)", osType: "ubuntu", serviceLocation: "California, US West", countryCode: "us", ip: "198.51.100.23", dueDate: "30 May 2030", cpuPercentage: 95, status: "active" },
  { id: "5", number: "05", serviceName: "Dedicated Server (Windows)", osType: "windows", serviceLocation: "Virginia, US East", countryCode: "us", ip: "203.0.113.45", dueDate: "15 Dec 2026", cpuPercentage: 25, status: "inactive" },
];

export function ServerManagementTable({ title = "Active Services", servers: initialServers = defaultServers, onStatusChange, className = "" }: ServerManagementTableProps = {}) {
  const [servers, setServers] = useState<Server[]>(initialServers);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);

  const handleStatusChange = (serverId: string, newStatus: Server["status"]) => {
    if (onStatusChange) onStatusChange(serverId, newStatus);
    setServers(prev => prev.map(s => s.id === serverId ? { ...s, status: newStatus } : s));
  };

  useEffect(() => {
    if (selectedServer) {
      const updated = servers.find(s => s.id === selectedServer.id);
      if (updated) setSelectedServer(updated);
    }
  }, [servers, selectedServer]);

  const StatusBadge = ({ status }: { status: Server["status"] }) => {
    const m = { active: "bg-green-500/10 border-green-500/30 text-green-400", paused: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400", inactive: "bg-red-500/10 border-red-500/30 text-red-400" };
    const l = { active: "Active", paused: "Paused", inactive: "Inactive" };
    return <div className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg border flex items-center justify-center ${m[status]}`}><span className="text-xs sm:text-sm font-medium">{l[status]}</span></div>;
  };

  const CPUBars = ({ pct, status }: { pct: number; status: Server["status"] }) => {
    const filled = Math.round((pct / 100) * 10);
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex gap-0.5 sm:gap-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={`w-1 sm:w-1.5 h-4 sm:h-5 rounded-full transition-all duration-500 ${
              i >= filled ? "bg-muted/40 border border-border/30"
              : status === "active" ? "bg-foreground/60" : status === "paused" ? "bg-muted-foreground/50" : "bg-muted-foreground/30"
            }`} />
          ))}
        </div>
        <span className="text-xs sm:text-sm font-mono text-foreground font-medium min-w-[2.5rem]">{pct}%</span>
      </div>
    );
  };

  return (
    <div className={`w-full max-w-7xl mx-auto p-4 sm:p-6 ${className}`}>
      <div className="relative border border-border/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-card">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <h1 className="text-lg sm:text-xl font-medium text-foreground">{title}</h1>
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground">
              {servers.filter(s => s.status === "active").length} Active • {servers.filter(s => s.status === "inactive").length} Inactive
            </div>
          </div>
        </div>

        <motion.div className="space-y-2" variants={{ visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }} initial="hidden" animate="visible">
          {/* Desktop Headers */}
          <div className="hidden lg:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="col-span-1">No</div>
            <div className="col-span-2">Service Name</div>
            <div className="col-span-2">Location</div>
            <div className="col-span-2">IP</div>
            <div className="col-span-2">Due Date</div>
            <div className="col-span-2">CPU</div>
            <div className="col-span-1">Status</div>
          </div>

          {servers.map((server) => (
            <motion.div key={server.id}
              variants={{ hidden: { opacity: 0, x: -25, scale: 0.95, filter: "blur(4px)" }, visible: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)", transition: { type: "spring", stiffness: 400, damping: 28, mass: 0.6 } } }}
              className="relative cursor-pointer" onClick={() => setSelectedServer(server)}>
              <motion.div className="relative bg-muted/50 border border-border/50 rounded-lg sm:rounded-xl p-3 sm:p-4 overflow-hidden"
                whileHover={{ y: -1, transition: { type: "spring", stiffness: 400, damping: 25 } }}>
                <div className={`absolute inset-0 bg-gradient-to-l ${server.status === "active" ? "from-green-500/10" : server.status === "paused" ? "from-yellow-500/10" : "from-red-500/10"} to-transparent pointer-events-none`}
                  style={{ backgroundSize: "30% 100%", backgroundPosition: "right", backgroundRepeat: "no-repeat" }} />

                {/* Desktop */}
                <div className="hidden lg:grid relative grid-cols-12 gap-4 items-center">
                  <div className="col-span-1"><span className="text-2xl font-bold text-muted-foreground">{server.number}</span></div>
                  <div className="col-span-2"><span className="text-foreground font-medium">{server.serviceName}</span></div>
                  <div className="col-span-2"><span className="text-foreground">{server.serviceLocation}</span></div>
                  <div className="col-span-2"><span className="text-foreground font-mono text-sm">{server.ip}</span></div>
                  <div className="col-span-2"><span className="text-foreground">{server.dueDate}</span></div>
                  <div className="col-span-2"><CPUBars pct={server.cpuPercentage} status={server.status} /></div>
                  <div className="col-span-1"><StatusBadge status={server.status} /></div>
                </div>

                {/* Mobile */}
                <div className="lg:hidden relative space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-muted-foreground">{server.number}</span>
                      <span className="text-sm font-medium text-foreground truncate">{server.serviceName}</span>
                    </div>
                    <StatusBadge status={server.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{server.ip}</span>
                    <span>{server.serviceLocation}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <CPUBars pct={server.cpuPercentage} status={server.status} />
                    <span className="text-xs text-muted-foreground">{server.dueDate}</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>

        {/* Detail Overlay */}
        <AnimatePresence>
          {selectedServer && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col rounded-xl sm:rounded-2xl z-10 overflow-hidden">
              <div className="relative bg-gradient-to-r from-muted/50 to-transparent p-3 sm:p-4 border-b border-border/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    <div className="text-xl sm:text-2xl font-bold text-muted-foreground shrink-0">{selectedServer.number}</div>
                    <div className="min-w-0">
                      <h3 className="text-base sm:text-lg font-bold text-foreground truncate">{selectedServer.serviceName}</h3>
                      <span className="text-xs sm:text-sm text-muted-foreground">{selectedServer.serviceLocation}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {selectedServer.status === "active" ? (
                      <motion.button className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-md sm:rounded-lg text-xs sm:text-sm transition-colors"
                        onClick={() => handleStatusChange(selectedServer.id, "inactive")} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Power className="w-3 h-3" /><span className="hidden sm:inline">Stop</span>
                      </motion.button>
                    ) : (
                      <motion.button className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-md sm:rounded-lg text-xs sm:text-sm transition-colors"
                        onClick={() => handleStatusChange(selectedServer.id, "active")} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Power className="w-3 h-3" /><span className="hidden sm:inline">Start</span>
                      </motion.button>
                    )}
                    <motion.button className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-md sm:rounded-lg text-xs sm:text-sm transition-colors"
                      onClick={() => { handleStatusChange(selectedServer.id, "inactive"); setTimeout(() => handleStatusChange(selectedServer.id, "active"), 1000); }}
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <RotateCcw className="w-3 h-3" /><span className="hidden sm:inline">Restart</span>
                    </motion.button>
                    <motion.button className="w-7 h-7 sm:w-8 sm:h-8 bg-background/80 hover:bg-background rounded-full flex items-center justify-center border border-border/50"
                      onClick={() => setSelectedServer(null)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </motion.button>
                  </div>
                </div>
              </div>
              <div className="flex-1 p-3 sm:p-4 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                  <div className="bg-muted/40 rounded-lg p-2.5 sm:p-3 border border-border/30">
                    <label className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">IP Address</label>
                    <div className="text-xs sm:text-sm font-mono font-medium mt-1">{selectedServer.ip}</div>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2.5 sm:p-3 border border-border/30">
                    <label className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">Due Date</label>
                    <div className="text-xs sm:text-sm font-medium mt-1">{selectedServer.dueDate}</div>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2.5 sm:p-3 border border-border/30">
                    <label className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                    <div className="mt-1"><StatusBadge status={selectedServer.status} /></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
