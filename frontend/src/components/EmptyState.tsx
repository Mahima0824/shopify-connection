import React from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "./primitives";

export type EmptyStateAction = { label: string; href: string };

export default function EmptyState({
  icon,
  title,
  body,
  primary,
  secondary,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  primary: EmptyStateAction;
  secondary?: EmptyStateAction;
}) {
  return (
    <Card className="flex flex-col items-center justify-center p-8 sm:p-14 text-center max-w-2xl mx-auto border-border/80 shadow-xs">
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-xs"
        >
          {icon}
        </div>
      )}
      <h3 className="text-xl font-heading font-bold text-foreground tracking-tight">{title}</h3>
      <p className="mt-2 mb-6 max-w-[440px] text-sm text-muted-foreground leading-relaxed mx-auto">{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 w-full sm:w-auto">
        <Button asChild className="max-[480px]:w-full font-semibold px-6 shadow-xs">
          <Link to={primary.href}>{primary.label}</Link>
        </Button>
        {secondary && (
          <Button asChild variant="outline" className="max-[480px]:w-full font-medium px-6">
            <Link to={secondary.href}>{secondary.label}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}