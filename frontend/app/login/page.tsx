"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await api<{ token: string }>(`/api/v1/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("token", data.token);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  const fillDemoCreds = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("Pass123!");
  };

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0b0f19 75%)",
      padding: "20px"
    }}>
      <div className="glass-card" style={{ width: "100%", maxWidth: "440px", padding: "40px" }}>
        
        {/* Brand Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            background: "var(--accent-gradient)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
            margin: "0 auto 16px auto",
            boxShadow: "0 8px 24px rgba(99, 102, 241, 0.4)"
          }}>
            ⚡
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>Welcome Back</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            Sign in to access your Shopify Order Reconciliation platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#f87171",
            padding: "12px 16px",
            borderRadius: "8px",
            fontSize: "14px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}>
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px", color: "var(--text-muted)" }}>
              Email Address
            </label>
            <input
              className="input-control"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px", color: "var(--text-muted)" }}>
              Password
            </label>
            <input
              className="input-control"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ marginTop: "8px", padding: "14px" }}
          >
            {loading ? "Signing in..." : "Sign In to ReconHub"}
          </button>
        </form>

        {/* Demo Credentials Quick Fill */}
        <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid var(--border-color)", textAlign: "center" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>
            Testing locally? Click to fill test accounts:
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={() => fillDemoCreds("admin@t.in")}
            >
              Admin Account
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={() => fillDemoCreds("dash@t.in")}
            >
              Dashboard User
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
