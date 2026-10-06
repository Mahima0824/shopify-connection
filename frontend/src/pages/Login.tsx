import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, Input, Label } from "../components/primitives";
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
    <div className="flex min-h-screen min-h-dvh w-full items-center justify-center bg-background p-5">
      <Card className="w-full max-w-[440px] p-8 sm:p-10 shadow-none">
        {/* Brand Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-xl font-bold text-foreground">
            R
          </div>
          <h1 className="font-bold tracking-tight text-foreground text-2xl mb-2">Welcome Back</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to access your Shopify Order Reconciliation platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div role="alert" className="mb-6 flex items-center gap-2.5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive border border-destructive/20">
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 w-full"
          >
            {loading ? "Signing in..." : "Sign In to ReconHub"}
          </Button>
        </form>

        {/* Demo Credentials Quick Fill */}
        <div className="mt-8 border-t border-border pt-6 text-center">
          <p className="mb-3 text-xs text-muted-foreground">
            Testing locally? Click to fill test accounts:
          </p>
          <div className="flex justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-8 px-3 text-xs"
              onClick={() => fillDemoCreds("admin@t.in")}
            >
              Admin Account
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-8 px-3 text-xs"
              onClick={() => fillDemoCreds("dash@t.in")}
            >
              Dashboard User
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
