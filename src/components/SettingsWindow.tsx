import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { authService } from '../services/auth';
import { readImageAsDataUrl, AvatarBubble } from '../utils/avatar';
import { SiriusTheme } from '../utils/theme';
import {
  AUDIO_INPUT_KEY,
  AUDIO_OUTPUT_KEY,
  MIC_INPUT_VOLUME_KEY,
  getStoredPlaybackVolume,
  getStoredMicInputVolume,
  setStoredPlaybackVolume,
} from '../utils/callMediaPrefs';
import { IconX } from './icons';
import { t, getStoredLang, setStoredLang, type AppLang } from '../utils/i18n';

const NOTIF_KEY = 'sirius_pref_desktop_notif';
const SOUND_KEY = 'sirius_pref_sound';
const MSG_SOUND_VOL_KEY = 'sirius_msg_sound_volume';

type SettingsSection = 'profile' | 'design' | 'advanced' | 'notifications' | 'sound';

interface SettingsWindowProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
  appearanceTheme: SiriusTheme;
  onAppearanceThemeChange: (t: SiriusTheme) => void;
  onUiLocaleChange?: () => void;
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

const SettingsWindow: React.FC<SettingsWindowProps> = ({
  isOpen,
  onClose,
  user,
  onLogout,
  onUserUpdated,
  appearanceTheme,
  onAppearanceThemeChange,
  onUiLocaleChange,
}) => {
  const [section, setSection] = useState<SettingsSection>('profile');
  const [uiLang, setUiLang] = useState<AppLang>(() => getStoredLang());
  const [notif, setNotif] = useState(() => loadBool(NOTIF_KEY, false));
  const [sound, setSound] = useState(() => loadBool(SOUND_KEY, true));
  const [username, setUsername] = useState(user.username);
  const [avatarDataUrl, setAvatarDataUrl] = useState(user.avatar || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState(() => {
    try {
      return localStorage.getItem(AUDIO_INPUT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => {
    try {
      return localStorage.getItem(AUDIO_OUTPUT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [playbackVol, setPlaybackVolState] = useState(() => getStoredPlaybackVolume());
  const [msgSoundVol, setMsgSoundVol] = useState(() => {
    const v = Number(localStorage.getItem(MSG_SOUND_VOL_KEY) || '1');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });
  const [micInputVol, setMicInputVol] = useState(() => {
    return getStoredMicInputVolume();
  });
  const [micLevel, setMicLevel] = useState(0);

  const refreshAudioDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      /* labels may stay empty until permission */
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(list.filter((d) => d.kind === 'audioinput'));
      setAudioOutputs(list.filter((d) => d.kind === 'audiooutput'));
    } catch {
      setAudioInputs([]);
      setAudioOutputs([]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSection('profile');
      setUiLang(getStoredLang());
      setNotif(loadBool(NOTIF_KEY, false));
      setSound(loadBool(SOUND_KEY, true));
      setUsername(user.username);
      setAvatarDataUrl(user.avatar || '');
      setProfileErr(null);
      try {
        setSelectedMic(localStorage.getItem(AUDIO_INPUT_KEY) || '');
        setSelectedSpeaker(localStorage.getItem(AUDIO_OUTPUT_KEY) || '');
      } catch {
        /* ignore */
      }
      setPlaybackVolState(getStoredPlaybackVolume());
    }
  }, [isOpen, user.id, user.username, user.avatar]);

  useEffect(() => {
    if (!isOpen || section !== 'sound') return;
    void refreshAudioDevices();
    const onChange = () => void refreshAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, [isOpen, section, refreshAudioDevices]);

  useEffect(() => {
    if (!isOpen || section !== 'sound') return;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let gainNode: GainNode | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) return;
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src = ctx.createMediaStreamSource(stream);
        gainNode = ctx.createGain();
        gainNode.gain.value = micInputVol;
        src.connect(gainNode);
        gainNode.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (!analyser) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const level = Math.max(0, Math.min(1, rms * 2.2));
          setMicLevel(level);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setMicLevel(0);
      }
    };
    void run();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try {
        src?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyser?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        gainNode?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        ctx?.close();
      } catch {
        /* ignore */
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setMicLevel(0);
    };
  }, [isOpen, section, selectedMic, micInputVol]);

  const persist = (key: string, val: boolean) => {
    localStorage.setItem(key, val ? '1' : '0');
  };

  if (!isOpen) return null;

  const saveProfile = async () => {
    const u = username.trim();
    if (!u) {
      setProfileErr('Display name cannot be empty');
      return;
    }
    setProfileBusy(true);
    setProfileErr(null);
    try {
      const updated = await authService.updateProfile({
        username: u,
        avatar: avatarDataUrl || '',
      });
      onUserUpdated(updated);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      setProfileErr(ax.response?.data?.error || 'Could not save profile');
    } finally {
      setProfileBusy(false);
    }
  };

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    try {
      setAvatarDataUrl(await readImageAsDataUrl(f));
      setProfileErr(null);
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Invalid image');
    }
  };

  const clearAvatar = () => {
    setAvatarDataUrl('');
    setProfileErr(null);
  };

  const tabs: { id: SettingsSection; label: string }[] = [
    { id: 'profile', label: t('nav.profile') },
    { id: 'design', label: t('nav.design') },
    { id: 'advanced', label: t('nav.advanced') },
    { id: 'notifications', label: t('nav.notifications') },
    { id: 'sound', label: t('nav.sound') },
  ];

  return (
    <div className="sf-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-modal sf-modal--settings sf-modal--settings-wide"
        role="dialog"
        aria-labelledby="sf-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sf-modal-head">
          <h2 id="sf-settings-title" className="sf-modal-title">
            {t('settings.title')}
          </h2>
          <button type="button" className="sf-modal-close" onClick={onClose} aria-label="Close">
            <IconX width={20} height={20} />
          </button>
        </div>

        <nav className="sf-settings-tabs" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sf-settings-tab${section === t.id ? ' sf-settings-tab--active' : ''}`}
              onClick={() => setSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="sf-modal-body sf-settings-body">
          {section === 'profile' && (
            <section className="sf-settings-section sf-settings-section--solo">
              <h3 className="sf-settings-section-title">{t('nav.profile')}</h3>
              {profileErr ? <p className="sf-settings-error">{profileErr}</p> : null}
              <div className="sf-settings-account">
                <AvatarBubble label={username || user.username} avatarUrl={avatarDataUrl} className="sf-avatar--lg" />
                <div>
                  <p className="sf-settings-email">{user.email}</p>
                  <div className="sf-group-avatar-actions" style={{ marginTop: '0.5rem' }}>
                    <label className="sf-btn sf-btn--primary-sm sf-file-label">
                      Change photo
                      <input
                        type="file"
                        accept="image/*"
                        className="sf-file-input"
                        onChange={(e) => void onPickAvatar(e)}
                        disabled={profileBusy}
                      />
                    </label>
                    {avatarDataUrl ? (
                      <button
                        type="button"
                        className="sf-btn sf-btn--ghost sf-btn--small"
                        onClick={clearAvatar}
                        disabled={profileBusy}
                      >
                        Remove photo
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Display name</span>
                <input
                  type="text"
                  className="sf-settings-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={64}
                  autoComplete="username"
                />
              </label>
              <button
                type="button"
                className="sf-btn sf-btn--primary-sm"
                style={{ marginTop: '0.75rem' }}
                onClick={() => void saveProfile()}
                disabled={profileBusy}
              >
                Save profile
              </button>
              <button
                type="button"
                className="sf-btn sf-btn--danger-outline"
                style={{ marginTop: '0.75rem' }}
                onClick={() => {
                  onClose();
                  onLogout();
                }}
              >
                Log out
              </button>
            </section>
          )}

          {section === 'design' && (
            <section className="sf-settings-section sf-settings-section--solo">
              <h3 className="sf-settings-section-title">{t('nav.design')}</h3>
              <p className="sf-settings-hint">Choose how Sirius looks on this device.</p>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">{t('settings.appearanceLabel')}</span>
                <select
                  className="sf-settings-select"
                  value={appearanceTheme}
                  onChange={(e) => onAppearanceThemeChange(e.target.value as SiriusTheme)}
                >
                  <option value="dark">{t('settings.themeDark')}</option>
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="system">{t('settings.themeSystem')}</option>
                </select>
              </label>
            </section>
          )}

          {section === 'advanced' && (
            <section className="sf-settings-section sf-settings-section--solo">
              <h3 className="sf-settings-section-title">{t('nav.advanced')}</h3>
              <p className="sf-settings-hint">{t('settings.advancedHint')}</p>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">{t('settings.language')}</span>
                <select
                  className="sf-settings-select"
                  value={uiLang}
                  onChange={(e) => {
                    const v = e.target.value as AppLang;
                    setUiLang(v);
                    setStoredLang(v);
                    onUiLocaleChange?.();
                  }}
                >
                  <option value="en">{t('settings.langEn')}</option>
                  <option value="ru">{t('settings.langRu')}</option>
                </select>
              </label>
            </section>
          )}

          {section === 'notifications' && (
            <section className="sf-settings-section sf-settings-section--solo">
              <h3 className="sf-settings-section-title">{t('nav.notifications')}</h3>
              <p className="sf-settings-hint">Control desktop alerts for new activity.</p>
              <label className="sf-settings-toggle-row">
                <div>
                  <span className="sf-settings-toggle-label">Desktop notifications</span>
                  <span className="sf-settings-toggle-hint">Browser permission may be required</span>
                </div>
                <input
                  type="checkbox"
                  className="sf-settings-switch"
                  checked={notif}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setNotif(v);
                    persist(NOTIF_KEY, v);
                    if (v && 'Notification' in window && Notification.permission === 'default') {
                      Notification.requestPermission().catch(() => {});
                    }
                  }}
                />
              </label>
            </section>
          )}

          {section === 'sound' && (
            <section className="sf-settings-section sf-settings-section--solo">
              <h3 className="sf-settings-section-title">{t('nav.sound')}</h3>
              <p className="sf-settings-hint">Calls and recordings use your microphone; call playback uses the selected output when the browser supports it.</p>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Microphone</span>
                <select
                  className="sf-settings-select"
                  value={selectedMic}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedMic(v);
                    localStorage.setItem(AUDIO_INPUT_KEY, v);
                    window.dispatchEvent(new Event('sirius-audio-prefs'));
                  }}
                >
                  <option value="">Default</option>
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 8)}…`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Microphone volume</span>
                <input
                  type="range"
                  className="sf-settings-range"
                  min={0}
                  max={100}
                  value={Math.round(micInputVol * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setMicInputVol(v);
                    localStorage.setItem(MIC_INPUT_VOLUME_KEY, String(v));
                    window.dispatchEvent(new Event('sirius-audio-prefs'));
                  }}
                />
              </label>
              <div className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Microphone level</span>
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round(micLevel * 100)}%`,
                      background: micLevel > 0.72 ? '#22c55e' : micLevel > 0.35 ? '#a3e635' : '#94a3b8',
                      transition: 'width 80ms linear',
                    }}
                  />
                </div>
              </div>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Speaker / output</span>
                <select
                  className="sf-settings-select"
                  value={selectedSpeaker}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedSpeaker(v);
                    localStorage.setItem(AUDIO_OUTPUT_KEY, v);
                    window.dispatchEvent(new Event('sirius-audio-prefs'));
                  }}
                >
                  <option value="">Default</option>
                  {audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Output ${d.deviceId.slice(0, 8)}…`}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="sf-btn sf-btn--ghost sf-btn--small" style={{ marginBottom: '1rem' }} onClick={() => void refreshAudioDevices()}>
                Refresh device list
              </button>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">Messenger sounds volume</span>
                <input
                  type="range"
                  className="sf-settings-range"
                  min={0}
                  max={100}
                  value={Math.round(msgSoundVol * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setMsgSoundVol(v);
                    localStorage.setItem(MSG_SOUND_VOL_KEY, String(v));
                  }}
                />
              </label>
              <label className="sf-settings-field-block">
                <span className="sf-settings-toggle-label">{t('settings.playbackVol')}</span>
                <input
                  type="range"
                  className="sf-settings-range"
                  min={0}
                  max={100}
                  value={Math.round(playbackVol * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setPlaybackVolState(v);
                    setStoredPlaybackVolume(v);
                    window.dispatchEvent(new Event('sirius-playback-prefs'));
                  }}
                />
              </label>
              <label className="sf-settings-toggle-row">
                <div>
                  <span className="sf-settings-toggle-label">Message sounds</span>
                  <span className="sf-settings-toggle-hint">Play a tone when new messages arrive</span>
                </div>
                <input
                  type="checkbox"
                  className="sf-settings-switch"
                  checked={sound}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSound(v);
                    persist(SOUND_KEY, v);
                  }}
                />
              </label>
            </section>
          )}

          <p className="sf-settings-foot">Sirius — 1:1 chats use RSA + AES; groups use a shared chat key</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
