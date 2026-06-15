"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) setSent(true);
    else setError((await res.json().catch(() => ({})))?.error ?? "Something went wrong");
  }

  return (
    <main style={{ maxWidth: 400, margin: "96px auto", padding: 24, background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Reliquify</h1>
      <p style={{ color: "#555" }}>Sign in with a magic link.</p>
      {sent ? (
        <p>Check your email for a sign-in link. It expires in 15 minutes.</p>
      ) : (
        <form onSubmit={submit}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@brokerage.com"
            style={{ width: "100%", padding: 10, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, boxSizing: "border-box" }}
          />
          <button type="submit" style={{ marginTop: 12, width: "100%", padding: 10, fontSize: 15, background: "#1e3a5f", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>
            Send sign-in link
          </button>
          {error && <p style={{ color: "#b00", fontSize: 13 }}>{error}</p>}
        </form>
      )}
    </main>
  );
}
