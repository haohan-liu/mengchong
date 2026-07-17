const SECRET_PATTERNS = [
  /\b(?:sk|api)[-_][A-Za-z0-9_-]{16,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\b(?:password|passwd|pwd|密码)\s*[:=：]\s*\S+/gi,
  /\b\d{16,19}\b/g,
  /\b\d{17}[\dXx]\b/g
];

export function redactContent(value: string): { value: string; count: number } {
  let count = 0;
  let result = value.slice(0, 2000);
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, () => { count += 1; return "[已脱敏]"; });
  }
  return { value: result, count };
}
