import axios from 'axios';
import { User } from '../types';

const getApiUrl = () => {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080/api`;
  }
  return 'http://localhost:8080/api';
};
const API_URL = getApiUrl();

class AuthService {
  private token: string | null = null;
  private refreshToken: string | null = null;

  /** Call on app load so API calls work after refresh. */
  restoreSession(): void {
    const access = localStorage.getItem('accessToken');
    const refresh = localStorage.getItem('refreshToken');
    if (access) {
      this.token = access;
      this.refreshToken = refresh;
      axios.defaults.headers.common['Authorization'] = `Bearer ${access}`;
    }
  }

  async register(username: string, email: string, password: string, publicKey: string): Promise<User> {
    const response = await axios.post(`${API_URL}/auth/register`, {
      username,
      email,
      password,
      publicKey
    });
    return response.data;
  }

  async login(email: string, password: string): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const response = await axios.post(`${API_URL}/auth/login`, { email, password });
    const { accessToken, refreshToken, user } = response.data;
    this.setTokens(accessToken, refreshToken);
    localStorage.setItem('sirius_user', JSON.stringify(user));
    return { user, accessToken, refreshToken };
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.token = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
  }

  getToken(): string | null {
    return this.token || localStorage.getItem('accessToken');
  }

  async refreshAccessToken(): Promise<string> {
    const refresh = this.refreshToken || localStorage.getItem('refreshToken');
    const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken: refresh });
    const { accessToken } = response.data;
    this.setTokens(accessToken, refresh!);
    return accessToken;
  }

  logout() {
    this.token = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('sirius_user');
    delete axios.defaults.headers.common['Authorization'];
  }

  isLoggedIn(): boolean {
    return !!(this.token || localStorage.getItem('accessToken'));
  }

  async updateProfile(updates: { username?: string; avatar?: string | null }): Promise<User> {
    const body: { username?: string; avatar?: string | null } = {};
    if (updates.username !== undefined) body.username = updates.username;
    if (updates.avatar !== undefined) body.avatar = updates.avatar;
    const { data } = await axios.patch<User>(`${API_URL}/users/me`, body, { headers: authHeader() });
    localStorage.setItem('sirius_user', JSON.stringify(data));
    return data;
  }
}

function authHeader() {
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const authService = new AuthService();