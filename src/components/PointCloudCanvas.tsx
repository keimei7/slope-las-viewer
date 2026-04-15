"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Point3 } from "./LasViewer";

function PointCloudObject({ points }: { points: Point3[] }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    if (points.length === 0) {
      return geo;
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

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const positions = new Float32Array(points.length * 3);

    points.forEach((p, index) => {
      positions[index * 3] = p.x - centerX;
      positions[index * 3 + 1] = p.y - centerY;
      positions[index * 3 + 2] = p.z - centerZ;
    });

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.computeBoundingSphere();

    return geo;
  }, [points]);

  if (points.length === 0) {
    return null;
  }

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.15} sizeAttenuation />
    </points>
  );
}

export default function PointCloudCanvas({ points }: { points: Point3[] }) {
  return (
    <Canvas camera={{ position: [0, 0, 120], fov: 60 }}>
      <color attach="background" args={["#e2e8f0"]} />
      <ambientLight intensity={1} />
      <gridHelper args={[200, 20]} />
      <axesHelper args={[20]} />
      <PointCloudObject points={points} />
      <OrbitControls />
    </Canvas>
  );
}