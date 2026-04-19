import { Message } from '../types';

type MessageHandler = (message: Message) => void;
type TypingHandler = (data: { conversationId: string; userId: string; isTyping: boolean }) => void;
type CallHandler = (data: any) => void;
type MessageDeletedPayload = { id: string; conversationId: string };
type GroupVoicePresencePayload = { conversationId: string; callId: string; userId: string };

function removeHandler<T>(list: T[], fn: T) {
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private allowReconnect = false;
  private messageHandlers: MessageHandler[] = [];
  private typingHandlers: TypingHandler[] = [];
  private callOfferHandlers: CallHandler[] = [];
  private callAnswerHandlers: CallHandler[] = [];
  private iceCandidateHandlers: CallHandler[] = [];
  private messageUpdatedHandlers: MessageHandler[] = [];
  private messageDeletedHandlers: ((p: MessageDeletedPayload) => void)[] = [];
  private groupCallInviteHandlers: CallHandler[] = [];
  private groupCallEndHandlers: CallHandler[] = [];
  private groupCallKickHandlers: CallHandler[] = [];
  private groupVoiceJoinHandlers: ((p: GroupVoicePresencePayload) => void)[] = [];
  private groupVoiceLeaveHandlers: ((p: GroupVoicePresencePayload) => void)[] = [];
  private callSignalHandlers: CallHandler[] = [];
  private friendsUpdatedHandlers: (() => void)[] = [];

  disconnect() {
    this.allowReconnect = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  connect(token: string) {
    this.disconnect();
    this.allowReconnect = true;
    let base: string;
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      base = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8080`;
    } else {
      base = 'ws://localhost:8080';
    }
    // this.ws = new WebSocket(`${base.replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}`);
    // Вернуться к URL, но исправить бэкенд
    
    this.ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      if (!this.allowReconnect) return;
      setTimeout(() => this.connect(token), 3000);
    };
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'message':
        this.messageHandlers.forEach((handler) => handler(data.payload));
        break;
      case 'typing':
        this.typingHandlers.forEach((handler) => handler(data.payload));
        break;
      case 'call-offer':
        this.callOfferHandlers.slice().forEach((handler) =>
          handler({ ...data.payload, callerId: data.senderId })
        );
        break;
      case 'call-answer':
        this.callAnswerHandlers.slice().forEach((handler) =>
          handler({ ...data.payload, calleeId: data.senderId })
        );
        break;
      case 'ice-candidate':
        this.iceCandidateHandlers.slice().forEach((handler) =>
          handler({ ...data.payload, fromUserId: data.senderId })
        );
        break;
      case 'message-updated':
        this.messageUpdatedHandlers.forEach((handler) => handler(data.payload as Message));
        break;
      case 'message-deleted':
        this.messageDeletedHandlers.forEach((handler) => handler(data.payload as MessageDeletedPayload));
        break;
      case 'group-call-invite':
        this.groupCallInviteHandlers.forEach((handler) =>
          handler({ ...(data.payload as object), fromUserId: data.senderId })
        );
        break;
      case 'group-call-end':
        this.groupCallEndHandlers.forEach((handler) => handler(data.payload));
        break;
      case 'group-call-kick':
        this.groupCallKickHandlers.forEach((handler) =>
          handler({ ...(data.payload as object), fromUserId: data.senderId })
        );
        break;
      case 'group-voice-join':
        this.groupVoiceJoinHandlers.forEach((h) => h(data.payload as GroupVoicePresencePayload));
        break;
      case 'group-voice-leave':
        this.groupVoiceLeaveHandlers.forEach((h) => h(data.payload as GroupVoicePresencePayload));
        break;
      case 'call-signal':
        this.callSignalHandlers.forEach((handler) =>
          handler({ ...(data.payload as object), fromUserId: data.senderId })
        );
        break;
      case 'friends-updated':
        this.friendsUpdatedHandlers.forEach((handler) => handler());
        break;
    }
  }

  sendMessage(message: any) {
    this.send({
      type: 'message',
      data: message,
    });
  }

  sendTyping(conversationId: string, isTyping: boolean) {
    this.send({
      type: 'typing',
      data: { conversationId, isTyping },
    });
  }

  sendCallOffer(
    conversationId: string,
    calleeId: string,
    offer: RTCSessionDescriptionInit,
    isVideo: boolean,
    meta?: { groupCallId?: string; memberIds?: string[] }
  ) {
    const data: Record<string, unknown> = {
      conversationId,
      calleeId,
      encryptedOffer: offer,
      isVideo,
    };
    if (meta?.groupCallId) data.groupCallId = meta.groupCallId;
    if (meta?.memberIds) data.memberIds = meta.memberIds;
    this.send({
      type: 'call-offer',
      data,
    });
  }

  sendGroupCallInvite(conversationId: string, callId: string, memberIds: string[]) {
    this.send({
      type: 'group-call-invite',
      data: { conversationId, callId, memberIds },
    });
  }

  sendGroupCallEnd(conversationId: string, callId: string) {
    this.send({
      type: 'group-call-end',
      data: { conversationId, callId },
    });
  }

  sendGroupCallKick(conversationId: string, callId: string, targetId: string) {
    this.send({
      type: 'group-call-kick',
      data: { conversationId, callId, targetId },
    });
  }

  sendGroupVoiceJoin(conversationId: string, callId: string) {
    this.send({
      type: 'group-voice-join',
      data: { conversationId, callId },
    });
  }

  sendGroupVoiceLeave(conversationId: string, callId: string) {
    this.send({
      type: 'group-voice-leave',
      data: { conversationId, callId },
    });
  }

  sendCallSignal(conversationId: string, targetId: string, payload: Record<string, unknown>) {
    this.send({
      type: 'call-signal',
      data: { conversationId, targetId, payload },
    });
  }

  sendCallAnswer(conversationId: string, callerId: string, answer: RTCSessionDescriptionInit) {
    this.send({
      type: 'call-answer',
      data: { conversationId, callerId, encryptedAnswer: answer },
    });
  }

  sendICECandidate(conversationId: string, targetId: string, candidate: RTCIceCandidate) {
    this.send({
      type: 'ice-candidate',
      data: { conversationId, targetId, candidate },
    });
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => removeHandler(this.messageHandlers, handler);
  }

  offMessage() {
    this.messageHandlers = [];
  }

  onTyping(handler: TypingHandler) {
    this.typingHandlers.push(handler);
  }

  offTyping() {
    this.typingHandlers = [];
  }

  /** Returns unsubscribe so StrictMode / re-mount does not wipe other listeners. */
  onCallOffer(handler: CallHandler): () => void {
    this.callOfferHandlers.push(handler);
    return () => removeHandler(this.callOfferHandlers, handler);
  }

  onCallAnswer(handler: CallHandler): () => void {
    this.callAnswerHandlers.push(handler);
    return () => removeHandler(this.callAnswerHandlers, handler);
  }

  onICECandidate(handler: CallHandler): () => void {
    this.iceCandidateHandlers.push(handler);
    return () => removeHandler(this.iceCandidateHandlers, handler);
  }

  offCallOffer() {
    this.callOfferHandlers = [];
  }

  offCallAnswer() {
    this.callAnswerHandlers = [];
  }

  offICECandidate() {
    this.iceCandidateHandlers = [];
  }

  /** Returns unsubscribe so StrictMode / re-mount does not wipe other listeners. */
  onMessageUpdated(handler: MessageHandler): () => void {
    this.messageUpdatedHandlers.push(handler);
    return () => {
      const i = this.messageUpdatedHandlers.indexOf(handler);
      if (i >= 0) this.messageUpdatedHandlers.splice(i, 1);
    };
  }

  offMessageUpdated() {
    this.messageUpdatedHandlers = [];
  }

  onMessageDeleted(handler: (p: MessageDeletedPayload) => void): () => void {
    this.messageDeletedHandlers.push(handler);
    return () => {
      const i = this.messageDeletedHandlers.indexOf(handler);
      if (i >= 0) this.messageDeletedHandlers.splice(i, 1);
    };
  }

  offMessageDeleted() {
    this.messageDeletedHandlers = [];
  }

  onGroupCallInvite(handler: CallHandler): () => void {
    this.groupCallInviteHandlers.push(handler);
    return () => removeHandler(this.groupCallInviteHandlers, handler);
  }

  onGroupCallEnd(handler: CallHandler): () => void {
    this.groupCallEndHandlers.push(handler);
    return () => removeHandler(this.groupCallEndHandlers, handler);
  }

  onGroupCallKick(handler: CallHandler): () => void {
    this.groupCallKickHandlers.push(handler);
    return () => removeHandler(this.groupCallKickHandlers, handler);
  }

  onGroupVoiceJoin(handler: (p: GroupVoicePresencePayload) => void): () => void {
    this.groupVoiceJoinHandlers.push(handler);
    return () => removeHandler(this.groupVoiceJoinHandlers, handler);
  }

  onGroupVoiceLeave(handler: (p: GroupVoicePresencePayload) => void): () => void {
    this.groupVoiceLeaveHandlers.push(handler);
    return () => removeHandler(this.groupVoiceLeaveHandlers, handler);
  }

  onCallSignal(handler: CallHandler): () => void {
    this.callSignalHandlers.push(handler);
    return () => removeHandler(this.callSignalHandlers, handler);
  }

  onFriendsUpdated(handler: () => void): () => void {
    this.friendsUpdatedHandlers.push(handler);
    return () => removeHandler(this.friendsUpdatedHandlers, handler);
  }
}

export const websocketService = new WebSocketService();
