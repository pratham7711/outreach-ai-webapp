import type { NextRequest } from "next/server";
import { cronRoute } from "@/lib/ops/cronRoute";
import { runPostSweep } from "@/lib/sync/postSweepRun";
import { instagramPacedHourly } from "@/lib/sync/instagramPacing";
import { SWEEP_PLATFORMS } from "@/lib/sync/sweepCandidates";

/* Declared, not inherited: runPostSweep's deadline is four minutes plus a 30s
   backstop (lib/ops/waitUntil), and both are sized against this. The run has
   been measured going to 243.6s, so a project default below 300 would kill it
   before its own deadline. sync-instagram-posts already declares the same. */
export const maxDuration = 300;

/* Every 6 hours, every platform -- except Instagram while the hourly paced pass
   owns it (lib/sync/instagramPacing). Kill switch and heartbeat: cronRoute. */
export const GET = cronRoute("sync-posts", (request: NextRequest) =>
  runPostSweep(request, {
    platforms: instagramPacedHourly() ? SWEEP_PLATFORMS.filter((p) => p !== "INSTAGRAM") : SWEEP_PLATFORMS,
  }),
);
