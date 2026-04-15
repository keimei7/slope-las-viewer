"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
type LengthUnit = "mm" | "cm" | "m";

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

function isSamePoint(a: PickedPoint | null, b: PickedPoint | null, eps = 1e-9) {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.z - b.z) < eps
  );
}

function formatLength(valueMeters: number, unit: LengthUnit) {
  if (unit === "mm") {
    return `${Math.round(valueMeters * 1000)}mm`;
  }
  if (unit === "cm") {
    return `${(valueMeters * 100).toFixed(1)}cm`;
  }
  return `${valueMeters.toFixed(3)}m`;
}

export default function LasViewer() {
  const [points, setPoints] = useState<Point3[]>([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [startPoint, setStartPoint] = useState<PickedPoint | null>(null);
  const [endPoint, setEndPoint] = useState<PickedPoint | null>(null);
  const [manualPoints, setManualPoints] = useState<PickedPoint[]>([]);

  const [maxDisplayPoints, setMaxDisplayPoints] = useState(600000);
  const [zScale, setZScale] = useState(1);
  const [pointSize, setPointSize] = useState(0.008);
  const [viewMode, setViewMode] = useState<ViewMode>("top");
  const [viewResetKey, setViewResetKey] = useState(0);
  const [focusWidth, setFocusWidth] = useState(6);

  const [searchRadius, setSearchRadius] = useState(0.1);
  const [sliceWidth, setSliceWidth] = useState(0.15);
  const [isPinned, setIsPinned] = useState(false);
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("cm");

  const [leftWidth, setLeftWidth] = useState(360);
  const [rightWidth, setRightWidth] = useState(380);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!startPoint || !endPoint) return [];
    return [startPoint, ...manualPoints, endPoint];
  }, [startPoint, manualPoints, endPoint]);

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

    // 1点目 = 始点
    if (!startPoint) {
      setStartPoint(point);
      setEndPoint(null);
      setManualPoints([]);
      return;
    }

    // 2点目 = 終点
    if (!endPoint) {
      if (isSamePoint(startPoint, point)) return;
      setEndPoint(point);
      setManualPoints([]);
      return;
    }

    // 3点目以降 = 手動沿わせ点（終点の手前に追加）
    const lastReference =
      manualPoints.length > 0 ? manualPoints[manualPoints.length - 1] : startPoint;

    if (isSamePoint(lastReference, point) || isSamePoint(endPoint, point)) {
      return;
    }

    setManualPoints((prev) => [...prev, point]);
  }

  function undoLastPoint() {
    if (isPinned) return;

    if (manualPoints.length > 0) {
      setManualPoints((prev) => prev.slice(0, -1));
      return;
    }

    if (endPoint) {
      setEndPoint(null);
      return;
    }

    if (startPoint) {
      setStartPoint(null);
    }
  }

  function clearPickedPoints() {
    setStartPoint(null);
    setEndPoint(null);
    setManualPoints([]);
    setIsPinned(false);
  }

  function resetMeasuredPointsOnly() {
    setStartPoint(null);
    setEndPoint(null);
    setManualPoints([]);
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
    setStartPoint(null);
    setEndPoint(null);
    setManualPoints([]);
    setIsPinned(false);

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
        manualPoints={manualPoints}
        onPickPoint={handlePick}
        zScale={zScale}
        pointSize={pointSize}
        viewMode={viewMode}
        viewResetKey={viewResetKey}
        focusWidth={focusWidth}
        sliceWidth={sliceWidth}
        pickRadius={searchRadius}
        tapePoints={tapePoints}
        lengthUnit={lengthUnit}
      />

      {!leftCollapsed ? (
        <aside
          style={{ width: leftWidth }}
          className="absolute left-4 top-4 bottom-4 z-10 overflow-hidden rounded-2xl border border-cyan-200/10 bg-slate-900/45 shadow-2xl backdrop-blur-md"
        >
          <div className="h-full overflow-y-auto overscroll-contain p-4 pr-2">
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
                ref={fileInputRef}
                type="file"
                accept=".las,.laz"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-cyan-500/20 px-3 py-2 text-sm font-medium text-cyan-50 hover:bg-cyan-500/30"
                >
                  ファイルを選択
                </button>

                {fileName ? (
                  <div className="min-w-0 truncate text-sm text-slate-200">
                    {fileName}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                単位表示
              </div>

              <div className="mt-3 flex gap-2">
                {(["mm", "cm", "m"] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setLengthUnit(unit)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      lengthUnit === unit
                        ? "border-cyan-300/40 bg-cyan-400/20 text-cyan-50"
                        : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    }`}
                  >
                    {unit}
                  </button>
                ))}
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
                  <span className="text-slate-400">手動沿わせ点:</span> {manualPoints.length}
                </div>

                <div className="mt-1">
                  <span className="text-slate-400">終点:</span>{" "}
                  {endPoint
                    ? `${endPoint.x.toFixed(2)}, ${endPoint.y.toFixed(2)}, ${endPoint.z.toFixed(2)}`
                    : "-"}
                </div>

                <div className="mt-1">
                  <span className="text-slate-400">直線距離:</span>{" "}
                  {pickedDistance !== null ? formatLength(pickedDistance, lengthUnit) : "-"}
                </div>

                <div className="mt-1">
                  <span className="text-slate-400">沿わせ長:</span>{" "}
                  {tapeDistance !== null ? formatLength(tapeDistance, lengthUnit) : "-"}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={undoLastPoint}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
                >
                  1点戻す
                </button>

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

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsPinned((prev) => !prev)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
                >
                  {isPinned ? "ピン留め解除" : "この測線をピン留め"}
                </button>
              </div>

              <div className="mt-2 text-xs text-slate-400">
                入力方式: 始点 → 終点 → その後は終点の手前に手動沿わせ点を追加
              </div>

              <div className="mt-1 text-xs text-slate-400">
                ピン状態: {isPinned ? "固定中" : "未固定"}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                タップ判定 / 断面設定
              </div>

              <div className="mt-3">
                <label className="block text-xs text-slate-300">
                  タップ許容幅: {(searchRadius * 100).toFixed(0)} cm
                </label>
                <input
                  type="range"
                  min={0.01}
                  max={1}
                  step={0.01}
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
                  max={1}
                  step={0.01}
                  value={sliceWidth}
                  onChange={(e) =>
                    setSliceWidth(clamp(Number(e.target.value), 0.01, 1))
                  }
                  className="mt-1 w-full"
                />
              </div>

              <div className="mt-3 text-xs text-slate-400">
                現在の測線点数: {tapePoints.length}
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
            className="absolute right-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center text-cyan-300/50 hover:text-cyan-200"
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
          className="absolute right-4 top-4 bottom-4 z-10 overflow-hidden rounded-2xl border border-cyan-200/10 bg-slate-900/35 shadow-2xl backdrop-blur-md"
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

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 pr-2">
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
            className="absolute left-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center text-cyan-300/50 hover:text-cyan-200"
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