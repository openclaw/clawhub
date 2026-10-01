export function formatValidationFindingMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}
