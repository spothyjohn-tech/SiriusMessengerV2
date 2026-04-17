import React, { useState } from 'react';
import { IconMail, IconLock, IconUser, IconEye, IconEyeOff } from './icons';

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
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isLogin = mode === 'login';

  return (
    <div className="sf-auth-overlay">
      <div className="sf-auth-modal" role="dialog" aria-labelledby="sf-auth-title">
        <div className="sf-auth-modal-glow sf-auth-modal-glow--tr" aria-hidden />
        <div className="sf-auth-modal-glow sf-auth-modal-glow--bl" aria-hidden />

        <div className="sf-auth-head">
          <div className="sf-auth-head-text">
            <h1 id="sf-auth-title" className="sf-auth-title">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="sf-auth-subtitle">
              {isLogin ? 'Login to continue to Sirius' : 'Sign up to start messaging on Sirius'}
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
              <label className="sf-auth-label">Username</label>
              <div className="sf-auth-input-wrap">
                <span className="sf-auth-input-icon" aria-hidden>
                  <IconUser width={20} height={20} />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => onUsername(e.target.value)}
                  placeholder="Choose a username"
                  className="sf-auth-input"
                  required
                  autoComplete="username"
                />
              </div>
            </div>
          )}

          <div className="sf-auth-field">
            <label className="sf-auth-label">Email</label>
            <div className="sf-auth-input-wrap">
              <span className="sf-auth-input-icon" aria-hidden>
                <IconMail width={20} height={20} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => onEmail(e.target.value)}
                placeholder="Enter your email"
                className="sf-auth-input"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="sf-auth-field">
            <label className="sf-auth-label">Password</label>
            <div className="sf-auth-input-wrap">
              <span className="sf-auth-input-icon" aria-hidden>
                <IconLock width={20} height={20} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => onPassword(e.target.value)}
                placeholder="Enter your password"
                className="sf-auth-input sf-auth-input--with-toggle"
                required
                minLength={isLogin ? undefined : 8}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="sf-auth-toggle-pw"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <IconEyeOff width={20} height={20} /> : <IconEye width={20} height={20} />}
              </button>
            </div>
          </div>

          {isLogin && (
            <div className="sf-auth-row">
              <label className="sf-auth-remember">
                <input type="checkbox" className="sf-auth-checkbox" />
                <span>Remember me</span>
              </label>
              <button type="button" className="sf-auth-link-btn">
                Forgot password?
              </button>
            </div>
          )}

          {error && <p className="sf-auth-error">{error}</p>}

          <button type="submit" className="sf-auth-submit" disabled={busy}>
            {busy ? '…' : isLogin ? 'Login' : 'Create Account'}
          </button>
        </form>

        <div className="sf-auth-footer">
          <p className="sf-auth-switch">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="sf-auth-switch-btn"
              onClick={() => {
                onSetMode(isLogin ? 'register' : 'login');
              }}
            >
              {isLogin ? 'Sign up' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
