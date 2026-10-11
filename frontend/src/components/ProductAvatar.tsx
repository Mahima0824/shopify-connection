import React, { useState } from "react";

const GRADIENTS = [
  "from-blue-600 to-indigo-700 text-white border-blue-400/30",
  "from-emerald-600 to-teal-700 text-white border-emerald-400/30",
  "from-amber-500 to-orange-600 text-white border-amber-400/30",
  "from-purple-600 to-pink-600 text-white border-purple-400/30",
  "from-rose-600 to-red-700 text-white border-rose-400/30",
  "from-cyan-600 to-blue-700 text-white border-cyan-400/30",
  "from-violet-600 to-purple-700 text-white border-violet-400/30",
  "from-fuchsia-600 to-pink-700 text-white border-fuchsia-400/30",
];

function getProductInitials(title: string): string {
  if (!title) return "PR";
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getProductGradient(title: string): string {
  let hash = 0;
  for (let i = 0; i < (title || "").length; i++) {
    hash = (title.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  const index = Math.abs(hash) % GRADIENTS.length;
  return GRADIENTS[index];
}

export function ProductAvatar({
  imageUrl,
  title,
  className = "size-8",
}: {
  imageUrl?: string | null;
  title?: string | null;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const name = title || "Product";
  const initials = getProductInitials(name);
  const gradient = getProductGradient(name);

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        onError={() => setImgError(true)}
        className={`${className} rounded-lg border border-border object-cover bg-muted shrink-0 shadow-2xs`}
      />
    );
  }

  return (
    <div
      className={`${className} rounded-lg bg-gradient-to-br ${gradient} border flex items-center justify-center font-bold text-[10px] tracking-wider shrink-0 shadow-2xs`}
      title={name}
    >
      {initials}
    </div>
  );
}
export default ProductAvatar;
