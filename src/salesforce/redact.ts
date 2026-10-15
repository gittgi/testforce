/** Redact session credentials, including an explicitly held CLI token, before producing evidence. */
export function redactSecrets<T>(value: T, knownSecrets: string[] = []): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      let text = item;
      for (const secret of knownSecrets)
        if (secret.length >= 8) text = text.replaceAll(secret, "[REDACTED]");
      return text
        .replace(/(?:force:\/\/)[^\s"']+/g, "[REDACTED]")
        .replace(/\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]+/g, "[REDACTED]");
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [
          key,
          /^(?:accessToken|refreshToken|sfdxAuthUrl|password|sessionId)$/i.test(
            key,
          )
            ? "[REDACTED]"
            : visit(entry),
        ]),
      );
    return item;
  };
  return visit(value) as T;
}
