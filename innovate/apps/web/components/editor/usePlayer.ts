"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FrameRate, fpsValue, frameSeekTime, secondsToFrame } from "@innovate/shared";

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Frame-accurate control of the proxy <video>.
 *
 * - Paused: the UI owns the frame; we seek to the middle of that frame so the decoder shows
 *   exactly it. Seeks are coalesced: while one is in flight we only remember the latest
 *   target, which keeps scrubbing smooth instead of queueing hundreds of seeks.
 * - Playing forward: requestVideoFrameCallback reports the presented frame's mediaTime.
 * - Shuttle: L/J double the speed. Forward uses playbackRate; reverse (which browsers can't
 *   play) steps backwards on animation frames.
 */
export function usePlayer(opts: { fps: FrameRate | null; frameCount: number }) {
  const videoRef = useRef<VideoWithRvfc | null>(null);
  const [frame, setFrame] = useState(0);
  const [shuttle, setShuttle] = useState(0); // 0 stopped, ±1, ±2, ±4, ±8
  const [ready, setReady] = useState(false);
  const target = useRef(0);
  const frameRef = useRef(0);
  const fps = opts.fps;
  const last = Math.max(0, opts.frameCount - 1);

  const applySeek = useCallback(() => {
    const v = videoRef.current;
    if (!v || !fps || v.seeking) return;
    const want = frameSeekTime(target.current, fps);
    if (Math.abs(v.currentTime - want) > 1e-4) v.currentTime = want;
  }, [fps]);

  const seek = useCallback(
    (f: number) => {
      const clamped = Math.max(0, Math.min(last, Math.round(f)));
      target.current = clamped;
      frameRef.current = clamped;
      setFrame(clamped);
      const v = videoRef.current;
      if (v && !v.paused) {
        // Playing: jump and keep playing.
        if (fps) v.currentTime = frameSeekTime(clamped, fps);
        return;
      }
      applySeek();
    },
    [applySeek, fps, last],
  );

  // Video element events.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !fps) return;
    const onSeeked = () => {
      if (v.paused) applySeek();
    };
    const onLoaded = () => {
      setReady(true);
      applySeek();
    };
    const onEnded = () => {
      setShuttle(0);
      seek(last);
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("ended", onEnded);
    if (v.readyState >= 2) onLoaded();
    return () => {
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("ended", onEnded);
    };
  }, [applySeek, fps, last, seek]);

  // Forward playback: follow presented frames.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !fps || shuttle <= 0) return;
    let handle = 0;
    let raf = 0;
    const report = (t: number) => {
      const f = Math.min(last, secondsToFrame(t, fps));
      target.current = f;
      frameRef.current = f;
      setFrame(f);
    };
    if (v.requestVideoFrameCallback) {
      const cb = (_now: number, meta: { mediaTime: number }) => {
        report(meta.mediaTime);
        handle = v.requestVideoFrameCallback!(cb);
      };
      handle = v.requestVideoFrameCallback(cb);
    } else {
      const tick = () => {
        report(v.currentTime);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    v.playbackRate = shuttle;
    v.play().catch(() => setShuttle(0));
    return () => {
      if (handle) v.cancelVideoFrameCallback?.(handle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fps, last, shuttle]);

  // Reverse shuttle: step backwards in real time.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !fps || shuttle >= 0) return;
    v.pause();
    let raf = 0;
    let prev = performance.now();
    let pos = frameRef.current;
    const tick = (now: number) => {
      pos += (shuttle * fpsValue(fps) * (now - prev)) / 1000;
      prev = now;
      if (pos <= 0) {
        seek(0);
        setShuttle(0);
        return;
      }
      if (Math.round(pos) !== frameRef.current) seek(pos);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, seek, shuttle]);

  // Stopping: pause and snap to a frame boundary.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || shuttle !== 0) return;
    if (!v.paused) v.pause();
    v.playbackRate = 1;
    applySeek();
  }, [applySeek, shuttle]);

  const stop = useCallback(() => setShuttle(0), []);
  const togglePlay = useCallback(() => {
    setShuttle((s) => {
      if (s !== 0) return 0;
      if (frameRef.current >= last) seek(0);
      return 1;
    });
  }, [last, seek]);
  const shuttleForward = useCallback(() => setShuttle((s) => (s <= 0 ? 1 : Math.min(8, s * 2))), []);
  const shuttleBack = useCallback(() => setShuttle((s) => (s >= 0 ? -1 : Math.max(-8, s * 2))), []);
  const step = useCallback(
    (delta: number) => {
      setShuttle(0);
      seek(frameRef.current + delta);
    },
    [seek],
  );

  return { videoRef, frame, frameRef, seek, step, shuttle, playing: shuttle !== 0, ready, stop, togglePlay, shuttleForward, shuttleBack };
}
