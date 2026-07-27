export interface MillisecondRange {
  start: number;
  end: number;
}

export interface CapacityRange extends MillisecondRange {
  units: number;
}

export const rangesOverlap = (
  left: MillisecondRange,
  right: MillisecondRange,
): boolean => left.start < right.end && right.start < left.end;

export const rangeContains = (
  container: MillisecondRange,
  candidate: MillisecondRange,
): boolean =>
  container.start <= candidate.start && candidate.end <= container.end;

export const mergeRanges = (
  ranges: readonly MillisecondRange[],
): MillisecondRange[] => {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: MillisecondRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || previous.end < range.start) {
      merged.push(range);
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
};

export const intersectRangeSets = (
  left: readonly MillisecondRange[],
  right: readonly MillisecondRange[],
): MillisecondRange[] => {
  const leftRanges = mergeRanges(left);
  const rightRanges = mergeRanges(right);
  const intersections: MillisecondRange[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftRanges.length && rightIndex < rightRanges.length) {
    const leftRange = leftRanges[leftIndex];
    const rightRange = rightRanges[rightIndex];
    const start = Math.max(leftRange.start, rightRange.start);
    const end = Math.min(leftRange.end, rightRange.end);
    if (start < end) intersections.push({ start, end });

    if (leftRange.end <= rightRange.end) leftIndex += 1;
    else rightIndex += 1;
  }

  return intersections;
};

export const subtractRanges = (
  source: readonly MillisecondRange[],
  exclusions: readonly MillisecondRange[],
): MillisecondRange[] => {
  const normalizedExclusions = mergeRanges(exclusions);

  return mergeRanges(source).flatMap((sourceRange) => {
    const fragments: MillisecondRange[] = [];
    let cursor = sourceRange.start;

    for (const exclusion of normalizedExclusions) {
      if (exclusion.end <= cursor) continue;
      if (exclusion.start >= sourceRange.end) break;
      if (cursor < exclusion.start) {
        fragments.push({
          start: cursor,
          end: Math.min(exclusion.start, sourceRange.end),
        });
      }
      cursor = Math.max(cursor, exclusion.end);
      if (cursor >= sourceRange.end) break;
    }

    if (cursor < sourceRange.end) {
      fragments.push({ start: cursor, end: sourceRange.end });
    }
    return fragments;
  });
};

export const everyRangeIsCovered = (
  required: readonly MillisecondRange[],
  available: readonly MillisecondRange[],
): boolean => {
  const normalizedAvailable = mergeRanges(available);
  return required.every((requiredRange) =>
    normalizedAvailable.some((availableRange) =>
      rangeContains(availableRange, requiredRange),
    ),
  );
};

export const canAllocateCapacity = (
  existing: readonly CapacityRange[],
  requested: readonly CapacityRange[],
  capacity: number,
): boolean => {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) return false;

  const existingDeltas = new Map<number, number>();
  const requestedDeltas = new Map<number, number>();
  const addRange = (
    deltas: Map<number, number>,
    range: CapacityRange,
  ): void => {
    if (
      range.end <= range.start ||
      !Number.isSafeInteger(range.units) ||
      range.units <= 0
    ) {
      return;
    }
    deltas.set(range.start, (deltas.get(range.start) ?? 0) + range.units);
    deltas.set(range.end, (deltas.get(range.end) ?? 0) - range.units);
  };

  existing.forEach((range) => addRange(existingDeltas, range));
  requested.forEach((range) => addRange(requestedDeltas, range));

  const eventTimes = new Set([
    ...existingDeltas.keys(),
    ...requestedDeltas.keys(),
  ]);
  let existingUnits = 0;
  let requestedUnits = 0;
  for (const time of [...eventTimes].sort((left, right) => left - right)) {
    existingUnits += existingDeltas.get(time) ?? 0;
    requestedUnits += requestedDeltas.get(time) ?? 0;
    if (requestedUnits > 0 && existingUnits + requestedUnits > capacity) {
      return false;
    }
  }
  return true;
};

export const alignUp = (value: number, origin: number, interval: number): number => {
  if (interval <= 0) return value;
  const elapsed = value - origin;
  return origin + Math.ceil(elapsed / interval) * interval;
};

export const enumerateAlignedStarts = (
  windows: readonly MillisecondRange[],
  origin: number,
  interval: number,
  latestEndOffset: number,
): number[] => {
  const starts: number[] = [];
  for (const window of mergeRanges(windows)) {
    let cursor = alignUp(window.start, origin, interval);
    while (cursor + latestEndOffset <= window.end) {
      starts.push(cursor);
      cursor += interval;
    }
  }
  return starts;
};
