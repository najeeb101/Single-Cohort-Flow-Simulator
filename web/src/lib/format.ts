export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function num(x: number, decimals = 2): string {
  return x.toFixed(decimals);
}
