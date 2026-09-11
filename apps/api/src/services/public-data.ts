// Applied at both HTTP and realtime boundaries, including nested relations.
export function publicData(value: any): any {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(publicData);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['passwordHash', 'tokenHash', 'passwordResetTokens', 'sessions'].includes(key))
    .map(([key, item]) => [key, publicData(item)]));
}
