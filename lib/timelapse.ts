/**
 * The arithmetic that turns a session into an episode.
 *
 * One rule decides every number on this site:
 *
 *   > Every session is sped up by the same factor. Clip length is whatever
 *   > that produces.
 *
 * The alternative — render every session to a fixed length — would make a
 * twelve-hour day and a two-hour evening look identical in the shelf, which
 * is a lie about what happened. A longer day should produce a longer clip.
 *
 * No database or environment coupling, so the part that decides whether the
 * durations are honest can be tested on its own.
 */

/** Everything is sped up by this much. Changing it re-dates every old clip. */
export const SPEED = 400;

/** Frames per second in the rendered file. */
export const OUT_FPS = 30;

/** Seconds of real time between kept frames: 400 / 30 = 13.33… */
export const FRAME_INTERVAL_SECONDS = SPEED / OUT_FPS;

/**
 * The ffmpeg `-vf` chain that produces the clip.
 *
 * Order is the whole trick, and the obvious arrangement is wrong. Selecting
 * frames first and re-stamping them after —
 *
 *     fps=3/40,setpts=N/(30*TB)     // 3/40 = OUT_FPS/SPEED
 *
 * — picks exactly the right frames (one every 13.333s, verified) and then
 * fails to renumber them, because after the `fps` filter the stage timebase
 * is no longer what the expression assumes. Measured against a 400s source it
 * yields a 13.4s clip instead of a 1s one: a 13x overshoot that scales, so it
 * looks plausible on a short test and lands a twelve-hour day at 24 minutes.
 *
 * Scaling the timestamps first and resampling after is exact at every
 * duration tested (400s, 1800s, 3600s, 7200s all land on the frame):
 *
 *     setpts=PTS/400,fps=30
 *
 * `-r OUT_FPS` still belongs on the output as the container rate.
 */
export function videoFilter(speed = SPEED, outFps = OUT_FPS): string {
  return `setpts=PTS/${speed},fps=${outFps}`;
}

/** How long the rendered clip runs, in seconds. */
export function clipSeconds(sourceSeconds: number, speed = SPEED): number {
  if (sourceSeconds <= 0) return 0;
  return sourceSeconds / speed;
}

/** How many frames survive sampling. */
export function frameCount(
  sourceSeconds: number,
  speed = SPEED,
  outFps = OUT_FPS,
): number {
  if (sourceSeconds <= 0) return 0;
  return Math.floor(sourceSeconds / (speed / outFps));
}

/**
 * "1h 12m" / "9s" — for session durations, which run to hours.
 *
 * Hours are never elided when present, so a twelve-hour session never reads
 * as a twelve-minute one at a glance.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** "1:48" — for clip lengths, which run to minutes. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
