import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getStoredPlaybackVolume } from '../utils/callMediaPrefs';

interface VoiceMessagePlayerProps {
  src: string;
}

function formatMmSs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BARS = 36;

const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.25));
  const [dragging, setDragging] = useState(false);

  const analyzeStaticLevels = useCallback(async () => {
    try {
      const res = await fetch(src);
      const ab = await res.arrayBuffer();
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const audio = await ctx.decodeAudioData(ab.slice(0));
      const ch = audio.getChannelData(0);
      const win = Math.max(1, Math.floor(ch.length / BARS));
      const next: number[] = [];
      for (let i = 0; i < BARS; i++) {
        const start = i * win;
        const end = Math.min(ch.length, start + win);
        let peak = 0;
        for (let j = start; j < end; j++) {
          const v = Math.abs(ch[j]);
          if (v > peak) peak = v;
        }
        next.push(0.16 + Math.min(1, peak * 1.4) * 0.84);
      }
      setLevels(next);
      void ctx.close();
    } catch {
      setLevels(Array(BARS).fill(0.28));
    }
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const syncVol = () => {
      audio.volume = getStoredPlaybackVolume();
    };
    syncVol();
    window.addEventListener('sirius-playback-prefs', syncVol);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onTime = () => setCurrent(audio.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      window.removeEventListener('sirius-playback-prefs', syncVol);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }
    const tick = () => {
      setCurrent(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [playing]);

  useEffect(() => {
    void analyzeStaticLevels();
  }, [analyzeStaticLevels]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    void audio.play();
  };

  const setProgressFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    const audio = audioRef.current;
    if (!el || !audio || !duration) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    const t = r.width > 0 ? (x / r.width) * duration : 0;
    audio.currentTime = t;
    setCurrent(t);
  }, [duration]);

  const onTrackPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    trackRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    setProgressFromClientX(e.clientX);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (ev: PointerEvent) => setProgressFromClientX(ev.clientX);
    const up = (ev: PointerEvent) => {
      try {
        trackRef.current?.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, setProgressFromClientX]);

  const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
  const elapsedBars = Math.round((pct / 100) * BARS);

  return (
    <div className="sf-voice-player sf-voice-player--tg">
      <audio ref={audioRef} src={src} preload="metadata" className="sf-voice-player-audio">
        <track kind="captions" />
      </audio>
      <button
        type="button"
        className="sf-voice-player-play sf-voice-player-play--tg"
        onClick={() => void toggle()}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <span className="sf-voice-player-pause-bars" aria-hidden>
            <span className="sf-voice-player-pause-bar" />
            <span className="sf-voice-player-pause-bar" />
          </span>
        ) : (
          <span className="sf-voice-player-play-icon" aria-hidden />
        )}
      </button>
      <div className="sf-voice-player-mid" ref={trackRef} onPointerDown={onTrackPointerDown}>
        <div className="sf-voice-player-bars sf-voice-player-bars--tg" aria-hidden>
          {levels.map((h, i) => (
            <span
              key={i}
              className={`sf-voice-player-bar sf-voice-player-bar--tg${
                i < elapsedBars ? ' sf-voice-player-bar--played' : ''
              }`}
              style={{ transform: `scaleY(${h})` }}
            />
          ))}
        </div>
      </div>
      <span className="sf-voice-player-dur">
        <span className="sf-voice-player-dur-elapsed">{formatMmSs(current)}</span>
        <span className="sf-voice-player-dur-sep">/</span>
        <span className="sf-voice-player-dur-total">{formatMmSs(duration)}</span>
      </span>
    </div>
  );
};

export default VoiceMessagePlayer;
