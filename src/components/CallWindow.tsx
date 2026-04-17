import React, { useEffect, useRef, useState, useCallback } from 'react';
import { websocketService } from '../services/websocket';
import { IconPhoneHangup, IconMic, IconMicOff, IconScreenShare, IconVideo } from './icons';
import { audioInputConstraints, applyAudioOutput, getStoredMicInputVolume } from '../utils/callMediaPrefs';
import './CallWindow.css';

export interface CallSessionProps {
  role: 'caller' | 'callee';
  conversationId: string;
  currentUserId: string;
  peerId: string;
  remoteName: string;
  /** Initial session is always audio-only; camera can be enabled during the call. */
  isVideo: boolean;
  remoteOffer?: RTCSessionDescriptionInit;
  onClose: () => void;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const CallWindow: React.FC<CallSessionProps> = ({
  role,
  conversationId,
  currentUserId,
  peerId,
  remoteName,
  remoteOffer,
  onClose,
}) => {
  const [callStatus, setCallStatus] = useState<'connecting' | 'active' | 'ended'>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraTrackEnabled, setCameraTrackEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [renegotiating, setRenegotiating] = useState(false);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const [screenExpanded, setScreenExpanded] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const remoteOfferRef = useRef(remoteOffer);
  remoteOfferRef.current = remoteOffer;
  const screenStreamRef = useRef<MediaStream | null>(null);
  const extraVideoStreamRef = useRef<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawLocalStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const iceBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const remoteSpeakingStopRef = useRef<null | (() => void)>(null);

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const buf = [...iceBufferRef.current];
    iceBufferRef.current = [];
    for (const init of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(init));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const markRemote = useCallback(
    async (pc: RTCPeerConnection) => {
      if (remoteDescSetRef.current) return;
      remoteDescSetRef.current = true;
      await flushIce(pc);
    },
    [flushIce]
  );

  useEffect(() => {
    const handleIce = async (data: { targetId?: string; candidate?: RTCIceCandidateInit }) => {
      if (data.targetId !== currentUserId || !data.candidate) return;
      const pc = pcRef.current;
      if (!pc) return;
      if (!remoteDescSetRef.current) {
        iceBufferRef.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        /* ignore */
      }
    };

    const handleAnswer = async (data: {
      callerId?: string;
      conversationId?: string;
      encryptedAnswer?: RTCSessionDescriptionInit;
    }) => {
      if (data.callerId !== currentUserId || !data.encryptedAnswer) return;
      if (data.conversationId !== conversationId) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.encryptedAnswer));
        await markRemote(pc);
        setCallStatus('active');
      } catch {
        /* ignore */
      }
    };

