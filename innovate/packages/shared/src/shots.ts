/** Shot lists (M5): contract shared by the builder, API, CSV/PDF export and share page. */
import { z } from "zod";

export const FRAMINGS = ["ECU", "CU", "MCU", "MS", "MWS", "WS", "EWS", "OTS", "POV", "Insert"] as const;
export const FRAMING_LABEL: Record<(typeof FRAMINGS)[number], string> = {
  ECU: "Extreme close-up",
  CU: "Close-up",
  MCU: "Medium close-up",
  MS: "Medium shot",
  MWS: "Medium wide",
  WS: "Wide shot",
  EWS: "Extreme wide",
  OTS: "Over the shoulder",
  POV: "Point of view",
  Insert: "Insert",
};
export const SHOT_STATUSES = ["idea", "planned", "approved", "shot"] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

const text = (max: number) => z.string().max(max);

export const shotPatchSchema = z.object({
  number: text(20).optional(),
  scene: text(80).optional(),
  setting: text(200).optional(),
  description: text(4000).optional(),
  framing: z.enum(FRAMINGS).nullable().optional(),
  movement: text(120).optional(),
  lens: text(120).optional(),
  rig: text(120).optional(),
  durationSec: z.number().min(0).max(36_000).nullable().optional(),
  status: z.enum(SHOT_STATUSES).optional(),
  motionReferenceId: z.uuid().nullable().optional(),
  position: z.number().finite().optional(),
});
export type ShotPatch = z.infer<typeof shotPatchSchema>;

export const createShotSchema = shotPatchSchema.extend({ id: z.uuid().optional() });

export const createShotListSchema = z.object({
  title: z.string().trim().min(1).max(200).default("Untitled shot list"),
  boardId: z.uuid().nullable().optional(),
});
export const updateShotListSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), boardId: z.uuid().nullable().optional() });

export interface ShotRow {
  number: string;
  scene: string;
  setting: string;
  description: string;
  framing: string | null;
  movement: string;
  lens: string;
  rig: string;
  durationSec: number | null;
  status: string;
  motion?: { title: string; url: string } | null;
}

export const CSV_COLUMNS = ["#", "Scene", "Setting", "Description", "Framing", "Movement", "Lens", "Rig", "Duration (s)", "Status", "Motion reference", "Motion link"] as const;

/** RFC 4180 CSV. Cells that start with = + - @ are prefixed with ' so spreadsheets don't run them. */
export function shotsToCsv(rows: ShotRow[]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map(cell).join(",")];
  for (const r of rows)
    lines.push(
      [r.number, r.scene, r.setting, r.description, r.framing, r.movement, r.lens, r.rig, r.durationSec, r.status, r.motion?.title, r.motion?.url].map(cell).join(","),
    );
  return lines.join("\r\n") + "\r\n";
}

export function formatShotDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return "";
  return sec < 60 ? `${Number(sec.toFixed(1))}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, "0")}s`;
}
