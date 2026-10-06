import React, { useEffect, useRef } from "react";

export default function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No-JS / no-observer safe: never leave content invisible when
    // IntersectionObserver is unavailable (e.g. old browsers, jsdom).
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    let fallback: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("is-visible");
            clearTimeout(fallback);
            io.disconnect();
          }
        }),
      { threshold: 0.15 }
    );
    io.observe(el);
    fallback = setTimeout(() => {
      el.classList.add("is-visible");
      io.disconnect();
    }, 1200);
    return () => {
      clearTimeout(fallback);
      io.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="reveal" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
