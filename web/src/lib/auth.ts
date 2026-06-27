"use client";

const API = "";

export async function login(username: string, password: string): Promise<{ ok: boolean; role?: string; error?: string }> {
  const res = await fetch(`${API}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/logout`, { method: "POST", credentials: "include" });
}

export async function getMe(): Promise<{ ok: boolean; role?: string }> {
  try {
    const res = await fetch(`${API}/api/me`, { credentials: "include" });
    if (!res.ok) return { ok: false };
    return res.json();
  } catch {
    return { ok: false };
  }
}
