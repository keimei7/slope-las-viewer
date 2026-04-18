export type Point3 = {
  x: number;
  y: number;
  z: number;
};

function voxelDownsample(points: Point3[], voxelSize: number) {
  const map = new Map<string, Point3>();

  for (const p of points) {
    const ix = Math.floor(p.x / voxelSize);
    const iy = Math.floor(p.y / voxelSize);
    const iz = Math.floor(p.z / voxelSize);
    const key = `${ix}_${iy}_${iz}`;

    if (!map.has(key)) {
      map.set(key, p);
    }
  }

  return Array.from(map.values());
}

self.onmessage = (event: MessageEvent) => {
  const { points, voxelSize } = event.data;
  const result = voxelDownsample(points, voxelSize);
  self.postMessage(result);
};