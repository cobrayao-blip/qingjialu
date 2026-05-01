import { useEffect, useMemo, useState } from 'react';
import type { GeoPlace, AuthUser, GeoReviewRecord } from '../services/api';

type ManagedUserRole = 'viewer' | 'editor';
import {
  loginAdmin,
  getAuthMe,
  refreshAuthToken,
  getGeoAdminMetrics,
  postGeoAdminRebuildPreview,
  postGeoAdminReview,
  listAuthUsers,
  createAuthUser,
  patchAuthUser,
  removeAuthUser,
  listGeoAuditLogs,
  listGeoAdminReviews,
} from '../services/api';

type ReviewStatus = 'pending' | 'reviewed' | 'locked';
const normalizePlaceKey = (v: string) => (v || '').replace(/\s+/g, '').toLowerCase();

const AUTH_JWT_KEY = 'qingjialuJwt';
const AUTH_JWT_LEGACY = 'geoAdminJwt';

function readStoredJwt(): string {
  try {
    return localStorage.getItem(AUTH_JWT_KEY) || localStorage.getItem(AUTH_JWT_LEGACY) || '';
  } catch {
    return '';
  }
}

function persistJwt(token: string) {
  try {
    localStorage.setItem(AUTH_JWT_KEY, token);
    localStorage.setItem(AUTH_JWT_LEGACY, token);
  } catch {
    /* ignore */
  }
}

function clearStoredJwt() {
  try {
    localStorage.removeItem(AUTH_JWT_KEY);
    localStorage.removeItem(AUTH_JWT_LEGACY);
  } catch {
    /* ignore */
  }
}

/** 从 JWT 解析 role（仅用于前端展示入口，不做签名校验） */
function jwtPayloadRole(token: string): string | undefined {
  try {
    const part = token.split('.')[1];
    if (!part) return undefined;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const json = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : undefined;
  } catch {
    return undefined;
  }
}

