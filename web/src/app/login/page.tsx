"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn, Eye, EyeOff, Shield } from "lucide-react";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(username, password);
      if (res.ok) {
        router.push("/");
      } else {
        setError(res.error || "Login failed");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-foreground/5 border border-border/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-foreground/70" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">MiMo Register</h1>
          <p className="text-sm text-muted-foreground mt-1">Admin Login</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username"
              className="w-full h-11 px-4 rounded-xl bg-muted/50 border border-border/50 text-sm focus:outline-none focus:border-foreground/30 transition-colors"
              placeholder="admin" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Password</label>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full h-11 px-4 pr-11 rounded-xl bg-muted/50 border border-border/50 text-sm focus:outline-none focus:border-foreground/30 transition-colors"
                placeholder="••••••••" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </motion.div>
          )}

          <motion.button type="submit" disabled={loading || !username || !password}
            className="w-full h-11 rounded-xl bg-foreground text-background font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            whileTap={{ scale: 0.97 }}>
            {loading
              ? <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
              : <><LogIn className="w-4 h-4" /> Sign In</>}
          </motion.button>
        </form>

        {/* Status page link */}
        <div className="mt-6 text-center">
          <a href="/status" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            View public status page →
          </a>
        </div>
      </motion.div>
    </div>
  );
}
