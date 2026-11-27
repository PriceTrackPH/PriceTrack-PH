export function recordingExtension(value: unknown): "web" | "edge" | "firefox" | "unknown" {
  return value === "web" || value === "edge" || value === "firefox" ? value : "unknown";
}
