import React, { useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "./Reveal";
import { Button, buttonVariants, Badge } from "./primitives";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface HeroSectionProps {
  onVideoClick?: () => void;
}

export default function HeroSection({ onVideoClick }: HeroSectionProps) {
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  const handleOpenVideo = () => {
    if (onVideoClick) {
      onVideoClick();
    } else {
      setIsVideoModalOpen(true);
    }
  };

  return (
    <>
      <section className="relative overflow-hidden bg-background py-16 sm:py-20 lg:py-24 border-b border-border/60">
        {/* Subtle theme-native gradient accent */}
        <div
          className="pointer-events-none absolute -top-40 -left-40 size-[500px] rounded-full bg-primary/5 blur-[120px]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-40 right-0 size-[450px] rounded-full bg-primary/5 blur-[120px]"
          aria-hidden="true"
        />

        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 xl:gap-20">
            {/* Left Content Column */}
            <div className="flex flex-col justify-center">
              <Reveal>
                <div className="mb-4">
                  <Badge variant="secondary" className="px-3.5 py-1 text-xs font-semibold uppercase tracking-wider">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse mr-1.5" />
                    Shopify &amp; ShipSagar Logistics
                  </Badge>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-[62px] font-bold font-heading tracking-tight text-foreground leading-[1.08]">
                  Build, Grow
                  <br />
                  &amp; Manage Your{" "}
                  <span className="relative inline-block whitespace-nowrap">
                    Brand
                    {/* Artistic wavy underline matching website primary theme */}
                    <svg
                      className="absolute -bottom-2 sm:-bottom-3 left-0 w-full h-3 sm:h-4 text-primary overflow-visible"
                      viewBox="0 0 140 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 13C24 4 44 15 68 8C92 2 112 14 137 7"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </h1>

                <p className="mt-6 text-base sm:text-lg text-muted-foreground font-normal leading-relaxed max-w-[520px]">
                  We automate your Shopify logistics and order fulfillment, hassle-free. From automated ShipSagar dispatches to India Post live tracking and real-time Tally accounting sync.
                </p>

                {/* Primary & Secondary CTA Buttons using project's primitives */}
                <div className="mt-8 flex flex-wrap items-center gap-3.5 sm:gap-4">
                  <Link
                    to="/orders"
                    className={cn(buttonVariants({ size: "lg" }), "rounded-full px-8 shadow-sm hover:shadow-md")}
                  >
                    Get Started
                  </Link>

                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-full px-6"
                    onClick={handleOpenVideo}
                    aria-label="Play video walkthrough"
                  >
                    <svg
                      className="size-4 fill-current text-foreground mr-1"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Play Video
                  </Button>
                </div>

                {/* Social Proof (Avatars + Merchant Count) */}
                <div className="mt-8 flex items-center gap-3.5">
                  <div className="flex -space-x-2.5 overflow-hidden">
                    <img
                      className="inline-block size-9 sm:size-10 rounded-full ring-2 ring-background object-cover"
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop&crop=faces"
                      alt="Verified merchant 1"
                      onError={(e) => {
                        e.currentTarget.src =
                          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='%230284c7'/><text x='20' y='25' fill='%23ffffff' font-size='15' text-anchor='middle' font-family='sans-serif'>SM</text></svg>";
                      }}
                    />
                    <img
                      className="inline-block size-9 sm:size-10 rounded-full ring-2 ring-background object-cover"
                      src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=faces"
                      alt="Verified merchant 2"
                      onError={(e) => {
                        e.currentTarget.src =
                          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='%232563eb'/><text x='20' y='25' fill='%23ffffff' font-size='15' text-anchor='middle' font-family='sans-serif'>RK</text></svg>";
                      }}
                    />
                    <img
                      className="inline-block size-9 sm:size-10 rounded-full ring-2 ring-background object-cover"
                      src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&h=120&fit=crop&crop=faces"
                      alt="Verified merchant 3"
                      onError={(e) => {
                        e.currentTarget.src =
                          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='%230d9488'/><text x='20' y='25' fill='%23ffffff' font-size='15' text-anchor='middle' font-family='sans-serif'>AL</text></svg>";
                      }}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs sm:text-sm font-bold text-foreground leading-tight">
                      1,000+
                    </span>
                    <span className="text-[11px] sm:text-xs text-muted-foreground">
                      Satisfied Clients
                    </span>
                  </div>
                </div>

                {/* 3-Column Metrics Row */}
                <div className="mt-12 pt-8 border-t border-border grid grid-cols-3 gap-4 sm:gap-8 max-w-[480px]">
                  <div>
                    <div className="text-2xl sm:text-3xl lg:text-[34px] font-bold font-heading tracking-tight text-foreground">
                      50+
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
                      Couriers
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl sm:text-3xl lg:text-[34px] font-bold font-heading tracking-tight text-foreground">
                      10+
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
                      Countries
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl sm:text-3xl lg:text-[34px] font-bold font-heading tracking-tight text-foreground">
                      21+
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
                      Offices
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Right Photo Composition Column */}
            <div className="relative flex items-end justify-center lg:justify-end gap-4 sm:gap-6 pt-4 lg:pt-0">
              <Reveal delay={150}>
                {/* Left offset photo: Professional smiling at desk with notebook */}
                <div className="w-[145px] sm:w-[210px] md:w-[250px] lg:w-[220px] xl:w-[260px] self-end mb-4 sm:mb-8 group">
                  <div className="overflow-hidden rounded-2xl sm:rounded-3xl shadow-md border border-border/80 bg-card transition-all duration-300 group-hover:shadow-xl group-hover:border-primary/40">
                    <img
                      src="/images/hero-workspace.jpg"
                      alt="Business owner managing orders at desk"
                      className="w-full h-auto object-cover aspect-[4/3] group-hover:scale-104 transition-transform duration-500"
                      loading="eager"
                    />
                  </div>
                </div>
              </Reveal>

              <Reveal delay={250}>
                {/* Right tall photo: Clean modern workspace setup */}
                <div className="w-[165px] sm:w-[240px] md:w-[290px] lg:w-[260px] xl:w-[310px] group">
                  <div className="overflow-hidden rounded-2xl sm:rounded-3xl shadow-lg border border-border/80 bg-card transition-all duration-300 group-hover:shadow-2xl group-hover:border-primary/40">
                    <img
                      src="/images/hero-desk.jpg"
                      alt="Minimalist workspace setup for fulfillment"
                      className="w-full h-auto object-cover aspect-[9/16] group-hover:scale-104 transition-transform duration-500"
                      loading="eager"
                    />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Video / Product Walkthrough Modal using Shadcn Dialog */}
      <Dialog open={isVideoModalOpen} onOpenChange={setIsVideoModalOpen}>
        <DialogContent className="sm:max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Shopify Order &amp; ShipSagar Logistics Demo
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              See real-time order sync, barcode dispatch scanning, and Tally accounting ledger
            </DialogDescription>
          </DialogHeader>

          <div className="relative aspect-video overflow-hidden rounded-xl bg-muted border border-border flex flex-col items-center justify-center text-center p-6 mt-2">
            <div className="size-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 mb-3 animate-bounce">
              <svg className="size-7 fill-current ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h4 className="text-base font-semibold text-foreground">Full Platform Tour</h4>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              1. Sync Shopify orders &rarr; 2. Add ShipSagar live courier shipment &rarr; 3. Scan barcode at dispatch station &rarr; 4. Reconcile Tally vouchers.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5 justify-center">
              <Link
                to="/orders"
                onClick={() => setIsVideoModalOpen(false)}
                className={buttonVariants({ size: "sm" })}
              >
                Explore Live Orders Table &rarr;
              </Link>
              <Link
                to="/scan/dispatch"
                onClick={() => setIsVideoModalOpen(false)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open Dispatch Scanner
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
