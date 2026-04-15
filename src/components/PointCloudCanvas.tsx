"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point3, PickedPoint } from "./LasViewer";

function PointCloud({ points, onPick }: any) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(points.length * 3);

    points.forEach((p: Point3, i: number) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });

    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [points]);

  return (
    <points
      geometry={geometry}
      onClick={(e: any) => {
        e.stopPropagation();
        onPick(e.point);
      }}
    >
      <pointsMaterial size={0.3} />
    </points>
  );
}

function CameraFit({ points }: { points: Point3[] }) {
  const ref = useRef<any>();

  useEffect(() => {
    if (!points.length || !ref.current) return;

    let min = new THREE.Vector3(Infinity, Infinity, Infinity);
    let max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    points.forEach((p) => {
      min.min(new THREE.Vector3(p.x, p.y, p.z));
      max.max(new THREE.Vector3(p.x, p.y, p.z));
    });

    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min).length();

    ref.current.target.copy(center);
    ref.current.object.position.set(
      center.x + size,
      center.y - size,
      center.z + size
    );
    ref.current.update();
  }, [points]);

  return <OrbitControls ref={ref} />;
}

export default function PointCloudCanvas({
  points,
  startPoint,
  endPoint,
  onPickPoint,
}: {
  points: Point3[];
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  onPickPoint: (p: PickedPoint) => void;
}) {
  return (
    <Canvas camera={{ position: [100, -100, 60] }}>
      <ambientLight />

      <PointCloud points={points} onPick={onPickPoint} />

      {startPoint && (
        <mesh position={[startPoint.x, startPoint.y, startPoint.z]}>
          <sphereGeometry args={[0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}

      {endPoint && (
        <mesh position={[endPoint.x, endPoint.y, endPoint.z]}>
          <sphereGeometry args={[0.5]} />
          <meshBasicMaterial color="blue" />
        </mesh>
      )}

      {startPoint && endPoint && (
        <Line
          points={[
            [startPoint.x, startPoint.y, startPoint.z],
            [endPoint.x, endPoint.y, endPoint.z],
          ]}
          color="black"
        />
      )}

      <CameraFit points={points} />
    </Canvas>
  );
}