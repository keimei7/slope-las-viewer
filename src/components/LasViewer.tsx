"use client";

import { useMemo, useState } from "react";
import { load } from "@loaders.gl/core";
import { LASLoader } from "@loaders.gl/las";
import PointCloudCanvas from "./PointCloudCanvas";

export type Point3 = {
  x: number;
  y: number;
  z: number;
};

type LoadState = "idle" | "loading" | "loaded" | "error";

function toPointsFromLasData(data: unknown): Point3[] {
  const rows: Point3[] = [];

  if (!data || typeof data !== "object") {
    return rows;
  }

  const candidate = data as {
    attributes?: {
      POSITION?: {
        value?: Float32Array | Float64Array | number[];
      };
      position?: {
        value?: Float32Array | Float64Array | number[];
      };
    };
  };

  const positionAttr =
    candidate.attributes?.POSITION?.value ??
    candidate.attributes?.position?.value;

  if (!positionAttr) {
    return rows;
  }

  for (let i = 0; i < positionAttr.length; i += 3) {
    rows.push({
      x: Number(positionAttr[i]),
      y: Number(positionAttr[i + 1]),
      z: Number(positionAttr[i + 2]),
    });
  }

  return rows;
}

export default function LasViewer() {
  const [points, setPoints] = useState<Point3[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [status, setStatus] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const stats = useMemo(() => {
    if (points.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

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

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("loading");
    setErrorMessage("");
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const lasData = await load(arrayBuffer, LASLoader);
      const parsedPoints = toPointsFromLasData(lasData);

      if (parsedPoints.length === 0) {
        throw new Error(
          "点群を読み込めませんでした。LASのバージョンや属性構造を確認してください。",
        );
      }

      setPoints(parsedPoints);
      setStatus("loaded");
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
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="border-b border-slate-200 bg-white p-4 md:border-b-0 md:border-r">
        <h1 className="text-xl font-semibold">LAS Viewer</h1>
        <p className="mt-2 text-sm text-slate-600">
          まずは .las を受け取る器だけ作る。
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700">
            LASファイル
          </label>
          <input
            type="file"
            accept=".las,.laz"
            onChange={handleFileChange}
            className="mt-2 block w-full text-sm"
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm">
          <div>
            <span className="font-medium">状態:</span> {status}
          </div>
          <div className="mt-1 break-all">
            <span className="font-medium">ファイル:</span>{" "}
            {fileName || "未選択"}
          </div>
          {errorMessage ? (
            <div className="mt-2 text-red-600">{errorMessage}</div>
          ) : null}
        </div>

        {stats ? (
          <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm">
            <div className="font-medium">点群情報</div>
            <div className="mt-2">点数: {stats.count.toLocaleString()}</div>
            <div className="mt-1">X: {stats.minX.toFixed(2)} ～ {stats.maxX.toFixed(2)}</div>
            <div className="mt-1">Y: {stats.minY.toFixed(2)} ～ {stats.maxY.toFixed(2)}</div>
            <div className="mt-1">Z: {stats.minZ.toFixed(2)} ～ {stats.maxZ.toFixed(2)}</div>
          </div>
        ) : null}
      </aside>

      <main className="min-h-[60vh] bg-slate-100">
        <PointCloudCanvas points={points} />
      </main>
    </div>
  );
}