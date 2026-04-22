import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { websocketService } from '../services/websocket';
import { fmt, membersLabel, t } from '../utils/i18n';
import { IconPhoneHangup, IconMic, IconMicOff, IconScreenShare } from './icons';
import { AvatarBubble } from '../utils/avatar';
import { audioInputConstraints, applyAudioOutput, getStoredMicInputVolume } from '../utils/callMediaPrefs';
import './CallWindow.css';
import './GroupCallWindow.css';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export interface GroupCallWindowProps {
  callId: string;
  conversationId: string;
  currentUserId: string;
  memberIds: string[];
  initiatorId: string;
  displayName: (userId: string) => string;
  avatarUrlFor?: (userId: string) => string | undefined;
  onClose: () => void;
}

type PeerState = {
  pc: RTCPeerConnection;
  remoteDescSet: boolean;
  iceBuffer: RTCIceCandidateInit[];
};

type FocusTarget = null | { kind: 'screen' } | { kind: 'user'; id: string };

function isScreenShareTrack(t: MediaStreamTrack | null | undefined): boolean {
  if (!t || t.kind !== 'video') return false;
  return /screen|window|display|monitor|web-contents|share/i.test(t.label || '');
}

function cameraOnlyStream(stream: MediaStream | null): MediaStream | null {
  if (!stream) return null;
  const vt = stream.getVideoTracks().find((t) => !isScreenShareTrack(t));
  if (!vt) return null;
  return new MediaStream([vt]);
}

function screenOnlyStream(stream: MediaStream | null): MediaStream | null {
  if (!stream) return null;
  const vt = stream.getVideoTracks().find((t) => isScreenShareTrack(t));
  if (!vt) return null;
  return new MediaStream([vt]);
}

