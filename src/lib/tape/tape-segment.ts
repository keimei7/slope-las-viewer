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

export function buildTapeSegmentPath(
  start: Vec3,
  end: Vec3,
  sampleTerrain: SampleTerrainFn,
  options: TapeOptions = {},
): Vec3[] {
  const segments = options.segments ?? 24;
  const iterations = options.iterations ?? 8;
  const cling = options.cling ?? 0.3;
  const tension = options.tension ?? 0.75;
  const endGrip = options.endGrip ?? 0.85;

  if (segments < 1) return [start, end];
  const nodes: Vec3[] = [];
  const base = options.baseSamples;

  for (let i = 0; i <= segments; i += 1) {
    if (base && base[i]) {
      nodes.push({ ...base[i] });
    } else {
      nodes.push(lerpVec3(start, end, i / segments));
    }
  }

  const restLengths: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    restLengths.push(distance(nodes[i], nodes[i + 1]));
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 1; i < segments; i += 1) {
              const isFixed = options.constraintIndices?.includes(i);
      if (isFixed) continue;
      const prev = nodes[i - 1];
      const curr = nodes[i];
      const next = nodes[i + 1];

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
      const anchor = base && base[i] ? base[i] : null;

      const moveDx = updated.x - curr.x;
      const moveDy = updated.y - curr.y;
      const moveDz = updated.z - curr.z;
      const moveDist = Math.sqrt(
        moveDx * moveDx + moveDy * moveDy + moveDz * moveDz
      );

      const avgRest =
        restLengths.reduce((sum, v) => sum + v, 0) / Math.max(restLengths.length, 1);

      const maxMove = Math.max(avgRest * 0.35, 0.04);

      if (moveDist > maxMove) {
        const ratio = maxMove / moveDist;
        updated = {
          x: curr.x + moveDx * ratio,
          y: curr.y + moveDy * ratio,
          z: curr.z + moveDz * ratio,
        };
      }

      if (anchor) {
        updated.x = lerp(updated.x, anchor.x, 0.82);
        updated.y = lerp(updated.y, anchor.y, 0.82);
      }
         const terrain = sampleTerrain(updated.x, updated.y);

      if (terrain.z !== null) {
        const t = i / segments;
        const centerFactor = 1 - Math.abs(t - 0.5) * 2;
        const grip = lerp(endGrip, cling, centerFactor);
        const skin = 0.003;

        if (updated.z < terrain.z + skin) {
          updated.z = terrain.z + skin;
        } else {
          updated.z = lerp(updated.z, terrain.z + skin, grip);
        }
      }

      nodes[i] = updated;
    }
  }

  return nodes;
}

export function computePolylineLength(points: Vec3[]) {
  if (points.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}