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
    <Card className="items-center gap-2 py-12 text-center">
      {icon && (
        <div
          aria-hidden="true"
          className="mb-2 flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground"
        >
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-4 max-w-[420px] text-sm text-muted-foreground">{body}</p>
      <div className="flex flex-wrap justify-center gap-3 max-[480px]:w-full">
        <Button asChild className="max-[480px]:w-full">
          <Link to={primary.href}>{primary.label}</Link>
        </Button>
        {secondary && (
          <Button asChild variant="outline" className="max-[480px]:w-full">
            <Link to={secondary.href}>{secondary.label}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}