    const handleOffer = async (data: {
      calleeId?: string;
      callerId?: string;
      conversationId?: string;
      encryptedOffer?: RTCSessionDescriptionInit;
    }) => {
      if (data.calleeId !== currentUserId || !data.encryptedOffer) return;
      if (data.conversationId !== conversationId) return;
      if (data.callerId !== peerId) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        setRenegotiating(true);
        await pc.setRemoteDescription(new RTCSessionDescription(data.encryptedOffer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        websocketService.sendCallAnswer(conversationId, peerId, answer);
        setCallStatus('active');
      } catch (e) {
        console.error(e);
      } finally {
        setRenegotiating(false);
      }
    };

    const handleSignal = (data: {
      targetId?: string;
      conversationId?: string;
      payload?: { kind?: string; muted?: boolean };
      fromUserId?: string;
    }) => {
      if (data.targetId !== currentUserId || data.conversationId !== conversationId) return;
      if (data.fromUserId !== peerId) return;
      if (data.payload?.kind === 'mic') {
        setRemoteMicMuted(!!data.payload.muted);
      }
    };

    const u1 = websocketService.onICECandidate(handleIce);
    const u2 = websocketService.onCallAnswer(handleAnswer);
    const u3 = websocketService.onCallOffer(handleOffer);
    const u4 = websocketService.onCallSignal(handleSignal);
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [conversationId, currentUserId, peerId, markRemote]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioInputConstraints(),
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        rawLocalStreamRef.current = stream;
        cameraVideoTrackRef.current = null;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const gain = audioCtx.createGain();
        gain.gain.value = getStoredMicInputVolume();
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        micAudioCtxRef.current = audioCtx;
        micGainRef.current = gain;
        destination.stream.getAudioTracks().forEach((track) => pc.addTrack(track, destination.stream));
        localStreamRef.current = destination.stream;

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            websocketService.sendICECandidate(conversationId, peerId, ev.candidate);
          }
        };

        pc.ontrack = (ev) => {
          if (remoteVideoRef.current && ev.streams[0]) {
            remoteVideoRef.current.srcObject = ev.streams[0];
            applyAudioOutput(remoteVideoRef.current);
            setRemoteHasVideo(ev.streams[0].getVideoTracks().length > 0);
          }
          // Speaking indicator via WebRTC audioLevel stats (lightweight)
          try {
            remoteSpeakingStopRef.current?.();
          } catch {
            /* ignore */
          }
          const recv = pc.getReceivers().find((r) => r.track?.kind === 'audio');
          if (!recv) return;
          let cancelledSpeak = false;
          const id = window.setInterval(async () => {
            if (cancelledSpeak) return;
            try {
              const stats = await recv.getStats();
              let speaking = false;
              stats.forEach((rep) => {
                if (rep.type === 'inbound-rtp' && (rep as { kind?: string }).kind === 'audio') {
                  const al = (rep as { audioLevel?: number }).audioLevel;
                  if (typeof al === 'number' && !Number.isNaN(al) && al > 0.02) speaking = true;
                }
              });
              setRemoteSpeaking(speaking);
            } catch {
              /* ignore */
            }
          }, 200);
          remoteSpeakingStopRef.current = () => {
            cancelledSpeak = true;
            window.clearInterval(id);
            setRemoteSpeaking(false);
          };
        };

        if (role === 'caller') {
          remoteDescSetRef.current = false;
          iceBufferRef.current = [];
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          websocketService.sendCallOffer(conversationId, peerId, offer, false);
          setCallStatus('connecting');
        } else {
          const offerBody = remoteOfferRef.current;
          if (!offerBody) {
            if (!cancelled) onCloseRef.current();
            return;
          }
          remoteDescSetRef.current = false;
          iceBufferRef.current = [];
          await pc.setRemoteDescription(new RTCSessionDescription(offerBody));
          await markRemote(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          websocketService.sendCallAnswer(conversationId, peerId, answer);
          setCallStatus('active');
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) onCloseRef.current();
      }
    };

    remoteDescSetRef.current = false;
    iceBufferRef.current = [];
    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      void run();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      try {
        remoteSpeakingStopRef.current?.();
      } catch {
        /* ignore */
      }
      remoteSpeakingStopRef.current = null;
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (extraVideoStreamRef.current) {
        extraVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        extraVideoStreamRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (rawLocalStreamRef.current) {
        rawLocalStreamRef.current.getTracks().forEach((t) => t.stop());
        rawLocalStreamRef.current = null;
      }
      if (micAudioCtxRef.current) {
        void micAudioCtxRef.current.close();
        micAudioCtxRef.current = null;
      }
      micGainRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [role, conversationId, peerId, markRemote]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (el && el.srcObject) applyAudioOutput(el);
  }, [callStatus]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sirius_audio_output' && remoteVideoRef.current) {
        applyAudioOutput(remoteVideoRef.current);
      }
    };
    const onPrefs = () => applyAudioOutput(remoteVideoRef.current);
    window.addEventListener('storage', onStorage);
    window.addEventListener('sirius-audio-prefs', onPrefs);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sirius-audio-prefs', onPrefs);
    };
  }, []);

  useEffect(() => {
    const syncGain = () => {
      if (micGainRef.current) micGainRef.current.gain.value = getStoredMicInputVolume();
    };
    window.addEventListener('sirius-audio-prefs', syncGain);
    return () => window.removeEventListener('sirius-audio-prefs', syncGain);
  }, []);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (isScreenSharing && screenStreamRef.current) {
      el.srcObject = screenStreamRef.current;
    } else if (cameraOn && cameraVideoTrackRef.current) {
      const ms = new MediaStream([cameraVideoTrackRef.current]);
      el.srcObject = ms;
    } else {
      el.srcObject = null;
    }
  }, [isScreenSharing, cameraOn]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (callStatus === 'active') {
      interval = setInterval(() => setDuration((d) => d + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audio = stream.getAudioTracks()[0];
    if (audio) {
      const next = !audio.enabled;
      audio.enabled = next;
      setIsMuted(!next);
      websocketService.sendCallSignal(conversationId, peerId, { kind: 'mic', muted: !next });
    }
  };

  const enableCamera = async () => {
    const pc = pcRef.current;
    if (!pc || cameraOn || renegotiating) return;
    try {
      setRenegotiating(true);
      const vStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (extraVideoStreamRef.current) {
        extraVideoStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      extraVideoStreamRef.current = vStream;
      const vt = vStream.getVideoTracks()[0];
      if (!vt) return;
      cameraVideoTrackRef.current = vt;
      vt.enabled = true;
      setCameraTrackEnabled(true);
      pc.addTrack(vt, vStream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      websocketService.sendCallOffer(conversationId, peerId, offer, true);
      setCameraOn(true);
    } catch (e) {
      console.error(e);
    } finally {
      setRenegotiating(false);
    }
  };

  const toggleCameraEnabled = () => {
    const v = cameraVideoTrackRef.current;
    if (!v) return;
    v.enabled = !v.enabled;
    setCameraTrackEnabled(v.enabled);
  };

  const toggleScreenShare = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (!isScreenSharing) {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const v = screen.getVideoTracks()[0];
        if (!v) return;
        screenStreamRef.current = screen;
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(v);
        } else {
          pc.addTrack(v, screen);
        }
        v.onended = () => void toggleScreenShare();
        setIsScreenSharing(true);
      } else {
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
        }
        const cam = cameraVideoTrackRef.current;
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (cam && sender) {
          await sender.replaceTrack(cam);
        } else if (sender) {
          await sender.replaceTrack(null);
          try {
            pc.removeTrack(sender);
          } catch {
            /* ignore */
          }
        }
        setIsScreenSharing(false);
      }
    } catch {
      /* user cancelled */
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const end = () => {
    onCloseRef.current();
  };

  const showLocalPreview = cameraOn || isScreenSharing;
  const showExpand = isScreenSharing || remoteHasVideo;

  return (
    <div className={`call-window ${screenExpanded ? 'call-window--expanded' : ''}`}>
      <div className="call-window-top">
        <span className="call-window-name">
          {remoteName}
          {remoteMicMuted ? (
            <span className="call-remote-mic-off" title="Their microphone is off">
              <IconMicOff width={16} height={16} />
            </span>
          ) : null}
        </span>
        <span className="call-window-status">
          {renegotiating
            ? 'Updating…'
            : callStatus === 'active'
              ? formatDuration(duration)
              : 'Connecting…'}
        </span>
      </div>
      <div className={`video-container${remoteSpeaking ? ' call-remote-speaking' : ''}`}>
        <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
        {callStatus === 'connecting' && role === 'caller' ? (
          <div className="call-waiting-overlay" aria-label="Calling…">
            <div className="call-waiting-avatar" aria-hidden>
              {remoteName.trim().slice(0, 1).toUpperCase()}
            </div>
            <div className="call-waiting-text">Calling…</div>
          </div>
        ) : null}
        {showExpand ? (
          <div className="call-expand-zone">
            <button
              type="button"
              className="call-expand-btn"
              title="Full screen"
              aria-label="Full screen"
              onClick={() => setScreenExpanded((x) => !x)}
            >
              <span aria-hidden>⛶</span>
            </button>
          </div>
        ) : null}
        {showLocalPreview ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`local-video ${isScreenSharing ? 'local-video--screenshare' : ''}`}
          />
        ) : null}
      </div>

      <div className="call-controls">
        <button type="button" onClick={toggleMute} className={isMuted ? 'active' : ''} title="Mute" aria-label="Mute">
          <span className="call-ctrl-icon">
            {isMuted ? <IconMicOff width={22} height={22} /> : <IconMic width={22} height={22} />}
          </span>
        </button>
        {!cameraOn ? (
          <button type="button" onClick={() => void enableCamera()} disabled={renegotiating} title="Turn camera on" aria-label="Camera on">
            <span className="call-ctrl-icon">
              <IconVideo width={22} height={22} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleCameraEnabled}
            className={!cameraTrackEnabled ? 'active' : ''}
            title="Camera on/off"
            aria-label="Camera"
          >
            <span className="call-ctrl-icon">
              {cameraTrackEnabled ? <IconVideo width={22} height={22} /> : <IconMicOff width={22} height={22} />}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={isScreenSharing ? 'active' : ''}
          title="Share screen"
          aria-label="Share screen"
        >
          <span className="call-ctrl-icon">
            <IconScreenShare width={22} height={22} />
          </span>
        </button>
        <button type="button" onClick={end} className="end-call" title="End call" aria-label="End call">
          <IconPhoneHangup width={22} height={22} />
        </button>
      </div>
    </div>
  );
};

export default CallWindow;
