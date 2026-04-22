import axios from 'axios';
import { User } from '../types';
import { cryptoService } from './crypto';

const getApiUrl = () => {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080/api`;
  }
  return 'http://localhost:8080/api';
};
const API_URL = getApiUrl();

// Флаг для предотвращения множественных запросов на обновление токена
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

class AuthService {
  private token: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    // Настраиваем перехватчик ответов для автоматического обновления токена
    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        // Если ошибка не 401 или запрос уже повторялся - пропускаем
        if (error.response?.status !== 401 || originalRequest._retry) {
          return Promise.reject(error);
        }

        // Если это запрос на обновление токена и он вернул 401 - разлогиниваем
        if (originalRequest.url?.includes('/auth/refresh')) {
          this.logout();
          window.location.href = '/';
          return Promise.reject(error);
        }

        if (isRefreshing) {
          // Если уже идет обновление токена, ставим запрос в очередь
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then(token => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return axios(originalRequest);
          }).catch(err => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const newToken = await this.refreshAccessToken();
          
          // Обновляем заголовок для текущего запроса
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          
          // Обрабатываем очередь
          processQueue(null, newToken);
          
          // Повторяем оригинальный запрос
          return axios(originalRequest);
        } catch (refreshError) {
          // Если не удалось обновить токен - разлогиниваем
          processQueue(refreshError as Error, null);
          this.logout();
          
          // Показываем сообщение пользователю
          // if (typeof window !== 'undefined') {
          //   alert('Ваша сессия истекла. Пожалуйста, войдите снова.');
          //   window.location.href = '/';
          // }
          
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }
    );
  }

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

  async register(username: string, email: string, password: string, publicKey: string, privateKeyPem?: string): Promise<User> {
    const privateKeyEncrypted = privateKeyPem
      ? await cryptoService.encryptPrivateKeyForBackup(privateKeyPem, password)
      : undefined;
    const response = await axios.post(`${API_URL}/auth/register`, {
      username,
      email,
      password,
      publicKey,
      privateKeyEncrypted,
    });
    return response.data;
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: User; accessToken: string; refreshToken: string; privateKeyEncrypted?: string }> {
    const response = await axios.post(`${API_URL}/auth/login`, { email, password });
    const { accessToken, refreshToken, user, privateKeyEncrypted } = response.data;
    this.setTokens(accessToken, refreshToken);
    localStorage.setItem('sirius_user', JSON.stringify(user));
    return { user, accessToken, refreshToken, privateKeyEncrypted };
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
    
    if (!refresh) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(`${API_URL}/auth/refresh`, { 
        refreshToken: refresh 
      });
      
      const { accessToken, refreshToken } = response.data as { accessToken: string; refreshToken?: string };
      const nextRefresh = refreshToken || refresh;
      this.setTokens(accessToken, nextRefresh);
      return accessToken;
    } catch (error) {
      // Если refresh token истек или невалиден
      this.logout();
      throw error;
    }
  }

  async upsertPrivateKeyBackup(privateKeyPem: string, password: string): Promise<void> {
    const privateKeyEncrypted = await cryptoService.encryptPrivateKeyForBackup(privateKeyPem, password);
    await axios.put(`${API_URL}/auth/private-key-backup`, { privateKeyEncrypted });
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
    const { data } = await axios.patch<User>(`${API_URL}/users/me`, body);
    localStorage.setItem('sirius_user', JSON.stringify(data));
    return data;
  }
}

export const authService = new AuthService();