const GcVideo: React.FC<{ stream: MediaStream | null; muted?: boolean; className?: string }> = ({
  stream,
  muted,
  className,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    applyAudioOutput(v);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={!!muted} className={className || ''} />;
};

const GroupCallWindow: React.FC<GroupCallWindowProps> = ({
  callId,
  conversationId,
  currentUserId,
  memberIds,
  initiatorId,
  displayName,
  avatarUrlFor,
  onClose,
}) => {
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStreamForUi, setScreenStreamForUi] = useState<MediaStream | null>(null);
  const [remoteMicMuted, setRemoteMicMuted] = useState<Record<string, boolean>>({});
  const [screenExpanded, setScreenExpanded] = useState(false);
  const [tiles, setTiles] = useState<{ id: string; stream: MediaStream | null }[]>([]);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const [speakingRemote, setSpeakingRemote] = useState<Set<string>>(() => new Set());
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [tileCtx, setTileCtx] = useState<{ x: number; y: number; userId: string } | null>(null);
  const tileMenuRef = useRef<HTMLDivElement>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => new Set([currentUserId]));

  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const offerRetryRef = useRef<Map<string, number>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawLocalStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const uniqueMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of memberIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [memberIds]);

  const remoteMembers = useMemo(
    () => uniqueMembers.filter((id) => id !== currentUserId).sort(),
    [uniqueMembers, currentUserId]
  );

  // UI shows local user tile + up to 8 others (total 9 like before)
  const uiMembers = useMemo(() => [currentUserId, ...remoteMembers], [currentUserId, remoteMembers]);
  const visibleMembers = useMemo(() => uiMembers.slice(0, 9), [uiMembers]);
  const overflowCount = Math.max(0, uiMembers.length - 9);
  const canKick = currentUserId === initiatorId;

  // For signaling topology, only create peer connections to other members.
  const sortedMembers = remoteMembers;

  const remoteScreenPeer = useMemo(() => {
    for (const t of tiles) {
      if (screenOnlyStream(t.stream)) return t.id;
    }
    return null;
  }, [tiles]);

  const screenDisplayStream = useMemo(() => {
    if (isScreenSharing && screenStreamForUi) return screenStreamForUi;
    if (remoteScreenPeer) {
      const tile = tiles.find((x) => x.id === remoteScreenPeer);
      return screenOnlyStream(tile?.stream ?? null);
    }
    return null;
  }, [isScreenSharing, screenStreamForUi, remoteScreenPeer, tiles]);

  const showScreenCell = !!screenDisplayStream;

  const getRemoteStream = useCallback(
    (userId: string) => {
      if (userId === currentUserId) return null;
      return tiles.find((t) => t.id === userId)?.stream ?? null;
    },
    [tiles, currentUserId]
  );

  const flushIce = useCallback(async (peerId: string) => {
    const st = peersRef.current.get(peerId);
    if (!st || !st.remoteDescSet) return;
    const buf = [...st.iceBuffer];
    st.iceBuffer = [];
    for (const c of buf) {
      try {
        await st.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const markRemote = useCallback(
    async (peerId: string) => {
      const st = peersRef.current.get(peerId);
      if (!st || st.remoteDescSet) return;
      st.remoteDescSet = true;
      await flushIce(peerId);
    },
    [flushIce]
  );

  const updateTiles = useCallback(() => {
    const list: { id: string; stream: MediaStream | null }[] = [];
    remoteMembers.forEach((id) => {
      const st = peersRef.current.get(id);
      if (!st) {
        list.push({ id, stream: null });
        return;
      }
      const receivers = st.pc.getReceivers();
      const stream = new MediaStream();
      receivers.forEach((r) => {
        if (r.track) stream.addTrack(r.track);
      });
      list.push({ id, stream: stream.getTracks().length ? stream : null });
    });
    setTiles(list);
  }, [remoteMembers]);

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
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const gain = audioCtx.createGain();
        gain.gain.value = getStoredMicInputVolume();
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        micAudioCtxRef.current = audioCtx;
        micGainRef.current = gain;
        localStreamRef.current = destination.stream;

        const createPeer = (remoteId: string): PeerState => {
          const pc = new RTCPeerConnection(ICE_SERVERS);
          const st: PeerState = { pc, remoteDescSet: false, iceBuffer: [] };
          destination.stream.getAudioTracks().forEach((t) => pc.addTrack(t, destination.stream));

          pc.onicecandidate = (ev) => {
            if (ev.candidate) {
              websocketService.sendICECandidate(conversationId, remoteId, ev.candidate);
            }
          };

          pc.ontrack = () => {
            updateTiles();
          };

          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
              updateTiles();
            }
          };

          return st;
        };

        for (const remoteId of sortedMembers) {
          if (remoteId === currentUserId) continue;
          if (currentUserId < remoteId) {
            const st = createPeer(remoteId);
            peersRef.current.set(remoteId, st);
            const offer = await st.pc.createOffer();
            await st.pc.setLocalDescription(offer);
            websocketService.sendCallOffer(conversationId, remoteId, offer, false, {
              groupCallId: callId,
              memberIds: sortedMembers,
            });
          }
        }
        updateTiles();
      } catch (e) {
        console.error(e);
        alert(t('call.micPermissionRequired'));
        onCloseRef.current();
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setScreenStreamForUi(null);
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
      const snap = new Map(peersRef.current);
      snap.forEach((st) => st.pc.close());
      peersRef.current = new Map();
    };
  }, [callId, conversationId, currentUserId, sortedMembers, updateTiles]);

  useEffect(() => {
    const syncGain = () => {
      if (micGainRef.current) micGainRef.current.gain.value = getStoredMicInputVolume();
    };
    window.addEventListener('sirius-audio-prefs', syncGain);
    return () => window.removeEventListener('sirius-audio-prefs', syncGain);
  }, []);

  useEffect(() => {
    const handleOffer = async (data: {
      calleeId?: string;
      callerId?: string;
      conversationId?: string;
      encryptedOffer?: RTCSessionDescriptionInit;
      groupCallId?: string;
      memberIds?: string[];
    }) => {
      if (data.calleeId !== currentUserId || !data.encryptedOffer || data.conversationId !== conversationId) return;
      if (data.groupCallId !== callId) return;
      const callerId = data.callerId as string;
      if (callerId >= currentUserId) return;

      if (peersRef.current.has(callerId)) return;

      const stream = localStreamRef.current;
      if (!stream) {
        const n = (offerRetryRef.current.get(callerId) ?? 0) + 1;
        if (n > 30) return;
        offerRetryRef.current.set(callerId, n);
        window.setTimeout(() => void handleOffer(data), 160);
        return;
      }
      offerRetryRef.current.delete(callerId);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const st: PeerState = { pc, remoteDescSet: false, iceBuffer: [] };
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          websocketService.sendICECandidate(conversationId, callerId, ev.candidate);
        }
      };

      pc.ontrack = () => {
        updateTiles();
      };

      peersRef.current.set(callerId, st);

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.encryptedOffer));
        await markRemote(callerId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        websocketService.sendCallAnswer(conversationId, callerId, answer);
        updateTiles();
      } catch (e) {
        console.error(e);
      }
    };

    const handleAnswer = async (data: {
      callerId?: string;
      calleeId?: string;
      conversationId?: string;
      encryptedAnswer?: RTCSessionDescriptionInit;
    }) => {
      if (data.callerId !== currentUserId || !data.encryptedAnswer || data.conversationId !== conversationId) return;
      const remotePeer = data.calleeId as string;
      const st = peersRef.current.get(remotePeer);
      if (!st) return;
      try {
        await st.pc.setRemoteDescription(new RTCSessionDescription(data.encryptedAnswer));
        await markRemote(remotePeer);
        updateTiles();
      } catch {
        /* ignore */
      }
    };

    const handleIce = async (data: { targetId?: string; candidate?: RTCIceCandidateInit; fromUserId?: string }) => {
      if (data.targetId !== currentUserId || !data.candidate || !data.fromUserId) return;
      const peerId = data.fromUserId;
      const st = peersRef.current.get(peerId);
      if (!st) return;
      if (!st.remoteDescSet) {
        st.iceBuffer.push(data.candidate);
        return;
      }
      try {
        await st.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        /* ignore */
      }
    };

    const handleSignal = (data: {
      targetId?: string;
      conversationId?: string;
      payload?: { kind?: string; muted?: boolean; callId?: string };
      fromUserId?: string;
    }) => {
      if (data.targetId !== currentUserId || data.conversationId !== conversationId) return;
      const inner = data.payload;
      if (inner?.callId && inner.callId !== callId) return;
      if (inner?.kind === 'mic' && data.fromUserId) {
        setRemoteMicMuted((prev) => ({ ...prev, [data.fromUserId!]: !!inner.muted }));
      }
    };

    websocketService.sendGroupVoiceJoin(conversationId, callId);
    setConnectedIds(new Set([currentUserId]));
    const uj = websocketService.onGroupVoiceJoin((p) => {
      if (p.conversationId !== conversationId || p.callId !== callId) return;
      setConnectedIds((prev) => {
        if (prev.has(p.userId)) return prev;
        const next = new Set(prev);
        next.add(p.userId);
        return next;
      });
    });
    const ul = websocketService.onGroupVoiceLeave((p) => {
      if (p.conversationId !== conversationId || p.callId !== callId) return;
      setConnectedIds((prev) => {
        if (!prev.has(p.userId)) return prev;
        const next = new Set(prev);
        next.delete(p.userId);
        return next;
      });
    });

    const u1 = websocketService.onCallOffer(handleOffer);
    const u2 = websocketService.onCallAnswer(handleAnswer);
    const u3 = websocketService.onICECandidate(handleIce);
    const u4 = websocketService.onCallSignal(handleSignal);
    const u5 = websocketService.onGroupCallEnd((p: { conversationId?: string; callId?: string }) => {
      if (p.conversationId === conversationId && p.callId === callId) onCloseRef.current();
    });
    const u6 = websocketService.onGroupCallKick((p: { conversationId?: string; callId?: string; targetId?: string }) => {
      if (p.conversationId === conversationId && p.callId === callId && p.targetId === currentUserId) {
        onCloseRef.current();
      }
    });

    return () => {
      websocketService.sendGroupVoiceLeave(conversationId, callId);
      uj();
      ul();
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  }, [callId, conversationId, currentUserId, markRemote, updateTiles]);

  useEffect(() => {
    const interval = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    tiles.forEach(({ id, stream }) => {
      if (id === currentUserId) return;
      const el = document.getElementById(`gc-audio-${id}`) as HTMLAudioElement | null;
      if (el && stream) {
        el.srcObject = stream;
        applyAudioOutput(el);
      }
    });
  }, [tiles, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const next = new Set<string>();
      const entries = [...peersRef.current.entries()];
      for (const [peerId, st] of entries) {
        const recv = st.pc.getReceivers().find((r) => r.track?.kind === 'audio' && r.track.enabled);
        if (!recv) continue;
        try {
          const stats = await recv.getStats();
          stats.forEach((rep) => {
            if (rep.type === 'inbound-rtp' && (rep as { kind?: string }).kind === 'audio') {
              const al = (rep as { audioLevel?: number }).audioLevel;
              if (typeof al === 'number' && !Number.isNaN(al) && al > 0.02) next.add(peerId);
            }
          });
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        setSpeakingRemote((prev) => {
          if (prev.size === next.size && [...prev].every((x) => next.has(x))) return prev;
          return next;
        });
      }
    };
    const id = window.setInterval(() => void poll(), 200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tiles.length, duration]);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream || isMuted) {
      setLocalSpeaking(false);
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    let src: MediaStreamAudioSourceNode;
    try {
      src = ctx.createMediaStreamSource(stream);
    } catch {
      void ctx.close();
      return;
    }
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.5;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    const loop = () => {
      an.getByteFrequencyData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i];
      setLocalSpeaking(s / data.length > 10);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      an.disconnect();
      void ctx.close();
    };
  }, [isMuted, tiles.length]);

  useEffect(() => {
    if (!tileCtx) return;
    const close = (e: MouseEvent) => {
      if (tileMenuRef.current?.contains(e.target as Node)) return;
      setTileCtx(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tileCtx]);

  const isSpeaking = useCallback(
    (userId: string) => {
      if (userId === currentUserId) return localSpeaking && !isMuted;
      return speakingRemote.has(userId);
    },
    [currentUserId, localSpeaking, isMuted, speakingRemote]
  );

  const broadcastMic = (muted: boolean) => {
    peersRef.current.forEach((_, peerId) => {
      websocketService.sendCallSignal(conversationId, peerId, { kind: 'mic', muted, callId });
    });
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audio = stream.getAudioTracks()[0];
    if (audio) {
      const next = !audio.enabled;
      audio.enabled = next;
      setIsMuted(!next);
      broadcastMic(!next);
    }
  };

  const toggleScreen = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setScreenStreamForUi(null);
      peersRef.current.forEach((st) => {
        const sender = st.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          void sender.replaceTrack(null);
          try {
            st.pc.removeTrack(sender);
          } catch {
            /* ignore */
          }
        }
      });
      // Renegotiate so peers remove the screen track on their side.
      peersRef.current.forEach((st, remoteId) => {
        void (async () => {
          try {
            const offer = await st.pc.createOffer();
            await st.pc.setLocalDescription(offer);
            websocketService.sendCallOffer(conversationId, remoteId, offer, false, {
              groupCallId: callId,
              memberIds: sortedMembers,
            });
          } catch {
            /* ignore */
          }
        })();
      });
      setIsScreenSharing(false);
      updateTiles();
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const vt = screen.getVideoTracks()[0];
      if (!vt) return;
      screenStreamRef.current = screen;
      setScreenStreamForUi(screen);
      vt.onended = () => void toggleScreen();
      peersRef.current.forEach((st) => {
        const sender = st.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          void sender.replaceTrack(vt);
        } else {
          st.pc.addTrack(vt, screen);
        }
      });
      // Renegotiate so peers receive the new screen track.
      peersRef.current.forEach((st, remoteId) => {
        void (async () => {
          try {
            const offer = await st.pc.createOffer();
            await st.pc.setLocalDescription(offer);
            websocketService.sendCallOffer(conversationId, remoteId, offer, true, {
              groupCallId: callId,
              memberIds: sortedMembers,
            });
          } catch {
            /* ignore */
          }
        })();
      });
      setIsScreenSharing(true);
      updateTiles();
    } catch {
      /* cancelled */
    }
  };

  const kick = (targetId: string) => {
    if (!canKick || targetId === currentUserId) return;
    websocketService.sendGroupCallKick(conversationId, callId, targetId);
  };

  const endAll = () => {
    if (canKick) {
      websocketService.sendGroupCallEnd(conversationId, callId);
    }
    onCloseRef.current();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleFocusScreen = () => {
    setFocus((f) => (f?.kind === 'screen' ? null : { kind: 'screen' }));
  };

  const toggleFocusUser = (id: string) => {
    setFocus((f) => (f?.kind === 'user' && f.id === id ? null : { kind: 'user', id }));
  };

  const unifiedGridStyle = useMemo((): React.CSSProperties => {
    const n = visibleMembers.length + (showScreenCell ? 1 : 0);
    if (n <= 1) return { ['--gc-cols' as string]: 1 };
    if (n === 2) return { ['--gc-cols' as string]: 2 };
    if (n === 3) return { ['--gc-cols' as string]: 3 };
    if (n === 4) return { ['--gc-cols' as string]: 2 };
    if (n <= 6) return { ['--gc-cols' as string]: 3 };
    if (n <= 9) return { ['--gc-cols' as string]: 3 };
    return { ['--gc-cols' as string]: 5 };
  }, [visibleMembers.length, showScreenCell]);

  const onTileContextMenu = (e: React.MouseEvent, userId: string) => {
    e.preventDefault();
    if (!canKick || userId === currentUserId) return;
    setTileCtx({ x: e.clientX, y: e.clientY, userId });
  };

  const renderParticipantInner = (userId: string, compact: boolean) => {
    const name = displayName(userId);
    const avatarUrl = avatarUrlFor?.(userId);
    const isLocal = userId === currentUserId;
    const stream = isLocal ? null : getRemoteStream(userId);
    const cam = isLocal ? null : cameraOnlyStream(stream);
    const mutedMic = isLocal ? isMuted : !!remoteMicMuted[userId];
    const speaking = isSpeaking(userId);

    return (
      <>
        {cam ? (
          <GcVideo stream={cam} muted={false} className="gc-tile-video" />
        ) : (
          <AvatarBubble label={name} avatarUrl={avatarUrl} className={`gc-cell-avatar ${compact ? 'gc-cell-avatar--sm' : ''}`} />
        )}
        <span className="gc-cell-name">{name}</span>
        {mutedMic ? (
          <span className="gc-cell-mic-off" title={t('call.mute')}>
            <IconMicOff width={14} height={14} />
          </span>
        ) : null}
        {speaking && !compact ? <span className="gc-cell-speaking-halo" aria-hidden /> : null}
      </>
    );
  };

  const renderFocusMain = () => {
    if (!focus) return null;
    if (focus.kind === 'screen' && screenDisplayStream) {
      return (
        <button type="button" className="gc-focus-main-inner gc-focus-main-inner--video gc-focus-center" onClick={toggleFocusScreen}>
          <GcVideo stream={screenDisplayStream} muted className="gc-focus-video" />
        </button>
      );
    }
    if (focus.kind === 'user') {
      const uid = focus.id;
      const name = displayName(uid);
      const avatarUrl = avatarUrlFor?.(uid);
      const stream = getRemoteStream(uid);
      const cam = cameraOnlyStream(stream);
      if (cam) {
        return (
          <button type="button" className="gc-focus-main-inner gc-focus-main-inner--video gc-focus-center" onClick={() => toggleFocusUser(uid)}>
            <GcVideo stream={cam} className="gc-focus-video" />
          </button>
        );
      }
      return (
        <button type="button" className="gc-focus-main-inner gc-focus-main-inner--avatar gc-focus-center" onClick={() => toggleFocusUser(uid)}>
          <AvatarBubble label={name} avatarUrl={avatarUrl} className="gc-focus-avatar" />
          <span className="gc-focus-name">{name}</span>
        </button>
      );
    }
    return null;
  };

  const renderStrip = () => {
    if (!focus) return null;
    const items: React.ReactNode[] = [];
    if (showScreenCell && focus.kind !== 'screen') {
      items.push(
        <button
          key="strip-screen"
          type="button"
          className="gc-strip-tile"
          onClick={toggleFocusScreen}
        >
          <GcVideo stream={screenDisplayStream} muted className="gc-strip-video" />
          <span>{t('call.screen')}</span>
        </button>
      );
    }
    visibleMembers.forEach((uid) => {
      if (focus.kind === 'user' && focus.id === uid) return;
      items.push(
        <button
          key={uid}
          type="button"
          className={`gc-strip-tile${isSpeaking(uid) ? ' gc-strip-tile--speaking' : ''}`}
          onClick={() => toggleFocusUser(uid)}
        >
          {renderParticipantInner(uid, true)}
        </button>
      );
    });
    return <div className="gc-focus-strip">{items}</div>;
  };

  return (
    <div className={`call-window group-call-window ${screenExpanded ? 'group-call-window--expanded' : ''}`}>
      <div className="call-window-top">
        <span className="call-window-name">{fmt('call.groupTitle', { duration: formatDuration(duration) })}</span>
        <span className="call-window-status">
          {fmt('call.inVoice', { count: connectedIds.size, members: membersLabel(sortedMembers.length) })}
          {overflowCount > 0 ? fmt('call.showing', { shown: visibleMembers.length, members: sortedMembers.length }) : ''}
        </span>
      </div>

      <div className={`group-call-main video-container gc-stage${focus ? ' gc-stage--focus' : ''}`}>
        {focus ? (
          <>
            <div className="gc-focus-stage">{renderFocusMain()}</div>
            {renderStrip()}
          </>
        ) : (
          <div className="gc-unified-grid" style={unifiedGridStyle}>
            {showScreenCell ? (
              <button
                type="button"
                className="gc-cell gc-cell--tile gc-cell--screen-tile"
                onClick={toggleFocusScreen}
                onContextMenu={(e) => e.preventDefault()}
              >
                <GcVideo stream={screenDisplayStream} muted className="gc-tile-video" />
                <span className="gc-cell-name">{t('call.screen')}</span>
              </button>
            ) : null}
            {visibleMembers.map((uid) => (
              <button
                key={uid}
                type="button"
                className={`gc-cell gc-cell--tile gc-cell--user ${isSpeaking(uid) ? 'gc-cell--speaking' : ''}`}
                onClick={() => toggleFocusUser(uid)}
                onContextMenu={(e) => onTileContextMenu(e, uid)}
              >
                {renderParticipantInner(uid, false)}
              </button>
            ))}
          </div>
        )}

        {showScreenCell ? (
          <div className="group-call-expand-zone">
            <button
              type="button"
              className="group-call-expand-btn"
              title={t('call.fullScreen')}
              aria-label={t('call.fullScreen')}
              onClick={() => setScreenExpanded((e) => !e)}
            >
              <span aria-hidden>⛶</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="gc-hidden-audio" aria-hidden>
        {sortedMembers
          .filter((id) => id !== currentUserId)
          .map((id) => (
            <audio key={id} id={`gc-audio-${id}`} autoPlay playsInline className="group-call-hidden-audio" />
          ))}
      </div>

      {tileCtx &&
        createPortal(
          <div
            ref={tileMenuRef}
            className="sf-msg-ctx-menu gc-tile-ctx-menu"
            role="menu"
            style={{ left: tileCtx.x, top: tileCtx.y }}
          >
            <button
              type="button"
              className="sf-msg-ctx-item sf-msg-ctx-item--danger"
              role="menuitem"
              onClick={() => {
                kick(tileCtx.userId);
                setTileCtx(null);
              }}
            >
              {t('call.expel')}
            </button>
          </div>,
          document.body
        )}

      <div className="call-controls">
        <button
          type="button"
          onClick={toggleMute}
          className={isMuted ? 'active' : ''}
          title={t('call.mute')}
          aria-label={t('call.mute')}
        >
          <span className="call-ctrl-icon">
            {isMuted ? <IconMicOff width={22} height={22} /> : <IconMic width={22} height={22} />}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void toggleScreen()}
          className={isScreenSharing ? 'active' : ''}
          title={t('call.shareScreen')}
          aria-label={t('call.shareScreen')}
        >
          <span className="call-ctrl-icon">
            <IconScreenShare width={22} height={22} />
          </span>
        </button>
        <button type="button" onClick={endAll} className="end-call" title={t('call.leave')} aria-label={t('call.leave')}>
          <IconPhoneHangup width={22} height={22} />
        </button>
      </div>
    </div>
  );
};

export default GroupCallWindow;
