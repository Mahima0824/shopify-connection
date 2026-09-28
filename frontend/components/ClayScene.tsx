import React from "react";

type ClaySceneProps = { variant: "mountains" | "horizon" };

export default function ClayScene({ variant }: ClaySceneProps) {
  if (variant === "horizon") {
    return (
      <svg
        viewBox="0 0 1200 160"
        role="img"
        aria-label="Clay horizon illustration"
        preserveAspectRatio="xMidYMid slice"
      >
        <title>Clay horizon</title>
        <path
          d="M0 110 Q 150 60 300 95 T 600 95 T 900 90 T 1200 100 V160 H0 Z"
          fill="#ebe6d6"
        />
        <path
          d="M0 130 Q 200 95 420 120 T 820 118 T 1200 125 V160 H0 Z"
          fill="#e8b94a"
          opacity="0.85"
        />
        <circle cx="180" cy="128" r="6" fill="#a4d4c5" />
        <circle cx="640" cy="132" r="5" fill="#a4d4c5" />
        <circle cx="1010" cy="130" r="6" fill="#a4d4c5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 560 420"
      role="img"
      aria-label="Clay mountains illustration"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Clay mountains</title>
      <circle cx="420" cy="110" r="52" fill="#e8b94a" />
      <path
        d="M0 260 Q 90 150 190 220 T 380 210 T 560 240 V420 H0 Z"
        fill="#b8a4ed"
      />
      <path
        d="M0 300 Q 120 200 250 270 T 470 260 T 560 290 V420 H0 Z"
        fill="#ffb084"
        opacity="0.9"
      />
      <path
        d="M0 345 Q 140 260 300 325 T 560 330 V420 H0 Z"
        fill="#e8b94a"
      />
      <path
        d="M120 300 Q 200 250 290 295 Z"
        fill="#ffffff"
        opacity="0.35"
      />
      <path
        d="M330 320 Q 400 280 470 315 Z"
        fill="#ffffff"
        opacity="0.3"
      />
      <ellipse cx="120" cy="365" rx="90" ry="34" fill="#a4d4c5" opacity="0.7" />
      <ellipse cx="470" cy="385" rx="70" ry="26" fill="#a4d4c5" opacity="0.55" />
      <g transform="translate(380 250)">
        <rect x="0" y="0" width="120" height="110" rx="18" fill="#e8b94a" />
        <rect x="48" y="0" width="24" height="110" fill="#a4d4c5" />
        <circle cx="42" cy="52" r="5" fill="#0a0a0a" />
        <circle cx="78" cy="52" r="5" fill="#0a0a0a" />
        <path
          d="M45 70 Q 60 82 75 70"
          fill="none"
          stroke="#0a0a0a"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
