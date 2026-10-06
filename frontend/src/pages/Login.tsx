import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { IconAlert } from "../components/icons";

export default function LoginPage() {
  const navigate = useNavigate();
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
      navigate("/dashboard");
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
    <div className="min-h-screen min-h-dvh" style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--canvas)",
      padding: "20px"
    }}>
      <div style={{ width: "100%", maxWidth: "440px", padding: "40px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "12px" }}>

        {/* Brand Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "var(--neutral-bg)",
            border: "1px solid var(--hairline)",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: 600,
            margin: "0 auto 16px auto"
          }}>
            R
          </div>
          <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: "28px", marginBottom: "8px" }}>Welcome Back</h1>
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>
            Sign in to access your Shopify Order Reconciliation platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div role="alert" className="bg-[var(--error-bg)] text-[var(--ink)]" style={{
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
              className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
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
              className="w-full min-h-11 rounded-lg border border-[var(--hairline)] bg-white px-3.5 py-2.5 text-base text-[var(--ink)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full"
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
              className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full"
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={() => fillDemoCreds("admin@t.in")}
            >
              Admin Account
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full"
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
