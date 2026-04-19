export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type TapeOptions = {
  segments?: number;
  iterations?: number;
  cling?: number;
  tension?: number;
  endGrip?: number;
  constraintIndices?: number[];
  baseSamples?: Vec3[];
};

export type SampleTerrainFn = (x: number, y: number) => {
  z: number | null;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function length(v: Vec3) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3) {
  return length(sub(a, b));
}

export function buildTapeSegmentPath(
  start: Vec3,
  end: Vec3,
  sampleTerrain: SampleTerrainFn,
  options: TapeOptions = {},
): Vec3[] {
  const segments = Math.max(1, options.segments ?? 24);
  const iterations = Math.max(1, options.iterations ?? 8);
  const cling = options.cling ?? 0.3;
  const tension = options.tension ?? 0.75;
  const endGrip = options.endGrip ?? 0.85;
  const base = options.baseSamples ?? [];
  const fixedSet = new Set(options.constraintIndices ?? []);

  const nodes: Vec3[] = [];

  for (let i = 0; i <= segments; i++) {
    nodes.push(base[i] ?? lerpVec3(start, end, i / segments));
  }

  const restLengths: number[] = [];
  for (let i = 0; i < segments; i++) {
    restLengths.push(distance(nodes[i], nodes[i + 1]));
  }

  const avgRest =
    restLengths.reduce((a, b) => a + b, 0) / Math.max(restLengths.length, 1);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 1; i < segments; i++) {
      if (fixedSet.has(i)) continue;

      const prev = nodes[i - 1];
      const curr = nodes[i];
      const next = nodes[i + 1];

      const toPrev = sub(curr, prev);
      const toNext = sub(curr, next);

      const fixPrev = scale(
        normalize(toPrev),
        (restLengths[i - 1] - length(toPrev)) * 0.5 * tension,
      );
      const fixNext = scale(
        normalize(toNext),
        (restLengths[i] - length(toNext)) * 0.5 * tension,
      );

      let updated = add(curr, add(fixPrev, fixNext));

      // ===== ヘアピン・戻り抑制 =====
      const prevDir = normalize(sub(curr, prev));
      const newDir = normalize(sub(updated, prev));

      const flowDot = dot(prevDir, newDir);

      if (flowDot < -0.15) {
        updated = lerpVec3(updated, curr, 0.75);
      } else if (flowDot < 0.2) {
        updated = lerpVec3(updated, curr, 0.35);
      }

      // ===== 横振れ制限 =====
      const mid = {
        x: (prev.x + next.x) * 0.5,
        y: (prev.y + next.y) * 0.5,
        z: (prev.z + next.z) * 0.5,
      };

      const side = sub(updated, mid);
      const sideLen = length(side);
      const maxSide = Math.max(avgRest * 0.9, 0.06);

      if (sideLen > maxSide) {
        updated = add(mid, scale(normalize(side), maxSide));
      }

      // ===== 全体方向制限 =====
      const globalDir = normalize(sub(end, start));
      const moveDir = normalize({
        x: updated.x - curr.x,
        y: updated.y - curr.y,
        z: 0,
      });

      const globalDot = dot(moveDir, {
        x: globalDir.x,
        y: globalDir.y,
        z: 0,
      });

      if (globalDot < -0.05) {
        updated = lerpVec3(updated, curr, 0.8);
      }

      // ===== z暴れ抑制 =====
      const maxDeltaZ = Math.max(avgRest * 0.45, 0.08);
      const dz = updated.z - curr.z;

      if (Math.abs(dz) > maxDeltaZ) {
        updated.z = curr.z + Math.sign(dz) * maxDeltaZ;
      }

      // ===== 移動量制限 =====
      const move = sub(updated, curr);
      const moveLen = length(move);
      const maxMove = Math.max(avgRest * 0.35, 0.04);

      if (moveLen > maxMove) {
        updated = add(curr, scale(normalize(move), maxMove));
      }

      // ===== 直線戻し =====
      const t = i / segments;
      const baseLine = lerpVec3(start, end, t);
      const edge = Math.abs(t - 0.5) * 2;
      const lineReturn = lerp(0.12, 0.24, edge);

      updated.x = lerp(updated.x, baseLine.x, lineReturn);
      updated.y = lerp(updated.y, baseLine.y, lineReturn);

      // ===== base拘束 =====
      if (base[i]) {
        updated.x = lerp(updated.x, base[i].x, 0.82);
        updated.y = lerp(updated.y, base[i].y, 0.82);
      }

      // ===== 地形拘束 =====
      const terrain = sampleTerrain(updated.x, updated.y);
      if (terrain.z !== null) {
        const minZ = terrain.z + 0.003;

        if (updated.z < minZ) {
          updated.z = minZ;
        } else {
          const edgeRatio = Math.abs(t - 0.5) * 2;
          const grip = lerp(cling, endGrip, edgeRatio);
          updated.z = lerp(updated.z, minZ, grip * 0.12);
        }
      }

      nodes[i] = updated;
    }
  }

  nodes[0] = { ...start };
  nodes[nodes.length - 1] = { ...end };

  return nodes;
}

export function computePolylineLength(points: Vec3[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i], points[i - 1]);
  }
  return total;
}