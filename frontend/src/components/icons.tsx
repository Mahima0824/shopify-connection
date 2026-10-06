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

export function IconCalendar({ size = 16 }: IconProps) {
  return (
    <Base size={size}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Base>
  );
}

export function IconCalendarCompare({ size = 16 }: IconProps) {
  return (
    <Base size={size}>
      <rect x="3" y="4" width="14" height="14" rx="2" />
      <path d="M16 10h5v9a2 2 0 01-2 2h-9v-5" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="6" y1="2" x2="6" y2="6" />
    </Base>
  );
}

export function IconChevronDown({ size = 14 }: IconProps) {
  return (
    <Base size={size}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function IconChevronUp({ size = 14 }: IconProps) {
  return (
    <Base size={size}>
      <polyline points="18 15 12 9 6 15" />
    </Base>
  );
}

export function IconArrowUpRight({ size = 12 }: IconProps) {
  return (
    <Base size={size}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </Base>
  );
}

export function IconCurrencyExchange({ size = 16 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M17 4v6M17 4l3 3M17 4l-3 3" />
      <path d="M7 20v-6M7 20l-3-3M7 20l3-3" />
    </Base>
  );
}

