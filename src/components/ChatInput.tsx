import React, { useState, useRef, useEffect } from 'react';
import { IconFile, IconSmile, IconSend, IconMic } from './icons';
import { audioInputConstraints, getStoredMicInputVolume } from '../utils/callMediaPrefs';
import { t } from '../utils/i18n';

const STICKERS = ['👋', '😀', '❤️', '🔥', '👍', '🎉', '😎', '✨', '🙏'];

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onSendVoice?: (blob: Blob, mimeType: string) => void;
  onSendFile?: (file: File) => void;
  onSendSticker?: (char: string) => void;
  onTyping: (typing: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
  replyPreview?: {
    snippet: string;
    kind?: 'text' | 'image' | 'video' | 'gif' | 'voice' | 'file' | 'sticker';
    mime?: string;
    thumbB64?: string;
  } | null;
  onReplyPreviewClick?: () => void;
  onReplyCancel?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onSendVoice,
  onSendFile,
  onSendSticker,
  onTyping,
  disabled,
  disabledHint,
  replyPreview,
  onReplyPreviewClick,
  onReplyCancel,
}) => {
  const [value, setValue] = useState('');
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const rawRecordStreamRef = useRef<MediaStream | null>(null);
  const recordAudioCtxRef = useRef<AudioContext | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickerPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      stopRecordingCleanup();
      if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  useEffect(() => {
    if (!stickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (stickerPopoverRef.current?.contains(node)) return;
      setStickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [stickerOpen]);

  const stopRecordingCleanup = () => {
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    rawRecordStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawRecordStreamRef.current = null;
    if (recordAudioCtxRef.current) {
      void recordAudioCtxRef.current.close();
      recordAudioCtxRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordChunksRef.current = [];
  };

  const scheduleTypingEnd = () => {
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 2000);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    if (!disabled) {
      onTyping(true);
      scheduleTypingEnd();
    }
  };

  const submit = () => {
    if (disabled) return;
    const text = value.trim();
    if (!text && !pendingImage) return;
    if (pendingImage && onSendFile) {
      onSendFile(pendingImage.file);
      if (text) onSendMessage(text);
      URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage(null);
      setValue('');
      onTyping(false);
      return;
    }
    if (!text) return;
    onSendMessage(text);
    setValue('');
    onTyping(false);
  };

  const toggleRecord = async () => {
    if (disabled || !onSendVoice) return;
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const audio = audioInputConstraints();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: typeof audio === 'object' ? { ...audio } : true,
      });
      rawRecordStreamRef.current = stream;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const gain = audioCtx.createGain();
      gain.gain.value = getStoredMicInputVolume();
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      recordAudioCtxRef.current = audioCtx;
      recordStreamRef.current = destination.stream;
      recordChunksRef.current = [];
      const mime =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(destination.stream, { mimeType: mime });
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: mr.mimeType });
        stopRecordingCleanup();
        if (blob.size > 0) onSendVoice(blob, mr.mimeType);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setRecording(false);
      stopRecordingCleanup();
      alert(t('call.micPermissionRequired'));
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list?.length || disabled || !onSendFile) return;
    if (list.length === 1 && list[0].type.startsWith('image/')) {
      if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage({ file: list[0], previewUrl: URL.createObjectURL(list[0]) });
      return;
    }
    void (async () => {
      for (let i = 0; i < list.length; i++) {
        await onSendFile(list[i]);
      }
    })();
  };

  const pickSticker = (ch: string) => {
    if (disabled || !onSendSticker) return;
    onSendSticker(ch);
    setStickerOpen(false);
  };

  return (
    <div className="sf-input-bar">
      {disabled && disabledHint && <p className="sf-input-hint">{disabledHint}</p>}
      {replyPreview ? (
        <div className="sf-input-reply-preview">
          <button type="button" className="sf-input-reply-preview-main" onClick={onReplyPreviewClick}>
            <span className="sf-input-reply-preview-text">{replyPreview.snippet}</span>
            {replyPreview.kind && (replyPreview.kind === 'image' || replyPreview.kind === 'gif') && replyPreview.mime && replyPreview.thumbB64 ? (
              <span className="sf-input-reply-preview-thumb" aria-hidden>
                <img alt="" src={`data:${replyPreview.mime};base64,${replyPreview.thumbB64}`} />
              </span>
            ) : null}
          </button>
          <button type="button" className="sf-btn sf-btn--ghost sf-btn--small" onClick={onReplyCancel}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      {pendingImage ? (
        <div className="sf-input-media-preview">
          <img src={pendingImage.previewUrl} alt={pendingImage.file.name} className="sf-input-media-preview-img" />
          <button
            type="button"
            className="sf-btn sf-btn--ghost sf-btn--small"
            onClick={() => {
              URL.revokeObjectURL(pendingImage.previewUrl);
              setPendingImage(null);
            }}
          >
            {t('common.remove')}
          </button>
        </div>
      ) : null}
      <div className="sf-input-row">
        <input
          ref={fileRef}
          type="file"
          className="sf-file-input"
          tabIndex={-1}
          multiple
          onChange={onFileChange}
        />
        <button
          type="button"
          className="sf-input-attach sf-input-attach--file"
          title={t('input.attachFile')}
          disabled={disabled || !onSendFile}
          aria-label={t('input.attachFile')}
          onClick={() => fileRef.current?.click()}
        >
          <IconFile width={20} height={20} />
        </button>
        <form
          className="sf-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="sf-input-wrap">
            <textarea
              className="sf-input-field"
              rows={1}
              value={value}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={disabled ? t('input.unavailable') : t('input.placeholder')}
              disabled={disabled}
            />
            {stickerOpen && onSendSticker ? (
              <div ref={stickerPopoverRef} className="sf-sticker-popover" aria-label={t('sticker.title')}>
                {STICKERS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    className="sf-sticker-chip"
                    onClick={() => pickSticker(ch)}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="sf-input-emoji"
              title={t('sticker.title')}
              disabled={disabled || !onSendSticker}
              aria-label={t('sticker.title')}
              aria-expanded={stickerOpen}
              onClick={() => !disabled && onSendSticker && setStickerOpen((o) => !o)}
            >
              <IconSmile width={20} height={20} />
            </button>
          </div>
          <button
            type="submit"
            className="sf-send-btn"
            disabled={disabled || (!value.trim() && !pendingImage)}
            aria-label={t('input.sendMessage')}
          >
            <IconSend width={20} height={20} />
          </button>
        </form>
        <button
          type="button"
          className={`sf-input-attach sf-input-attach--mic${recording ? ' sf-input-attach--rec' : ''}`}
          title={recording ? t('input.stopAndSendRecording') : t('input.recordVoice')}
          disabled={disabled || !onSendVoice}
          aria-label={recording ? t('input.stopRecording') : t('input.recordVoice')}
          onClick={() => void toggleRecord()}
        >
          <IconMic width={20} height={20} />
        </button>
      </div>
    </div>
  );
};

export default ChatInput;
