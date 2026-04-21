import React, { useState } from 'react';
import { IconMail, IconLock, IconUser, IconEye, IconEyeOff } from './icons';
import { t, setStoredLang, type AppLang } from '../utils/i18n';

interface AuthScreenProps {
  mode: 'login' | 'register';
  onSetMode: (m: 'login' | 'register') => void;
  email: string;
  password: string;
  username: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onUsername: (v: string) => void;
  error: string | null;
  busy: boolean;
  onLogin: (e: React.FormEvent) => void;
  onRegister: (e: React.FormEvent) => void;
  // 👇 ДОБАВЛЯЕМ НОВЫЕ ПРОПСЫ
  currentLang: AppLang;
  onLanguageChange: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({
  mode,
  onSetMode,
  email,
  password,
  username,
  onEmail,
  onPassword,
  onUsername,
  error,
  busy,
  onLogin,
  onRegister,
  currentLang,        // 👈 ПОЛУЧАЕМ
  onLanguageChange,   // 👈 ПОЛУЧАЕМ
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isLogin = mode === 'login';

  const handleLanguageChange = (newLang: AppLang) => {
    setStoredLang(newLang);
    onLanguageChange(); // Уведомляем родителя
  };

  return (
    <div className="sf-auth-overlay">
      <div className="sf-auth-modal" role="dialog" aria-labelledby="sf-auth-title">
        <div className="sf-auth-modal-glow sf-auth-modal-glow--tr" aria-hidden />
        <div className="sf-auth-modal-glow sf-auth-modal-glow--bl" aria-hidden />

        {/* Переключатель языка */}
        <div className="sf-auth-lang-switch">
          <button
            type="button"
            className={`sf-auth-lang-btn ${currentLang === 'en' ? 'sf-auth-lang-btn--active' : ''}`}
            onClick={() => handleLanguageChange('en')}
            aria-label="English"
          >
            EN
          </button>
          <span className="sf-auth-lang-sep">|</span>
          <button
            type="button"
            className={`sf-auth-lang-btn ${currentLang === 'ru' ? 'sf-auth-lang-btn--active' : ''}`}
            onClick={() => handleLanguageChange('ru')}
            aria-label="Русский"
          >
            РУ
          </button>
        </div>

        <div className="sf-auth-head">
          <div className="sf-auth-head-text">
            <h1 id="sf-auth-title" className="sf-auth-title">
              {isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}
            </h1>
            <p className="sf-auth-subtitle">
              {isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
            </p>
          </div>
        </div>

        <form
          className="sf-auth-form"
          onSubmit={isLogin ? onLogin : onRegister}
          noValidate
        >
          {!isLogin && (
            <div className="sf-auth-field">
              <label className="sf-auth-label">{t('auth.username')}</label>
              <div className="sf-auth-input-wrap">
                <span className="sf-auth-input-icon" aria-hidden>
                  <IconUser width={20} height={20} />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => onUsername(e.target.value)}
                  placeholder={t('auth.usernamePlaceholder')}
                  className="sf-auth-input"
                  required
                  autoComplete="username"
                />
              </div>
            </div>
          )}

          <div className="sf-auth-field">
            <label className="sf-auth-label">{t('auth.email')}</label>
            <div className="sf-auth-input-wrap">
              <span className="sf-auth-input-icon" aria-hidden>
                <IconMail width={20} height={20} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => onEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="sf-auth-input"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="sf-auth-field">
            <label className="sf-auth-label">{t('auth.password')}</label>
            <div className="sf-auth-input-wrap">
              <span className="sf-auth-input-icon" aria-hidden>
                <IconLock width={20} height={20} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => onPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                className="sf-auth-input sf-auth-input--with-toggle"
                required
                minLength={isLogin ? undefined : 8}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="sf-auth-toggle-pw"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <IconEyeOff width={20} height={20} /> : <IconEye width={20} height={20} />}
              </button>
            </div>
          </div>

          {isLogin && (
            <div className="sf-auth-row">
              <label className="sf-auth-remember">
                <input type="checkbox" className="sf-auth-checkbox" />
                <span>{t('auth.rememberMe')}</span>
              </label>
              <button type="button" className="sf-auth-link-btn">
                {t('auth.forgotPassword')}
              </button>
            </div>
          )}

          {error && <p className="sf-auth-error">{error}</p>}

          <button type="submit" className="sf-auth-submit" disabled={busy}>
            {busy ? '…' : isLogin ? t('auth.login') : t('auth.register')}
          </button>
        </form>

        <div className="sf-auth-footer">
          <p className="sf-auth-switch">
            {isLogin ? t('auth.noAccount') : t('auth.haveAccount')}
            <button
              type="button"
              className="sf-auth-switch-btn"
              onClick={() => {
                onSetMode(isLogin ? 'register' : 'login');
              }}
            >
              {isLogin ? t('auth.signUp') : t('auth.login')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
