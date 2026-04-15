"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { load } from "@loaders.gl/core";
import { LASLoader } from "@loaders.gl/las";
import PointCloudCanvas from "./PointCloudCanvas";
import CrossSectionView from "./CrossSectionView";

export type Point3 = {
  x: number;
  y: number;
  z: number;
};

export type PickedPoint = {
  x: number;
  y: number;
  z: number;
};

type LoadState = "idle" | "loading" | "loaded" | "error";
type ViewMode = "top" | "angled";

function toPointsFromLasData(data: unknown): Point3[] {
  const rows: Point3[] = [];

  const candidate = data as {
    attributes?: {
      POSITION?: { value?: Float32Array | Float64Array | number[] };
      position?: { value?: Float32Array | Float64Array | number[] };
    };
  };

  const attr =
    candidate?.attributes?.POSITION?.value ??
    candidate?.attributes?.position?.value;

  if (!attr) return rows;

  for (let i = 0; i < attr.length; i += 3) {
    rows.push({
      x: Number(attr[i]),
      y: Number(attr[i + 1]),
      z: Number(attr[i + 2]),
    });
  }

  return rows;
}

function distance3D(a: PickedPoint, b: PickedPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function computeTapeSamplePoints(
  sourcePoints: Point3[],
  startPoint: PickedPoint | null,
  endPoint: PickedPoint | null,
  divisionCount: number,
  searchRadius: number,
  sliceWidth: number,
): PickedPoint[] {
  if (!startPoint || !endPoint) return [];
  if (divisionCount < 1 || sourcePoints.length === 0) return [];

  const ax = startPoint.x;
  const ay = startPoint.y;
  const az = startPoint.z;
  const bx = endPoint.x;
  const by = endPoint.y;
  const bz = endPoint.z;

  const dx = bx - ax;
  const dy = by - ay;
  const baseLen = Math.sqrt(dx * dx + dy * dy);

  if (baseLen === 0) {
    return [startPoint, endPoint];
  }

  const ux = dx / baseLen;
  const uy = dy / baseLen;

  const samples: PickedPoint[] = [];
  const step = baseLen / divisionCount;
  const alongWindow = Math.max(step * 0.5, searchRadius);

  for (let i = 0; i <= divisionCount; i++) {
    const targetAlong = step * i;
    const targetX = ax + ux * targetAlong;
    const targetY = ay + uy * targetAlong;
    const targetZ = az + ((bz - az) * i) / divisionCount;

  const candidates: Array<{
  point: Point3;
  alongError: number;
  perpDist: number;
  targetZError: number;
  score: number;
}> = [];

    for (const p of sourcePoints) {
      const px = p.x - ax;
      const py = p.y - ay;

      const along = px * ux + py * uy;
      const perpX = px - along * ux;
      const perpY = py - along * uy;
      const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
      const alongError = Math.abs(along - targetAlong);

      if (along < -searchRadius || along > baseLen + searchRadius) continue;
      if (alongError > alongWindow) continue;
      if (perpDist > sliceWidth) continue;

      const targetZError = Math.abs(p.z - targetZ);
const score = perpDist * 0.7 + alongError * 0.15 + targetZError * 0.15;

candidates.push({
  point: p,
  alongError,
  perpDist,
  targetZError,
  score,
});
    }

    if (candidates.length === 0) {
      let fallback: Point3 | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;

      for (const p of sourcePoints) {
        const ddx = p.x - targetX;
        const ddy = p.y - targetY;
        const distSq = ddx * ddx + ddy * ddy;
        if (distSq < bestDistSq && distSq <= searchRadius * searchRadius) {
          fallback = p;
          bestDistSq = distSq;
        }
      }

      if (fallback) {
        samples.push({
          x: fallback.x,
          y: fallback.y,
          z: fallback.z,
        });
      } else {
        samples.push({
          x: targetX,
          y: targetY,
          z: targetZ,
        });
      }

      continue;
    }

   candidates.sort((a, b) => a.score - b.score);
const top = candidates.slice(0, Math.min(candidates.length, 8));

let chosen = top[0];

if (top.length > 1) {
  const prevSample = samples.length > 0 ? samples[samples.length - 1] : null;
  const prevPrevSample = samples.length > 1 ? samples[samples.length - 2] : null;

  let bestContinuityScore = Number.POSITIVE_INFINITY;

  for (const candidate of top) {
    let continuityPenalty = 0;

    if (prevSample) {
      const dz = candidate.point.z - prevSample.z;
      continuityPenalty += Math.abs(dz) * 2.0;

      const dx = candidate.point.x - prevSample.x;
      const dy = candidate.point.y - prevSample.y;
      const stepDist = Math.sqrt(dx * dx + dy * dy);
      continuityPenalty += Math.abs(stepDist - step) * 0.8;
    }

    if (prevSample && prevPrevSample) {
      const prevDz = prevSample.z - prevPrevSample.z;
      const currentDz = candidate.point.z - prevSample.z;
      continuityPenalty += Math.abs(currentDz - prevDz) * 3.0;
    }

    const totalScore = candidate.score + continuityPenalty;

    if (totalScore < bestContinuityScore) {
      bestContinuityScore = totalScore;
      chosen = candidate;
    }
  }
}

samples.push({
  x: chosen.point.x,
  y: chosen.point.y,
  z: chosen.point.z,
});
  }

  return samples;
}

export default function LasViewer() {
  const [points, setPoints] = useState<Point3[]>([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [startPoint, setStartPoint] = useState<PickedPoint | null>(null);
  const [endPoint, setEndPoint] = useState<PickedPoint | null>(null);

  const [maxDisplayPoints, setMaxDisplayPoints] = useState(600000);
  const [zScale, setZScale] = useState(1);
  const [pointSize, setPointSize] = useState(0.008);
  const [viewMode, setViewMode] = useState<ViewMode>("top");
  const [viewResetKey, setViewResetKey] = useState(0);
  const [focusWidth, setFocusWidth] = useState(6);

  const [divisionCount, setDivisionCount] = useState(8);
  const [searchRadius, setSearchRadius] = useState(0.1);
  const [sliceWidth, setSliceWidth] = useState(0.15);
  const [isPinned, setIsPinned] = useState(false);

  const [leftWidth, setLeftWidth] = useState(360);
  const [rightWidth, setRightWidth] = useState(380);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const displayPoints = useMemo(() => {
    if (points.length <= maxDisplayPoints) {
      return points;
    }

    const step = Math.ceil(points.length / maxDisplayPoints);
    const sampled: Point3[] = [];

    for (let i = 0; i < points.length; i += step) {
      sampled.push(points[i]);
    }

    return sampled;
  }, [points, maxDisplayPoints]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    return {
      count: points.length,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    };
  }, [points]);

  const pickedDistance = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return distance3D(startPoint, endPoint);
  }, [startPoint, endPoint]);

  const tapePoints = useMemo(() => {
    return computeTapeSamplePoints(
      displayPoints,
      startPoint,
      endPoint,
      divisionCount,
      searchRadius,
      sliceWidth,
    );
  }, [displayPoints, startPoint, endPoint, divisionCount, searchRadius, sliceWidth]);

  const tapeDistance = useMemo(() => {
    if (tapePoints.length < 2) return null;

    let total = 0;
    for (let i = 1; i < tapePoints.length; i++) {
      total += distance3D(tapePoints[i - 1], tapePoints[i]);
    }
    return total;
  }, [tapePoints]);

  function handlePick(point: PickedPoint) {
    if (isPinned) return;

    if (!startPoint || endPoint) {
      setStartPoint(point);
      setEndPoint(null);
      return;
    }

    setEndPoint(point);
  }

  function clearPickedPoints() {
    setStartPoint(null);
    setEndPoint(null);
    setIsPinned(false);
  }

  function resetMeasuredPointsOnly() {
    setStartPoint(null);
    setEndPoint(null);
  }

  function resetCamera(nextMode?: ViewMode) {
    if (nextMode) {
      setViewMode(nextMode);
    }
    setViewResetKey((prev) => prev + 1);
  }

  function startResize(side: "left" | "right") {
    function onMove(event: MouseEvent) {
      if (side === "left") {
        setLeftWidth(clamp(event.clientX - 16, 260, 640));
      } else {
        const newWidth = clamp(window.innerWidth - event.clientX - 16, 300, 700);
        setRightWidth(newWidth);
      }
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const savedLeftWidth = window.localStorage.getItem("las-left-width");
    const savedRightWidth = window.localStorage.getItem("las-right-width");
    const savedLeftCollapsed = window.localStorage.getItem("las-left-collapsed");
    const savedRightCollapsed = window.localStorage.getItem("las-right-collapsed");

    if (savedLeftWidth) setLeftWidth(Number(savedLeftWidth));
    if (savedRightWidth) setRightWidth(Number(savedRightWidth));
    if (savedLeftCollapsed) setLeftCollapsed(savedLeftCollapsed === "true");
    if (savedRightCollapsed) setRightCollapsed(savedRightCollapsed === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("las-left-width", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    window.localStorage.setItem("las-right-width", String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    window.localStorage.setItem("las-left-collapsed", String(leftCollapsed));
  }, [leftCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("las-right-collapsed", String(rightCollapsed));
  }, [rightCollapsed]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("loading");
    setErrorMessage("");
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const data = await load(buffer, LASLoader);
      const parsed = toPointsFromLasData(data);

      if (parsed.length === 0) {
        throw new Error("点群を読み込めませんでした。LAS形式を確認してください。");
      }

      setPoints(parsed);
      setStatus("loaded");
      setViewResetKey((prev) => prev + 1);
    } catch (error) {
      console.error(error);
      setPoints([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
      );
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <PointCloudCanvas
        points={displayPoints}
        startPoint={startPoint}
        endPoint={endPoint}
        onPickPoint={handlePick}
        zScale={zScale}
        pointSize={pointSize}
        viewMode={viewMode}
        viewResetKey={viewResetKey}
        focusWidth={focusWidth}
        sliceWidth={sliceWidth}
        tapePoints={tapePoints}
      />

      {!leftCollapsed ? (
        <aside
          style={{ width: leftWidth }}
          className="absolute left-4 top-4 bottom-4 z-10 rounded-2xl border border-cyan-200/10 bg-slate-900/45 shadow-2xl backdrop-blur-md"
        >
          <div className="h-full overflow-y-auto p-4 overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-cyan-50">
                  LAS Viewer
                </h1>
                <p className="mt-2 text-sm text-slate-300">
                  点群を背景空間として表示し、法面計測の土台にする。
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLeftCollapsed(true)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm hover:bg-white/10"
              >
                ◀
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-cyan-100/80">
                LASファイル
              </label>
              <input
                type="file"
                accept=".las,.laz"
                onChange={handleFileChange}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:px-3 file:py-2 file:text-sm file:font-medium file:text-cyan-50 hover:file:bg-cyan-500/30"
              />
              <div className="mt-2 break-all text-xs text-slate-300">
                {fileName || "未選択"}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                計測点
              </div>

              <div className="mt-2 text-sm">
                <div>
                  <span className="text-slate-400">始点:</span>{" "}
                  {startPoint
                    ? `${startPoint.x.toFixed(2)}, ${startPoint.y.toFixed(2)}, ${startPoint.z.toFixed(2)}`
                    : "-"}
                </div>
                <div className="mt-1">
                  <span className="text-slate-400">終点:</span>{" "}
                  {endPoint
                    ? `${endPoint.x.toFixed(2)}, ${endPoint.y.toFixed(2)}, ${endPoint.z.toFixed(2)}`
                    : "-"}
                </div>
                <div className="mt-1">
                  <span className="text-slate-400">直線距離:</span>{" "}
                  {pickedDistance !== null ? `${pickedDistance.toFixed(3)} m` : "-"}
                </div>
                <div className="mt-1">
                  <span className="text-slate-400">沿わせ長:</span>{" "}
                  {tapeDistance !== null ? `${tapeDistance.toFixed(3)} m` : "-"}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearPickedPoints}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
                >
                  点をクリア
                </button>

                <button
                  type="button"
                  onClick={resetMeasuredPointsOnly}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
                >
                  測点リセット
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsPinned((prev) => !prev)}
                className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
              >
                {isPinned ? "ピン留め解除" : "この2点をピン留め"}
              </button>

              <div className="mt-2 text-xs text-slate-400">
                ピン状態: {isPinned ? "固定中" : "未固定"}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                テープ設定
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  分割数: {divisionCount}
                </label>
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={divisionCount}
                  onChange={(e) =>
                    setDivisionCount(clamp(Number(e.target.value), 2, 20))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  近傍探索半径: {(searchRadius * 100).toFixed(0)} cm
                </label>
                <input
                  type="range"
                  min={0.005}
max={0.05}
step={0.005}
                  value={searchRadius}
                  onChange={(e) =>
                    setSearchRadius(clamp(Number(e.target.value), 0.01, 1))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  断面スライス幅: {(sliceWidth * 100).toFixed(0)} cm
                </label>
                <input
                  type="range"
                  min={0.01}
max={0.1}
step={0.005}
                  value={sliceWidth}
                  onChange={(e) =>
                    setSliceWidth(clamp(Number(e.target.value), 0.01, 1))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3 text-xs text-slate-400">
                サンプル点数: {tapePoints.length}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                表示設定
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  表示点数上限: {maxDisplayPoints.toLocaleString()}
                </label>
                <input
                  type="range"
                  min={100000}
                  max={2000000}
                  step={100000}
                  value={maxDisplayPoints}
                  onChange={(e) =>
                    setMaxDisplayPoints(clamp(Number(e.target.value), 100000, 2000000))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  Z誇張: {zScale.toFixed(2)}x
                </label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.05}
                  value={zScale}
                  onChange={(e) =>
                    setZScale(clamp(Number(e.target.value), 1, 5))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  点サイズ: {pointSize.toFixed(3)}
                </label>
                <input
                  type="range"
                  min={0.001}
                  max={0.05}
                  step={0.001}
                  value={pointSize}
                  onChange={(e) =>
                    setPointSize(clamp(Number(e.target.value), 0.001, 0.05))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  計測ライン強調幅: {focusWidth.toFixed(1)} m
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.5}
                  value={focusWidth}
                  onChange={(e) =>
                    setFocusWidth(clamp(Number(e.target.value), 1, 20))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resetCamera("top")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  真上
                </button>
                <button
                  type="button"
                  onClick={() => resetCamera("angled")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  斜め
                </button>
                <button
                  type="button"
                  onClick={() => resetCamera()}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  リセット
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-400">
                表示中: {displayPoints.length.toLocaleString()} 点
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                状態
              </div>
              <div className="mt-2 text-sm">
                <div>
                  <span className="text-slate-400">状態:</span> {status}
                </div>
                {stats ? (
                  <>
                    <div className="mt-1">
                      <span className="text-slate-400">点数:</span>{" "}
                      {stats.count.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      X: {stats.minX.toFixed(2)} ～ {stats.maxX.toFixed(2)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Y: {stats.minY.toFixed(2)} ～ {stats.maxY.toFixed(2)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Z: {stats.minZ.toFixed(2)} ～ {stats.maxZ.toFixed(2)}
                    </div>
                  </>
                ) : null}
                {errorMessage ? (
                  <div className="mt-2 text-sm text-rose-300">{errorMessage}</div>
                ) : null}
              </div>
            </div>
          </div>

          <div
            onMouseDown={() => startResize("left")}
            className="absolute right-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center text-cyan-300/50 hover:text-cyan-200"
          >
            ◀▶
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setLeftCollapsed(false)}
          className="absolute left-4 top-4 z-10 rounded-xl border border-cyan-200/10 bg-slate-900/60 px-3 py-2 text-sm shadow-2xl backdrop-blur-md hover:bg-slate-900/80"
        >
          ▶ 左メニュー
        </button>
      )}

      {!rightCollapsed ? (
        <section
          style={{ width: rightWidth }}
          className="absolute right-4 top-4 bottom-4 z-10 rounded-2xl border border-cyan-200/10 bg-slate-900/35 shadow-2xl backdrop-blur-md"
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                    Future Panel
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-cyan-50">
                    展開図 / 図面
                  </h2>
                  <p className="mt-2 text-sm text-slate-300">
                    右下に断面ビューを常時表示。将来ここに2D展開図やDXF出力を置く。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setRightCollapsed(true)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm hover:bg-white/10"
                >
                  ▶
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-slate-400">
                図面プレビュー領域
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                  断面ビュー
                </div>

                <div className="mt-3 h-[360px] rounded-lg border border-white/10 bg-slate-950/70 p-2">
                  <CrossSectionView
                    cloudPoints={displayPoints}
                    tapePoints={tapePoints}
                    startPoint={startPoint}
                    endPoint={endPoint}
                    sliceWidth={sliceWidth}
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            onMouseDown={() => startResize("right")}
            className="absolute left-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center text-cyan-300/50 hover:text-cyan-200"
          >
            ◀▶
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setRightCollapsed(false)}
          className="absolute right-4 top-4 z-10 rounded-xl border border-cyan-200/10 bg-slate-900/60 px-3 py-2 text-sm shadow-2xl backdrop-blur-md hover:bg-slate-900/80"
        >
          右メニュー ◀
        </button>
      )}
    </div>
  );
}