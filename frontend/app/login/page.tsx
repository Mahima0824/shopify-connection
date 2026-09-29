"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { IconAlert } from "../../components/icons";

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
    <div className="fullscreen-center" style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--canvas)",
      padding: "20px"
    }}>
      <div style={{ width: "100%", maxWidth: "440px", padding: "40px", background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: "24px" }}>

        {/* Brand Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "var(--brand-ochre)",
            color: "var(--ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: 600,
            margin: "0 auto 16px auto"
          }}>
            R
          </div>
          <h1 className="display" style={{ fontSize: "28px", marginBottom: "8px" }}>Welcome Back</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>
            Sign in to access your Shopify Order Reconciliation platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div role="alert" className="badge-danger" style={{
            padding: "12px 16px",
            borderRadius: "12px",
            fontSize: "14px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}>
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
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
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
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
            style={{ marginTop: "8px", padding: "14px", minHeight: "44px" }}
          >
            {loading ? "Signing in..." : "Sign In to ReconHub"}
          </button>
        </form>

        {/* Demo Credentials Quick Fill */}
        <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid var(--hairline)", textAlign: "center" }}>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px" }}>
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
