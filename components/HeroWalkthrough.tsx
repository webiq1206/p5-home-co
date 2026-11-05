"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type DataConnection = EventTarget & { saveData?: boolean; effectiveType?: string };

/** P5-owned media enhancement around the unchanged shared family hero. */
export default function HeroWalkthrough({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleRef = useRef<() => void>(() => {});
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const header = document.querySelector<HTMLElement>("[data-family-header]");
    if (!container || !header) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      // The measured header includes its border and safe-area padding once.
      // VisualViewport already excludes browser chrome; do not subtract it again.
      const height = viewport?.scale === 1 ? viewport.height : window.innerHeight;
      container.style.setProperty("--p5-hero-viewport-size", `${Math.ceil(height)}px`);
      container.style.setProperty("--p5-hero-header-size", `${header.getBoundingClientRect().height}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header, { box: "border-box" });
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    // Choose once, so rotating/resizing never downloads a second variant.
    const compact = window.matchMedia("(max-width: 1023px)").matches ||
      /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? "");
    const source = compact
      ? "/videos/p5-home-co-background-720p.mp4"
      : video.canPlayType('video/webm; codecs="vp9"')
        ? "/videos/p5-home-co-background.webm"
        : "/videos/p5-home-co-background-1080p.mp4";
    let active = true;
    let inView = false;
    let userPaused = false;
    let blocked = false;
    let failed = false;
    let pending = false;
    const permitted = () => !reducedMotion.matches && !connection?.saveData && !failed;
    const shouldPlay = () => permitted() && inView && !document.hidden && !userPaused && !blocked;

    const sync = () => {
      if (!active) return;
      setAvailable(permitted());
      if (!permitted()) {
        video.pause();
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        setReady(false);
        return;
      }
      if (!shouldPlay()) {
        video.pause();
        return;
      }
      if (!video.hasAttribute("src")) video.src = source;
      if (pending || !video.paused) return;
      video.muted = true;
      pending = true;
      void video.play().catch(() => {
        if (active && shouldPlay()) {
          blocked = true;
          setReady(false);
          setPlaying(false);
        }
      }).finally(() => { pending = false; });
    };
    const onPlaying = () => {
      if (!shouldPlay()) { video.pause(); return; }
      setReady(true);
      setPlaying(true);
    };
    const onPause = () => { if (active) setPlaying(false); };
    const onError = () => {
      failed = true;
      sync();
    };
    toggleRef.current = () => {
      userPaused = !video.paused;
      blocked = false;
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: 0 });
    observer.observe(container);
    reducedMotion.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onError);
    return () => {
      active = false;
      observer.disconnect();
      reducedMotion.removeEventListener("change", sync);
      connection?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
      toggleRef.current = () => {};
    };
  }, []);

  return (
    <div className="p5-home-hero" ref={containerRef}>
      {children}
      <video
        ref={videoRef}
        id="p5-hero-video"
        className="p5-hero-video"
        data-ready={ready}
        poster="/videos/p5-home-co-poster.jpg"
        width={1920}
        height={1080}
        muted
        autoPlay
        playsInline
        loop
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
        disablePictureInPicture
      />
      {available ? (
        <button
          className="p5-hero-playback"
          type="button"
          aria-controls="p5-hero-video"
          onClick={() => toggleRef.current()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            {playing ? (
              <path d="M8 5v14M16 5v14" />
            ) : (
              <path d="m8 5 11 7-11 7Z" />
            )}
          </svg>
          <span className="visually-hidden">{playing ? "Pause background video" : "Play background video"}</span>
        </button>
      ) : null}
    </div>
  );
}
