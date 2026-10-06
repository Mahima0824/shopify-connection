import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, Input, Label, Badge } from "../components/primitives";
import { IconAlert, IconSpark } from "../components/icons";

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
    <div className="flex min-h-screen min-h-dvh w-full items-center justify-center bg-background px-4 py-8">
      {/* Background ambient glow */}
      <div
        className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden"
        aria-hidden="true"
      >
        <div className="size-[500px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <Card className="relative z-10 w-full max-w-[440px] p-8 sm:p-10 shadow-xl border-border/80 bg-card rounded-2xl">
        {/* Brand Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary font-bold text-xl shadow-xs">
            R
          </div>
          <Badge variant="secondary" className="mb-2.5 text-[11px] font-semibold tracking-wider uppercase">
            Shopify ReconHub
          </Badge>
          <h1 className="font-heading font-bold tracking-tight text-foreground text-2xl sm:text-3xl mb-1.5">
            Welcome Back
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Sign in to access your Shopify Order Reconciliation platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-2.5 rounded-xl bg-destructive/10 px-4 py-3 text-xs sm:text-sm text-destructive border border-destructive/20"
          >
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={onSubmit} className="flex flex-col gap-4.5">
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <span className="text-[11px] text-muted-foreground">Demo: Pass123!</span>
            </div>
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
            className="mt-3 w-full h-10 font-semibold shadow-xs hover:shadow-md"
          >
            {loading ? "Signing in..." : "Sign In to ReconHub"}
          </Button>
        </form>

        {/* Demo Credentials Quick Fill */}
        <div className="mt-8 border-t border-border/80 pt-6 text-center">
          <p className="mb-3 text-xs text-muted-foreground">
            Testing locally? Quick-fill demo credentials:
          </p>
          <div className="flex justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={() => fillDemoCreds("admin@t.in")}
            >
              <IconSpark size={13} />
              Admin
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={() => fillDemoCreds("dash@t.in")}
            >
              <IconSpark size={13} />
              Dashboard
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
