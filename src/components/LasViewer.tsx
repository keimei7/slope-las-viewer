"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { load } from "@loaders.gl/core";
import { LASLoader } from "@loaders.gl/las";
import PointCloudCanvas from "./PointCloudCanvas";

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

function toPointsFromLasData(data: unknown): Point3[] {
  const rows: Point3[] = [];

  const candidate = data as any;
  const attr =
    candidate?.attributes?.POSITION?.value ??
    candidate?.attributes?.position?.value;

  if (!attr) return rows;

  for (let i = 0; i < attr.length; i += 3) {
    rows.push({
      x: attr[i],
      y: attr[i + 1],
      z: attr[i + 2],
    });
  }

  return rows;
}

export default function LasViewer() {
  const [points, setPoints] = useState<Point3[]>([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [startPoint, setStartPoint] = useState<PickedPoint | null>(null);
  const [endPoint, setEndPoint] = useState<PickedPoint | null>(null);

  // 🔥 表示用に間引き
    const [maxDisplayPoints, setMaxDisplayPoints] = useState(200000);
  const [zScale, setZScale] = useState(1.5);

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

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    return { count: points.length, minX, minY, minZ, maxX, maxY, maxZ };
  }, [points]);

  const pickedDistance = useMemo(() => {
    if (!startPoint || !endPoint) return null;

    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const dz = endPoint.z - startPoint.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, [startPoint, endPoint]);

  function handlePick(point: PickedPoint) {
    if (!startPoint || endPoint) {
      setStartPoint(point);
      setEndPoint(null);
    } else {
      setEndPoint(point);
    }
  }

  function clearPickedPoints() {
    setStartPoint(null);
    setEndPoint(null);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("loading");
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const data = await load(buffer, LASLoader);
      const parsed = toPointsFromLasData(data);

      setPoints(parsed);
      setStatus("loaded");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorMessage("読み込み失敗");
    }
  }

  return (
      <div className="grid min-h-screen grid-cols-[280px_1fr] bg-slate-100">
      <aside className="p-4 border-r bg-white text-sm">
        <h1 className="text-xl font-bold">LAS Viewer</h1>

        <input type="file" accept=".las" onChange={handleFileChange} />

        <div className="mt-3">
          始点: {startPoint ? startPoint.x.toFixed(2) : "-"}<br/>
          終点: {endPoint ? endPoint.x.toFixed(2) : "-"}<br/>
          距離: {pickedDistance ? pickedDistance.toFixed(2) : "-"}
        </div>

        <button onClick={clearPickedPoints}>クリア</button>

        {stats && (
          <div className="mt-3">
            点数: {stats.count.toLocaleString()}
          </div>
        )}
      </aside>
              <div className="mt-4 space-y-3 rounded-xl border border-slate-300 p-3">
          <div className="font-medium">表示設定</div>

          <div>
            <label className="block text-xs text-slate-600">
              表示点数上限: {maxDisplayPoints.toLocaleString()}
            </label>
            <input
              type="range"
              min={50000}
              max={500000}
              step={50000}
              value={maxDisplayPoints}
              onChange={(e) => setMaxDisplayPoints(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600">
              Z誇張: {zScale.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.1}
              value={zScale}
              onChange={(e) => setZScale(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="text-xs text-slate-500">
            表示中: {displayPoints.length.toLocaleString()} 点
          </div>
        </div>

           <PointCloudCanvas
        points={displayPoints}
        startPoint={startPoint}
        endPoint={endPoint}
        onPickPoint={handlePick}
        zScale={zScale}
      />
    </div>
  );
}