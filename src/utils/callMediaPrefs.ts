export const AUDIO_INPUT_KEY = 'sirius_audio_input';
export const AUDIO_OUTPUT_KEY = 'sirius_audio_output';
export const NOISE_REDUCTION_KEY = 'sirius_noise_reduction';
export const PLAYBACK_VOLUME_KEY = 'sirius_playback_volume';
export const MIC_INPUT_VOLUME_KEY = 'sirius_mic_input_volume';

export function getStoredAudioInputId(): string | null {
  try {
    return localStorage.getItem(AUDIO_INPUT_KEY);
  } catch {
    return null;
  }
}

export function getStoredAudioOutputId(): string | null {
  try {
    return localStorage.getItem(AUDIO_OUTPUT_KEY);
  } catch {
    return null;
  }
}

function loadBool(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v === '1';
  } catch {
    return defaultVal;
  }
}

export function getNoiseReductionEnabled(): boolean {
  return loadBool(NOISE_REDUCTION_KEY, true);
}

/** Playback volume 0–1 for HTML media elements */
export function getStoredPlaybackVolume(): number {
  try {
    const v = localStorage.getItem(PLAYBACK_VOLUME_KEY);
    if (v === null) return 1;
    const n = parseFloat(v);
    if (Number.isNaN(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 1;
  }
}

export function setStoredPlaybackVolume(vol: number): void {
  localStorage.setItem(PLAYBACK_VOLUME_KEY, String(Math.min(1, Math.max(0, vol))));
}

export function getStoredMicInputVolume(): number {
  try {
    const v = localStorage.getItem(MIC_INPUT_VOLUME_KEY);
    if (v === null) return 1;
    const n = parseFloat(v);
    if (Number.isNaN(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 1;
  }
}

export function audioInputConstraints(): boolean | MediaTrackConstraints {
  const id = getStoredAudioInputId();
  const noise = getNoiseReductionEnabled();
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: noise,
    autoGainControl: true,
  };
  if (id) return { deviceId: { exact: id }, ...base };
  return base;
}

/** Apply speaker/output device and playback volume to a media element (Chrome / some browsers). */
export function applyAudioOutput(element: HTMLMediaElement | null): void {
  if (!element) return;
  const vol = getStoredPlaybackVolume();
  element.volume = vol;
  const id = getStoredAudioOutputId();
  if (!id) return;
  const el = element as HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> };
  if (typeof el.setSinkId === 'function') {
    el.setSinkId(id).catch(() => {});
  }
}
