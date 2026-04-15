"use client";

import { useMemo } from "react";
import type { PickedPoint, Point3 } from "./LasViewer";

type SectionPoint = {
  along: number;
  z: number;
};

function buildCrossSectionCloud(
  cloudPoints: Point3[],
  startPoint: PickedPoint | null,
  endPoint: PickedPoint | null,
  sliceWidth: number,
): SectionPoint[] {
  if (!startPoint || !endPoint || cloudPoints.length === 0) return [];

  const ax = startPoint.x;
  const ay = startPoint.y;
  const bx = endPoint.x;
  const by = endPoint.y;

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [];

  const ux = dx / len;
  const uy = dy / len;

  const section: SectionPoint[] = [];

  for (const p of cloudPoints) {
    const px = p.x - ax;
    const py = p.y - ay;

    const along = px * ux + py * uy;
    const perpX = px - along * ux;
    const perpY = py - along * uy;
    const perp = Math.sqrt(perpX * perpX + perpY * perpY);

    if (along < 0 || along > len) continue;
    if (perp > sliceWidth) continue;

    section.push({ along, z: p.z });
  }

  return section;
}

function buildCrossSectionTape(
  tapePoints: PickedPoint[],
  startPoint: PickedPoint | null,
  endPoint: PickedPoint | null,
): SectionPoint[] {
  if (!startPoint || !endPoint || tapePoints.length === 0) return [];

  const ax = startPoint.x;
  const ay = startPoint.y;
  const bx = endPoint.x;
  const by = endPoint.y;

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [];

  const ux = dx / len;
  const uy = dy / len;

  return tapePoints.map((p) => {
    const px = p.x - ax;
    const py = p.y - ay;
    return {
      along: px * ux + py * uy,
      z: p.z,
    };
  });
}

export default function CrossSectionView({
  cloudPoints,
  tapePoints,
  startPoint,
  endPoint,
  sliceWidth,
}: {
  cloudPoints: Point3[];
  tapePoints: PickedPoint[];
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  sliceWidth: number;
}) {
  const rawSection = useMemo(
    () => buildCrossSectionCloud(cloudPoints, startPoint, endPoint, sliceWidth),
    [cloudPoints, startPoint, endPoint, sliceWidth],
  );

  const tapeSection = useMemo(
    () => buildCrossSectionTape(tapePoints, startPoint, endPoint),
    [tapePoints, startPoint, endPoint],
  );

  const bounds = useMemo(() => {
    const all = [...rawSection, ...tapeSection];
    if (all.length === 0) return null;

    let minAlong = Infinity;
    let maxAlong = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const p of all) {
      if (p.along < minAlong) minAlong = p.along;
      if (p.along > maxAlong) maxAlong = p.along;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    if (minAlong === maxAlong) maxAlong += 1;
    if (minZ === maxZ) maxZ += 1;

    return { minAlong, maxAlong, minZ, maxZ };
  }, [rawSection, tapeSection]);

  // ---------- 安全ガード ----------
  if (!startPoint || !endPoint) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        始点と終点を置くと断面が表示されます
      </div>
    );
  }

  if (!bounds) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        スライス内に点がありません
      </div>
    );
  }

  // ---------- 描画設定 ----------
  const width = 1000;
  const height = 520;
  const padX = 48;
  const padY = 28;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  function sx(along: number) {
    const t = clamp((along - bounds.minAlong) / (bounds.maxAlong - bounds.minAlong));
    return padX + t * innerW;
  }

  function sy(z: number) {
    const t = clamp((z - bounds.minZ) / (bounds.maxZ - bounds.minZ));
    return height - padY - t * innerH;
  }

  const tapePath =
    tapeSection.length > 0
      ? tapeSection
          .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.along)} ${sy(p.z)}`)
          .join(" ")
      : "";

  return (
    <div className="h-full w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full rounded-md bg-slate-950"
        preserveAspectRatio="none"
      >
        {/* 背景 */}
        <rect width={width} height={height} fill="#020617" />

        {/* 枠 */}
        <rect
          x={padX}
          y={padY}
          width={innerW}
          height={innerH}
          fill="#020617"
          stroke="#1e293b"
        />

        {/* グリッド */}
        {Array.from({ length: 5 }).map((_, i) => {
          const y = padY + (innerH / 4) * i;
          return (
            <line key={i} x1={padX} y1={y} x2={padX + innerW} y2={y} stroke="#0f172a" />
          );
        })}

        {Array.from({ length: 6 }).map((_, i) => {
          const x = padX + (innerW / 5) * i;
          return (
            <line key={i} x1={x} y1={padY} x2={x} y2={padY + innerH} stroke="#0f172a" />
          );
        })}

        {/* 点群 */}
        {rawSection.map((p, i) => (
          <circle key={i} cx={sx(p.along)} cy={sy(p.z)} r="1.6" fill="#94a3b8" opacity="0.7" />
        ))}

        {/* テープ */}
        {tapePath && (
          <path
            d={tapePath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* テープ点 */}
        {tapeSection.map((p, i) => (
          <circle key={i} cx={sx(p.along)} cy={sy(p.z)} r="3" fill="#f59e0b" />
        ))}

        {/* ラベル */}
        <text x={padX} y={18} fill="#cbd5e1" fontSize="13">
          スライス幅 {(sliceWidth * 100).toFixed(0)}cm
        </text>

        <text x={padX} y={height - 6} fill="#64748b" fontSize="11">
          along
        </text>

        <text x={8} y={padY + 12} fill="#64748b" fontSize="11">
          z
        </text>
      </svg>
    </div>
  );
}