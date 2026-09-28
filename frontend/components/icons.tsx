import React from "react";

type IconProps = { size?: number };

function Base({
  size = 18,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconBox({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M3 8l9-4 9 4v8l-9 4-9-4V8z" />
      <path d="M3 8l9 4 9-4" />
      <path d="M12 12v8" />
    </Base>
  );
}

export function IconTag({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M3 12V4h8l9 9-8 8-9-9z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </Base>
  );
}

export function IconReturn({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h9a7 7 0 017 7v1" />
    </Base>
  );
}

export function IconAlert({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M12 4L2 20h20L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" />
    </Base>
  );
}

export function IconCoin({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8" />
      <path d="M9.5 10h4a1.8 1.8 0 010 3.6h-3a1.8 1.8 0 000 3.6h4" />
    </Base>
  );
}

export function IconReceipt({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </Base>
  );
}

export function IconTruck({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M2 6h12v10H2V6z" />
      <path d="M14 10h4l4 4v2h-8" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </Base>
  );
}

export function IconRefund({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M4 9a8 8 0 0114-3l2 2" />
      <path d="M20 4v4h-4" />
      <path d="M20 15a8 8 0 01-14 3l-2-2" />
      <path d="M4 20v-4h4" />
    </Base>
  );
}

export function IconSpark({ size = 18 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </Base>
  );
}
