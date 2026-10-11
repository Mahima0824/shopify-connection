import React from "react";

export type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  className?: string;
};

function Base({
  size = 18,
  className,
  children,
  ...props
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
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconBox({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M3 8l9-4 9 4v8l-9 4-9-4V8z" />
      <path d="M3 8l9 4 9-4" />
      <path d="M12 12v8" />
    </Base>
  );
}

export function IconTag({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M3 12V4h8l9 9-8 8-9-9z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </Base>
  );
}

export function IconReturn({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h9a7 7 0 017 7v1" />
    </Base>
  );
}

export function IconAlert({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M12 4L2 20h20L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" />
    </Base>
  );
}

export function IconCoin({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8" />
      <path d="M9.5 10h4a1.8 1.8 0 010 3.6h-3a1.8 1.8 0 000 3.6h4" />
    </Base>
  );
}

export function IconReceipt({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </Base>
  );
}

export function IconTruck({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M2 6h12v10H2V6z" />
      <path d="M14 10h4l4 4v2h-8" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </Base>
  );
}

export function IconRefund({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M4 9a8 8 0 0114-3l2 2" />
      <path d="M20 4v4h-4" />
      <path d="M20 15a8 8 0 01-14 3l-2-2" />
      <path d="M4 20v-4h4" />
    </Base>
  );
}

export function IconSpark({ size = 18, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </Base>
  );
}

export function IconCalendar({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Base>
  );
}

export function IconCalendarCompare({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <rect x="3" y="4" width="14" height="14" rx="2" />
      <path d="M16 10h5v9a2 2 0 01-2 2h-9v-5" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="6" y1="2" x2="6" y2="6" />
    </Base>
  );
}

export function IconChevronDown({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function IconChevronUp({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="18 15 12 9 6 15" />
    </Base>
  );
}

export function IconArrowUpRight({ size = 12, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </Base>
  );
}

export function IconCurrencyExchange({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M17 4v6M17 4l3 3M17 4l-3 3" />
      <path d="M7 20v-6M7 20l-3-3M7 20l3-3" />
    </Base>
  );
}

export function IconMapPin({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </Base>
  );
}

export function IconCopy({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </Base>
  );
}

export function IconCheck({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Base>
  );
}

export function IconExternalLink({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </Base>
  );
}

export function IconClock({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Base>
  );
}

export function IconRefresh({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </Base>
  );
}

export function IconMoreVertical({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" />
    </Base>
  );
}

export function IconEdit({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Base>
  );
}

export function IconTrash({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </Base>
  );
}

/* Added when emoji were removed from option labels and button rows. Each maps
   to the glyph it replaced, so carrier codes stay distinguishable without
   relying on the OS emoji font. */
export function IconPlane({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M17.8 19.2L16 11l3.5-3.5a2.12 2.12 0 10-3-3L13 8 4.8 6 3 8l6 2.2L6.2 13 3 15l1.8 1.8L8 15l2.8 2.8L9 19.6l1.8 1.8L13 18.4 16.2 16 17.8 19.2z" />
    </Base>
  );
}

export function IconFlag({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </Base>
  );
}

export function IconMessage({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.9 9.9 0 01-4.2-.9L3 20.5l1.6-4.3A8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" />
    </Base>
  );
}

export function IconPhone({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
    </Base>
  );
}

export function IconDownload({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Base>
  );
}

export function IconUpload({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Base>
  );
}

export function IconSearch({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.7" y2="16.7" />
    </Base>
  );
}

export function IconUser({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Base>
  );
}

export function IconGrid({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </Base>
  );
}

export function IconPackage({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M16.5 9.4L7.5 4.2" />
      <path d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.3 7 12 12 20.7 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </Base>
  );
}

export function IconStore({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9" />
      <path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" />
    </Base>
  );
}

export function IconChart({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </Base>
  );
}

export function IconPin({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </Base>
  );
}

export function IconInfo({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </Base>
  );
}

export function IconWarning({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Base>
  );
}

export function IconClose({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  );
}

export function IconChevronLeft({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </Base>
  );
}

export function IconChevronRight({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Base>
  );
}

export function IconPlus({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Base>
  );
}

export function IconPlay({ size = 14, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <polygon points="6 4 20 12 6 20" />
    </Base>
  );
}

export function IconSun({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </Base>
  );
}

export function IconMoon({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </Base>
  );
}

export function IconArrowUp({ size = 16, className, ...props }: IconProps) {
  return (
    <Base size={size} className={className} {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </Base>
  );
}
