const FILE_SERVICE_PREFIXES = ["/bisheng", "/tmp-dir"];

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/$/, "");
  return normalized === "/" ? "" : normalized;
}

function stripOrigin(url: string) {
  return url.replace(/^https?:\/\/[^/]+/i, "");
}

/**
 * Route MinIO object URLs through the platform base path.
 *
 * The backend intentionally strips the MinIO share host from presigned URLs,
 * so sub-path deployments must add the application base path before fetching
 * `/bisheng` or `/tmp-dir` objects.
 */
export function withFileServiceBaseUrl(url: string, baseUrl = __APP_ENV__.BASE_URL) {
  if (!url) return "";

  const normalizedBase = normalizeBaseUrl(baseUrl || "");
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(url);
  const path = isAbsoluteHttpUrl ? stripOrigin(url) : url;

  if (!path.startsWith("/")) return url;
  if (normalizedBase && (path === normalizedBase || path.startsWith(`${normalizedBase}/`))) {
    return path;
  }

  const isFileServicePath = FILE_SERVICE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!isFileServicePath && !isAbsoluteHttpUrl) return url;

  return `${normalizedBase}${path}` || "/";
}
