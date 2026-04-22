import axios from 'axios';
import { Conversation, Message, User, FriendRequest } from '../types';
import { authService } from './auth';

const getApiUrl = () => {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080/api`;
  }
  return 'http://localhost:8080/api';
};
const API_URL = getApiUrl();
export { API_URL };

function authHeader() {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const messageService = {
  async getUsers(): Promise<User[]> {
    const { data } = await axios.get<User[]>(`${API_URL}/users`, { headers: authHeader() });
    return data;
  },

  async getFriends(): Promise<User[]> {
    const { data } = await axios.get<User[]>(`${API_URL}/friends`, { headers: authHeader() });
    return data;
  },

  async removeFriend(userId: string): Promise<void> {
    await axios.delete(`${API_URL}/friends/${userId}`, { headers: authHeader() });
  },

  async blockUser(userId: string): Promise<void> {
    await axios.post(`${API_URL}/users/${userId}/block`, {}, { headers: authHeader() });
  },

  async unblockUser(userId: string): Promise<void> {
    await axios.delete(`${API_URL}/users/${userId}/block`, { headers: authHeader() });
  },

  async getFriendRequests(): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    const { data } = await axios.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
      `${API_URL}/friend-requests`,
      { headers: authHeader() }
    );
    return data;
  },

  async sendFriendRequest(query: string): Promise<FriendRequest> {
    const { data } = await axios.post<FriendRequest>(
      `${API_URL}/friend-requests`,
      { query },
      { headers: authHeader() }
    );
    return data;
  },

  async acceptFriendRequest(requestId: string): Promise<void> {
    await axios.post(
      `${API_URL}/friend-requests/${requestId}/accept`,
      {},
      { headers: authHeader() }
    );
  },

  async declineFriendRequest(requestId: string): Promise<void> {
    await axios.post(
      `${API_URL}/friend-requests/${requestId}/decline`,
      {},
      { headers: authHeader() }
    );
  },

  async cancelFriendRequest(requestId: string): Promise<void> {
    await axios.post(
      `${API_URL}/friend-requests/${requestId}/cancel`,
      {},
      { headers: authHeader() }
    );
  },

  async getConversations(): Promise<Conversation[]> {
    const { data } = await axios.get<Conversation[]>(`${API_URL}/conversations`, {
      headers: authHeader(),
    });
    return data;
  },

  async createConversation(participantIds: string[], isGroup = false, name = ''): Promise<Conversation> {
    const { data } = await axios.post<Conversation>(
      `${API_URL}/conversations`,
      { participantIds, isGroup, name },
      { headers: authHeader() }
    );
    return data;
  },

  async getMessages(conversationId: string, limit: number, offset: number): Promise<Message[]> {
    const { data } = await axios.get<Message[]>(
      `${API_URL}/messages/${conversationId}`,
      { params: { limit, offset }, headers: authHeader() }
    );
    return data;
  },

  async sendMessage(
    conversationId: string,
    encryptedContent: string,
    iv: string,
    senderKey: string,
    messageType?: Message['messageType']
  ): Promise<Message> {
    const body: Record<string, unknown> = { conversationId, encryptedContent, iv, senderKey };
    if (messageType) body.messageType = messageType;
    const { data } = await axios.post<Message>(`${API_URL}/messages`, body, { headers: authHeader() });
    return data;
  },

  async uploadFile(
    file: File,
    conversationId: string,
    onProgress?: (progress01: number) => void
  ): Promise<{ id: string; name: string; mime: string; size: number; fileLink: string }> {
    const form = new FormData();
    form.append('file', file);
    form.append('conversationId', conversationId);
    const { data } = await axios.post<{ id: string; name: string; mime: string; size: number; fileLink: string }>(
      `${API_URL}/messages/upload`,
      form,
      {
        headers: authHeader(),
        onUploadProgress: (ev) => {
          if (!onProgress) return;
          const total = typeof ev.total === 'number' && ev.total > 0 ? ev.total : file.size;
          if (!total || total <= 0) return;
          const p = Math.max(0, Math.min(1, (ev.loaded || 0) / total));
          onProgress(p);
        },
      }
    );
    return data;
  },

  async updateMessage(
    conversationId: string,
    messageId: string,
    encryptedContent: string,
    iv: string,
    senderKey: string,
    messageType?: Message['messageType']
  ): Promise<Message> {
    const body: Record<string, unknown> = { encryptedContent, iv, senderKey };
    if (messageType) body.messageType = messageType;
    const { data } = await axios.patch<Message>(
      `${API_URL}/conversations/${conversationId}/messages/${messageId}`,
      body,
      { headers: authHeader() }
    );
    return data;
  },

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await axios.delete(`${API_URL}/conversations/${conversationId}/messages/${messageId}`, {
      headers: authHeader(),
    });
  },

  async addGroupParticipants(conversationId: string, userIds: string[]): Promise<Conversation> {
    const { data } = await axios.post<Conversation>(
      `${API_URL}/conversations/${conversationId}/participants`,
      { userIds },
      { headers: authHeader() }
    );
    return data;
  },

  async updateGroupConversation(
    conversationId: string,
    updates: { name?: string; avatar?: string | null }
  ): Promise<Conversation> {
    const body: { name?: string; avatar?: string | null } = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.avatar !== undefined) body.avatar = updates.avatar;
    const { data } = await axios.patch<Conversation>(
      `${API_URL}/conversations/${conversationId}`,
      body,
      { headers: authHeader() }
    );
    return data;
  },

  async removeGroupParticipant(conversationId: string, userId: string): Promise<void> {
    await axios.delete(`${API_URL}/conversations/${conversationId}/participants/${userId}`, {
      headers: authHeader(),
    });
  },

  async clearConversationHistory(conversationId: string): Promise<void> {
    await axios.post(
      `${API_URL}/conversations/${conversationId}/clear-history`,
      {},
      { headers: authHeader() }
    );
  },
};
