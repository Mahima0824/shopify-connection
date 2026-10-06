import React from "react";
import LabelPreview from "../components/barcode/LabelPreview";
import { Button, Card } from "../components/primitives";

const CODES = ["P00000001", "P00000002"];

export default function TestSheetPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 max-[480px]:px-4 bg-background">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Barcode Test Sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Print this sheet to calibrate handheld laser scanners and phone cameras before warehouse deployment.
          </p>
        </div>
        <Button type="button" onClick={() => window.print()}>
          Print Test Sheet
        </Button>
      </Card>
      <div className="flex flex-col gap-6">
        {CODES.map((c) => (
          <LabelPreview key={c} businessName="Test Business" orderName="TEST-ORDER" parcelCode={c} />
        ))}
      </div>
    </div>
  );
}
