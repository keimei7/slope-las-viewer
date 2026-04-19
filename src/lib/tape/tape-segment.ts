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

function distance(a: Vec3, b: Vec3) {
  return length(sub(a, b));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

  const dir = sub(end, start);
  const baseLenXY = Math.hypot(dir.x, dir.y);

  if (baseLenXY < 1e-6) {
    return [start, end];
  }

  const ux = dir.x / baseLenXY;
  const uy = dir.y / baseLenXY;

  const nodes: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    if (base[i]) {
      nodes.push({ ...base[i] });
    } else {
      nodes.push(lerpVec3(start, end, i / segments));
    }
  }

  const restLengths: number[] = [];
  for (let i = 0; i < segments; i++) {
    restLengths.push(distance(nodes[i], nodes[i + 1]));
  }

  const avgRest =
    restLengths.reduce((sum, v) => sum + v, 0) / Math.max(restLengths.length, 1);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 1; i < segments; i++) {
      if (fixedSet.has(i)) continue;

      const prev = nodes[i - 1];
      const curr = nodes[i];
      const next = nodes[i + 1];

      const t = i / segments;
      const targetAlong = baseLenXY * t;

      const spineX = start.x + ux * targetAlong;
      const spineY = start.y + uy * targetAlong;

      const toPrev = sub(curr, prev);
      const toNext = sub(curr, next);

      const dPrev = Math.max(length(toPrev), 1e-6);
      const dNext = Math.max(length(toNext), 1e-6);

      const fixPrev = scale(
        normalize(toPrev),
        (restLengths[i - 1] - dPrev) * 0.5 * tension,
      );
      const fixNext = scale(
        normalize(toNext),
        (restLengths[i] - dNext) * 0.5 * tension,
      );

      let updated = add(curr, add(fixPrev, fixNext));

      const anchor = base[i] ?? null;
      const guideX = anchor ? anchor.x : spineX;
      const guideY = anchor ? anchor.y : spineY;

      const edgeRatio = Math.abs(t - 0.5) * 2;
      const xyGrip = anchor
        ? lerp(0.55, 0.82, edgeRatio)
        : lerp(0.32, 0.55, edgeRatio);

      updated.x = lerp(updated.x, guideX, xyGrip);
      updated.y = lerp(updated.y, guideY, xyGrip);

      const alongRaw =
        (updated.x - start.x) * ux +
        (updated.y - start.y) * uy;

      const prevAlong =
        (prev.x - start.x) * ux +
        (prev.y - start.y) * uy;

      const nextAlong =
        (next.x - start.x) * ux +
        (next.y - start.y) * uy;

      const minAlong = prevAlong + Math.max(baseLenXY / segments * 0.15, 0.005);
      const maxAlong = nextAlong - Math.max(baseLenXY / segments * 0.15, 0.005);

      let clampedAlong = alongRaw;
      if (minAlong < maxAlong) {
        clampedAlong = clamp(alongRaw, minAlong, maxAlong);
      } else {
        clampedAlong = targetAlong;
      }

      const perpX = updated.x - (start.x + ux * clampedAlong);
      const perpY = updated.y - (start.y + uy * clampedAlong);
      const perpLen = Math.hypot(perpX, perpY);

      const maxPerp = anchor
        ? Math.max(avgRest * 0.35, 0.03)
        : Math.max(avgRest * 0.22, 0.02);

      let finalPerpX = perpX;
      let finalPerpY = perpY;
      if (perpLen > maxPerp && perpLen > 1e-6) {
        const ratio = maxPerp / perpLen;
        finalPerpX *= ratio;
        finalPerpY *= ratio;
      }

      updated.x = start.x + ux * clampedAlong + finalPerpX;
      updated.y = start.y + uy * clampedAlong + finalPerpY;

      const terrain = sampleTerrain(updated.x, updated.y);
      if (terrain.z !== null) {
        const skin = 0.003;
        const minAllowedZ = terrain.z + skin;
        const localGrip = lerp(cling, endGrip, edgeRatio);

        if (updated.z < minAllowedZ) {
          updated.z = minAllowedZ;
        } else {
          updated.z = lerp(updated.z, minAllowedZ, 0.45 + localGrip * 0.35);
        }
      } else {
        const lineBase = lerpVec3(start, end, t);
        updated.z = lerp(updated.z, lineBase.z, 0.35);
      }

      const maxDeltaZ = Math.max(avgRest * 0.45, 0.08);
      const dz = updated.z - curr.z;
      if (Math.abs(dz) > maxDeltaZ) {
        updated.z = curr.z + Math.sign(dz) * maxDeltaZ;
      }

      const moveDx = updated.x - curr.x;
      const moveDy = updated.y - curr.y;
      const moveDz = updated.z - curr.z;
      const moveDist = Math.sqrt(
        moveDx * moveDx + moveDy * moveDy + moveDz * moveDz,
      );

      const maxMove = Math.max(avgRest * 0.45, 0.05);
      if (moveDist > maxMove) {
        const ratio = maxMove / moveDist;
        updated = {
          x: curr.x + moveDx * ratio,
          y: curr.y + moveDy * ratio,
          z: curr.z + moveDz * ratio,
        };
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