/** Download names like `source-title_00m12s-00m15s.gif` (SPEC §5.1). */

export function slugify(title: string, fallback = "innovate"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function mmss(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

export function exportFilename(
  title: string,
  ext: string,
  startSeconds: number,
  endSeconds?: number,
): string {
  const range = endSeconds === undefined ? mmss(startSeconds) : `${mmss(startSeconds)}-${mmss(endSeconds)}`;
  return `${slugify(title)}_${range}.${ext.replace(/^\./, "")}`;
}