export function useAdminController(params: { isAdminRoute: boolean; selectedMonth: string }) {
  const { isAdminRoute, selectedMonth } = params;
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminRole, setAdminRole] = useState<string>('');
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [authUsersLoading, setAuthUsersLoading] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState('');
  const [newUserRole, setNewUserRole] = useState<ManagedUserRole>('viewer');
  const [auditLogsText, setAuditLogsText] = useState('');
  const [geoAdminToken, setGeoAdminToken] = useState(() => readStoredJwt());
  /** 本地有 JWT 时须等 /auth/me 完成后再展示主站，避免未验证 token 时误发业务请求 */
  const [authBootstrapDone, setAuthBootstrapDone] = useState(() => !readStoredJwt().trim());
  const [geoAdminMetricsText, setGeoAdminMetricsText] = useState('');
  const [geoAdminDiffText, setGeoAdminDiffText] = useState('');
  const [geoAdminBusy, setGeoAdminBusy] = useState(false);
  const [geoReviews, setGeoReviews] = useState<GeoReviewRecord[]>([]);
  const [reviewFilter, setReviewFilter] = useState<'all' | ReviewStatus>('all');
  const [reviewNoteDraft, setReviewNoteDraft] = useState<Record<string, string>>({});

  /** 主站头部「管理后台」：有 admin 角色 JWT 即显示（不依赖 /auth/me 是否已返回，避免整页刷新后短暂空白） */
  const showAdminBackendEntry = useMemo(() => {
    const t = geoAdminToken.trim();
    if (!t) return false;
    if (adminRole === 'admin') return true;
    return jwtPayloadRole(t) === 'admin';
  }, [geoAdminToken, adminRole]);

  const loadAuthUsers = async () => {
    if (!geoAdminToken.trim()) return;
    setAuthUsersLoading(true);
    try {
      const res = await listAuthUsers(geoAdminToken.trim());
      setAuthUsers(res.users || []);
    } catch {
      setAuthUsers([]);
    } finally {
      setAuthUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!geoAdminToken.trim()) {
      setAdminRole('');
      setAdminUsername('');
      setAuthBootstrapDone(true);
      return;
    }
    setAuthBootstrapDone(false);
    getAuthMe(geoAdminToken.trim())
      .then((res) => {
        setAdminRole(res.user.role);
        setAdminUsername(res.user.username);
      })
      .catch(() => {
        setAdminRole('');
        setAdminUsername('');
        setGeoAdminToken('');
        clearStoredJwt();
      })
      .finally(() => setAuthBootstrapDone(true));
  }, [geoAdminToken]);

  useEffect(() => {
    if (!isAdminRoute || !geoAdminToken.trim()) return;
    void loadAuthUsers();
  }, [isAdminRoute, geoAdminToken]);

  useEffect(() => {
    if (!isAdminRoute || !geoAdminToken.trim()) return;
    void (async () => {
      try {
        const res = await listGeoAdminReviews(geoAdminToken.trim(), selectedMonth);
        setGeoReviews(res.reviews || []);
      } catch {
        setGeoReviews([]);
      }
    })();
  }, [isAdminRoute, geoAdminToken, selectedMonth]);

  useEffect(() => {
    if (!geoAdminToken.trim()) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await refreshAuthToken(geoAdminToken.trim());
        setGeoAdminToken(refreshed.token);
        setAdminRole(refreshed.user.role);
        setAdminUsername(refreshed.user.username);
        persistJwt(refreshed.token);
      } catch {
        // token expired: ignore silently
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [geoAdminToken]);

  const loginWithPassword = async (username: string, password: string) => {
    const r = await loginAdmin(username.trim(), password);
    setGeoAdminToken(r.token);
    setAdminRole(r.user.role);
    setAdminUsername(r.user.username);
    persistJwt(r.token);
    await loadAuthUsers();
    // viewer 仅浏览主站，从后台登录页进入时回到首页
    if (r.user.role === 'viewer' && typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      window.location.replace('/');
    }
  };

  const handleAdminLogin = async () => {
    await loginWithPassword(adminUsername, adminPassword);
    setAdminPassword('');
  };

  const handleAdminLogout = () => {
    setGeoAdminToken('');
    setAdminRole('');
    setAdminUsername('');
    setAdminPassword('');
    setAuthUsers([]);
    setAuditLogsText('');
    clearStoredJwt();
  };

  const handleFetchMetrics = async () => {
    setGeoAdminBusy(true);
    try {
      const m = await getGeoAdminMetrics(geoAdminToken.trim());
      setGeoAdminMetricsText(JSON.stringify(m, null, 2));
    } catch (e) {
      setGeoAdminMetricsText(e instanceof Error ? e.message : '请求失败');
    } finally {
      setGeoAdminBusy(false);
    }
  };

  const handlePreviewDiff = async () => {
    setGeoAdminBusy(true);
    try {
      const r = await postGeoAdminRebuildPreview(geoAdminToken.trim(), selectedMonth);
      setGeoAdminDiffText(JSON.stringify(r.diff, null, 2));
    } catch (e) {
      setGeoAdminDiffText(e instanceof Error ? e.message : '请求失败');
    } finally {
      setGeoAdminBusy(false);
    }
  };

  const handleFetchAuditLogs = async () => {
    setGeoAdminBusy(true);
    try {
      const logs = await listGeoAuditLogs(geoAdminToken.trim(), 120);
      setAuditLogsText(JSON.stringify(logs.logs, null, 2));
    } catch (e) {
      setAuditLogsText(e instanceof Error ? e.message : '请求失败');
    } finally {
      setGeoAdminBusy(false);
    }
  };

  const handleCreateUser = async () => {
    const name = newUserName.trim();
    if (!name || !newUserPassword) return;
    if (newUserPassword !== newUserPasswordConfirm) {
      alert('两次输入的密码不一致');
      return;
    }
    if (newUserPassword.trim().length < 6) {
      alert('密码长度至少 6 位');
      return;
    }
    try {
      await createAuthUser(geoAdminToken.trim(), {
        username: name,
        password: newUserPassword,
        role: newUserRole,
      });
      setNewUserName('');
      setNewUserPassword('');
      setNewUserPasswordConfirm('');
      await loadAuthUsers();
      alert(`账号「${name}」已创建，请将登录用户名与密码告知对方。`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '创建用户失败');
    }
  };

  const handleChangeUserRole = async (id: number, role: ManagedUserRole) => {
    await patchAuthUser(geoAdminToken.trim(), id, { role });
    await loadAuthUsers();
  };

  const handleSetUserPassword = async (id: number, password: string) => {
    const p = password.trim();
    if (p.length < 6) {
      alert('密码长度至少 6 位');
      return;
    }
    try {
      await patchAuthUser(geoAdminToken.trim(), id, { password: p });
      await loadAuthUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : '设置密码失败');
      throw e;
    }
  };

  const handleDeleteUser = async (id: number, username: string) => {
    if (!window.confirm(`确认删除用户 ${username} ?`)) return;
    await removeAuthUser(geoAdminToken.trim(), id);
    await loadAuthUsers();
  };

  const handleReviewStatus = async (place: GeoPlace, st: ReviewStatus, month: string, placeOverride?: GeoPlace) => {
    try {
      const key = normalizePlaceKey(place.name);
      const payloadPlace = placeOverride || place;
      await postGeoAdminReview(geoAdminToken.trim(), {
        month,
        placeKey: place.name,
        status: st,
        placeSnapshot: payloadPlace,
        reviewNote: reviewNoteDraft[key] || '',
      });
      alert(`已将 ${place.name} 标记为：${st === 'pending' ? '待审' : st === 'reviewed' ? '已审' : '锁定'}`);
      const res = await listGeoAdminReviews(geoAdminToken.trim(), month);
      setGeoReviews(res.reviews || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : '校审写入失败');
    }
  };
  const onReviewNoteDraftChange = (placeKey: string, note: string) => {
    setReviewNoteDraft((prev) => ({ ...prev, [normalizePlaceKey(placeKey)]: note.slice(0, 500) }));
  };

  return {
    authBootstrapDone,
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    adminRole,
    showAdminBackendEntry,
    authUsers,
    authUsersLoading,
    newUserName,
    setNewUserName,
    newUserPassword,
    setNewUserPassword,
    newUserPasswordConfirm,
    setNewUserPasswordConfirm,
    newUserRole,
    setNewUserRole,
    auditLogsText,
    geoAdminToken,
    geoAdminMetricsText,
    geoAdminDiffText,
    geoAdminBusy,
    geoReviews,
    reviewFilter,
    setReviewFilter,
    reviewNoteDraft,
    onReviewNoteDraftChange,
    loadAuthUsers,
    handleAdminLogin,
    loginWithPassword,
    handleAdminLogout,
    handleFetchMetrics,
    handlePreviewDiff,
    handleFetchAuditLogs,
    handleCreateUser,
    handleChangeUserRole,
    handleSetUserPassword,
    handleDeleteUser,
    handleReviewStatus,
  };
}

