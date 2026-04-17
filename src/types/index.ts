export interface User {
  id: string;
  username: string;
  discriminator: string;
  email: string;
  avatar?: string;
  online: boolean;
  lastSeen: string;
  publicKey: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  encryptedContent: string;
  iv: string;
  senderKey: string;
  messageType: 'text' | 'image' | 'file' | 'call' | 'voice' | 'sticker';
  createdAt: string;
  sender?: User;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name?: string;
  avatar?: string;
  participants: User[];
  lastMessage?: Message;
  updatedAt: string;
  /** Server-synced clear-history time for the current user (RFC3339). */
  myClearedAt?: string;
}

export interface Group {
  id: string;
  name: string;
  avatar?: string;
  description: string;
  ownerId: string;
  members: GroupMember[];
}

export interface GroupMember {
  userId: string;
  role: 'admin' | 'member';
  user?: User;
}

export interface CallSession {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  isVideo: boolean;
  status: 'initiated' | 'connected' | 'ended';
}

export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  createdAt: string;
  updatedAt: string;
  sender?: User;
  receiver?: User;
}