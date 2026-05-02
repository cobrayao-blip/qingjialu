import { useState } from 'react';
import { motion } from 'motion/react';

export interface UserLoginFormProps {
  username: string;
  password: string;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  footerHint?: string;
}

export function UserLoginForm(props: UserLoginFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setBusy(true);
    try {
      await props.onSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请检查用户名或密码');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      key="user-login"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-[100dvh] min-h-screen flex items-center justify-center bg-paper text-ink px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="w-full max-w-md bg-white rounded-[24px] border border-ink/10 p-6 space-y-4">
        <div className="text-center space-y-2">
          <h2 className="serif text-3xl font-bold text-olive">用户登录</h2>
          <p className="text-sm opacity-65">
            {props.footerHint || '请使用您的用户名与密码登录'}
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <input
            type="text"
            value={props.username}
            onChange={(e) => {
              setError('');
              props.onUsernameChange(e.target.value);
            }}
            placeholder="用户名"
            className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
            autoComplete="username"
          />
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={props.password}
              onChange={(e) => {
                setError('');
                props.onPasswordChange(e.target.value);
              }}
              placeholder="密码"
              className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-ink/20 text-xs whitespace-nowrap"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? '隐藏密码' : '显示密码'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !props.username.trim() || !props.password}
            className="w-full px-4 py-2.5 rounded-lg bg-olive text-white text-sm font-medium disabled:opacity-60"
          >
            {busy ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
