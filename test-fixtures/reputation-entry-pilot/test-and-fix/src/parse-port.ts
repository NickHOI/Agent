export function parsePort(input: string): number {
  const value = Number.parseInt(input, 10);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new RangeError("Port must be an integer from 1 through 65535");
  }
  return value;
}
