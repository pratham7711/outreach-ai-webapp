import type { NextRequest } from "next/server";
import { cronRoute } from "@/lib/ops/cronRoute";
import { runPostSweep } from "@/lib/sync/postSweepRun";
import { instagramPacedHourly } from "@/lib/sync/instagramPacing";
import { SWEEP_PLATFORMS } from "@/lib/sync/sweepCandidates";

/* Every 6 hours, every platform -- except Instagram while the hourly paced pass
   owns it (lib/sync/instagramPacing). Kill switch and heartbeat: cronRoute. */
export const GET = cronRoute("sync-posts", (request: NextRequest) =>
  runPostSweep(request, {
    platforms: instagramPacedHourly() ? SWEEP_PLATFORMS.filter((p) => p !== "INSTAGRAM") : SWEEP_PLATFORMS,
  }),
);
