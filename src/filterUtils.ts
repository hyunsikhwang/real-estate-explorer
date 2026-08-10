export const matchesNumericRange = (
  value: number,
  range: readonly [number, number],
  upperUnbounded = false,
) => value >= range[0] && (upperUnbounded || value <= range[1]);
