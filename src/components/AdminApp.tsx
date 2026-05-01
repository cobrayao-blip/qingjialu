import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Settings } from 'lucide-react';
import { downloadGeoExport, type GeoPlace, type AuthUser, type GeoReviewRecord } from '../services/api';

/** 用户管理中可创建与调整的角色（不含 admin） */
type ManagedUserRole = 'viewer' | 'editor';
import { LLMConfigModal } from './LLMConfigView';
import { UserLoginForm } from './UserLoginForm';

type ReviewStatus = 'pending' | 'reviewed' | 'locked';
const normalizePlaceKey = (v: string) => (v || '').replace(/\s+/g, '').toLowerCase();

interface AdminAppProps {
  months: string[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  adminUsername: string;
  adminPassword: string;
  adminRole: string;
  onAdminUsernameChange: (v: string) => void;
  onAdminPasswordChange: (v: string) => void;
  onLogin: () => Promise<void>;
  onLogout: () => void;
  geoAdminToken: string;
  geoAdminBusy: boolean;
  onFetchMetrics: () => Promise<void>;
  onPreviewDiff: () => Promise<void>;
  onFetchAuditLogs: () => Promise<void>;
  geoAdminMetricsText: string;
  geoAdminDiffText: string;
  auditLogsText: string;
  authUsers: AuthUser[];
  authUsersLoading: boolean;
  onRefreshUsers: () => Promise<void>;
  newUserName: string;
  newUserPassword: string;
  newUserPasswordConfirm: string;
  newUserRole: ManagedUserRole;
  onNewUserNameChange: (v: string) => void;
  onNewUserPasswordChange: (v: string) => void;
  onNewUserPasswordConfirmChange: (v: string) => void;
  onNewUserRoleChange: (v: ManagedUserRole) => void;
  onCreateUser: () => Promise<void>;
  onChangeUserRole: (id: number, role: ManagedUserRole) => Promise<void>;
  /** 由管理员为他人设置登录密码 */
  onSetUserPassword: (id: number, password: string) => Promise<void>;
  onDeleteUser: (id: number, username: string) => Promise<void>;
  geoPlaces: GeoPlace[];
  geoReviews: GeoReviewRecord[];
  reviewFilter: 'all' | ReviewStatus;
  onReviewFilterChange: (v: 'all' | ReviewStatus) => void;
  reviewNoteDraft: Record<string, string>;
  onReviewNoteDraftChange: (placeKey: string, note: string) => void;
  onRefreshReviewQueue: () => Promise<void>;
  onReviewStatus: (place: GeoPlace, status: ReviewStatus, placeOverride?: GeoPlace) => Promise<void>;
}

export default function AdminApp(props: AdminAppProps) {
  const [activeSection, setActiveSection] = useState<'overview' | 'review' | 'rebuild' | 'users' | 'audit'>('overview');
  const [llmConfigOpen, setLlmConfigOpen] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ id: number; username: string } | null>(null);
  const [passwordForm, setPasswordForm] = useState({ next: '', confirm: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [expandedReviewKey, setExpandedReviewKey] = useState<string | null>(null);

  useEffect(() => {
    if (props.adminRole && props.adminRole !== 'admin' && activeSection === 'users') {
      setActiveSection('overview');
    }
  }, [props.adminRole, activeSection]);
  const [editReviewKey, setEditReviewKey] = useState<string | null>(null);
  const [reviewPlaceDraft, setReviewPlaceDraft] = useState<Record<string, GeoPlace>>({});
  const loggedIn = Boolean(props.geoAdminToken.trim());

  if (!loggedIn) {
    return (
      <UserLoginForm
        username={props.adminUsername}
        password={props.adminPassword}
        onUsernameChange={props.onAdminUsernameChange}
        onPasswordChange={props.onAdminPasswordChange}
        onSubmit={props.onLogin}
        footerHint="地理治理与校审工作台，请使用您的用户名与密码登录"
      />
    );
  }

  return (
    <motion.div key="admin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 min-h-[72vh]">
      <aside className="bg-white rounded-[24px] border border-ink/10 p-4 space-y-3">
        <div className="pb-3 border-b border-ink/10">
          <h2 className="serif text-2xl font-bold text-olive">地理治理后台</h2>
          <p className="text-xs opacity-60 mt-1">当前角色：{props.adminRole || '未知'}</p>
        </div>
        {(
          [
            ['overview', '概览'],
            ['review', '校审'],
            ['rebuild', '重建与Diff'],
            ...(props.adminRole === 'admin' ? ([['users', '用户管理']] as const) : []),
            ['audit', '审计日志'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id as typeof activeSection)}
            className={[
              'w-full text-left px-3 py-2 rounded-lg text-sm border transition-all',
              activeSection === id ? 'bg-olive text-white border-olive' : 'border-ink/10 hover:bg-ink/5',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
        {props.adminRole === 'admin' && (
          <button
            type="button"
            onClick={() => setLlmConfigOpen(true)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm border border-ink/10 hover:bg-olive/10 flex items-center gap-2 text-olive"
          >
            <Settings size={16} />
            大模型配置
          </button>
        )}
        <button type="button" className="w-full mt-2 px-3 py-2 rounded-lg border border-ink/20 text-sm" onClick={props.onLogout}>
          退出登录
        </button>
      </aside>

      <div className="space-y-4">
        <div className="bg-white rounded-[20px] border border-ink/10 p-4">
          <div className="flex flex-wrap gap-2 items-center">
            {props.months.map((month) => (
              <button
                key={`admin-month-${month}`}
                type="button"
                onClick={() => props.onSelectMonth(month)}
                className={[
                  'px-3 py-1.5 rounded-full text-xs border transition-all',
                  props.selectedMonth === month ? 'bg-olive text-white border-olive' : 'bg-white border-ink/15 text-ink/80',
                ].join(' ')}
              >
                {month}
              </button>
            ))}
          </div>
        </div>

        {activeSection === 'overview' && (
          <div className="space-y-4">
            <div className="bg-white rounded-[20px] border border-ink/10 p-4 space-y-3">
              <h3 className="font-semibold text-ink">后台概览</h3>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  disabled={props.geoAdminBusy}
                  className="px-3 py-2 rounded-lg bg-olive text-white text-sm disabled:opacity-50"
                  onClick={() => void props.onFetchMetrics()}
                >
                  拉取质量指标
                </button>
                <button
                  type="button"
                  disabled={props.geoAdminBusy}
                  className="px-3 py-2 rounded-lg border border-ink/20 text-sm disabled:opacity-50"
                  onClick={() => void props.onFetchAuditLogs()}
                >
                  拉取审计日志
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-ink/20 text-sm"
                  onClick={() =>
                    downloadGeoExport(props.selectedMonth, 'md', props.geoAdminToken).catch((err) =>
                      alert(err instanceof Error ? err.message : '导出失败')
                    )
                  }
                >
                  导出 Markdown
                </button>
              </div>
            </div>
            <div className="bg-white rounded-[20px] border border-ink/10 p-4">
              <h3 className="font-semibold text-ink mb-2">质量指标</h3>
              <pre className="text-[11px] bg-ink/5 p-2 rounded-lg overflow-x-auto max-h-72">
                {props.geoAdminMetricsText || '点击「拉取质量指标」查看'}
              </pre>
            </div>
          </div>
        )}

        {activeSection === 'review' && (
          <div className="bg-white rounded-[20px] border border-ink/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-ink">人工校审队列（{props.selectedMonth}）</h3>
              <div className="flex gap-2 items-center">
                <select
                  value={props.reviewFilter}
                  onChange={(e) => props.onReviewFilterChange(e.target.value as 'all' | ReviewStatus)}
                  className="px-2 py-1.5 rounded border border-ink/20 text-xs"
                >
                  <option value="all">全部状态</option>
                  <option value="pending">待审</option>
                  <option value="reviewed">已审</option>
                  <option value="locked">锁定</option>
                </select>
                <button type="button" onClick={() => void props.onRefreshReviewQueue()} className="px-3 py-1.5 rounded-lg border border-ink/20 text-xs">
                  刷新列表
                </button>
              </div>
            </div>
            {props.geoPlaces.length === 0 ? (
              <p className="text-sm opacity-60">当前月份无可校审地理条目。</p>
            ) : (
              <div className="space-y-2">
                {props.geoPlaces
                  .filter((place) => {
                    if (props.reviewFilter === 'all') return true;
                    const review = props.geoReviews.find((r) => normalizePlaceKey(r.placeKey) === normalizePlaceKey(place.name) && r.month === props.selectedMonth);
                    return (review?.status || 'pending') === props.reviewFilter;
                  })
                  .map((place) => {
                    const review = props.geoReviews.find((r) => normalizePlaceKey(r.placeKey) === normalizePlaceKey(place.name) && r.month === props.selectedMonth);
                    const status = review?.status || 'pending';
                    const key = place.name.trim().toLowerCase();
                    const isEditing = editReviewKey === key;
                    const placeDraft = reviewPlaceDraft[key] || place;
                    return (
                      <div key={`admin-review-${place.id}`} className="border border-ink/10 rounded-xl p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-olive">{place.name}</div>
                            <div className="text-xs opacity-60">
                              {place.citations.length} 条引文 · 当前状态：{status === 'pending' ? '待审' : status === 'reviewed' ? '已审' : '锁定'}
                            </div>
                            <div className="text-[11px] opacity-55">
                              最近更新：{review?.updatedAt ? new Date(review.updatedAt).toLocaleString() : '暂无'}{review?.reviewerUsername ? ` · ${review.reviewerUsername}` : ''}
                            </div>
                          </div>
                          <div className="flex gap-1 items-center">
                            <button
                              type="button"
                              className="px-2 py-1 rounded border border-ink/20 text-xs hover:bg-ink/5"
                              onClick={() => setExpandedReviewKey((prev) => (prev === key ? null : key))}
                            >
                              {expandedReviewKey === key ? '收起内容' : '查看内容'}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 rounded border border-ink/20 text-xs hover:bg-ink/5"
                              onClick={() => {
                                if (isEditing) {
                                  setEditReviewKey(null);
                                  return;
                                }
                                setReviewPlaceDraft((prev) => ({ ...prev, [key]: place }));
                                setEditReviewKey(key);
                                setExpandedReviewKey(key);
                              }}
                            >
                              {isEditing ? '退出编辑' : '编辑内容'}
                            </button>
                            {(['pending', 'reviewed', 'locked'] as const).map((st) => (
                              <button
                                key={`${place.id}-${st}`}
                                type="button"
                                className={[
                                  'px-2 py-1 rounded border text-xs',
                                  status === st ? 'border-olive bg-olive/10 text-olive' : 'border-ink/20 hover:bg-ink/5',
                                ].join(' ')}
                                onClick={() => void props.onReviewStatus(place, st, isEditing ? placeDraft : undefined)}
                              >
                                {st === 'pending' ? '待审' : st === 'reviewed' ? '已审' : '锁定'}
                              </button>
                            ))}
                          </div>
                        </div>
                        {expandedReviewKey === key && (
                          <div className="bg-ink/5 rounded-lg p-2 space-y-2 text-xs">
                            {(isEditing ? placeDraft.aliases : place.aliases)?.length ? (
                              <div>
                                <span className="font-semibold text-ink/80">别名：</span>
                                <span className="opacity-80">{(isEditing ? placeDraft.aliases : place.aliases)?.join('、')}</span>
                              </div>
                            ) : null}
                            <div>
                              <div className="font-semibold text-ink/80 mb-1">清代侧综述</div>
                              {isEditing ? (
                                <textarea
                                  value={placeDraft.ancientSummary || ''}
                                  onChange={(e) =>
                                    setReviewPlaceDraft((prev) => ({ ...prev, [key]: { ...placeDraft, ancientSummary: e.target.value } }))
                                  }
                                  className="w-full min-h-[70px] px-2 py-1 rounded border border-ink/20"
                                />
                              ) : (
                                <div className="opacity-90 whitespace-pre-wrap">{place.ancientSummary || '暂无'}</div>
                              )}
                            </div>
                            {(isEditing || place.ancientEvidence) ? (
                              <div>
                                <div className="font-semibold text-ink/80 mb-1">文献可证</div>
                                {isEditing ? (
                                  <textarea
                                    value={placeDraft.ancientEvidence || ''}
                                    onChange={(e) =>
                                      setReviewPlaceDraft((prev) => ({ ...prev, [key]: { ...placeDraft, ancientEvidence: e.target.value } }))
                                    }
                                    className="w-full min-h-[70px] px-2 py-1 rounded border border-ink/20"
                                  />
                                ) : (
                                  <div className="opacity-90 whitespace-pre-wrap">{place.ancientEvidence}</div>
                                )}
                              </div>
                            ) : null}
                            <div>
                              <div className="font-semibold text-ink/80 mb-1">现代总述</div>
                              {isEditing ? (
                                <textarea
                                  value={placeDraft.modernSummary || ''}
                                  onChange={(e) =>
                                    setReviewPlaceDraft((prev) => ({ ...prev, [key]: { ...placeDraft, modernSummary: e.target.value } }))
                                  }
                                  className="w-full min-h-[70px] px-2 py-1 rounded border border-ink/20"
                                />
                              ) : (
                                <div className="opacity-90 whitespace-pre-wrap">{place.modernSummary || '暂无'}</div>
                              )}
                            </div>
                            {(isEditing || place.modernFactual) ? (
                              <div>
                                <div className="font-semibold text-ink/80 mb-1">现代（可核对）</div>
                                {isEditing ? (
                                  <textarea
                                    value={placeDraft.modernFactual || ''}
                                    onChange={(e) =>
                                      setReviewPlaceDraft((prev) => ({ ...prev, [key]: { ...placeDraft, modernFactual: e.target.value } }))
                                    }
                                    className="w-full min-h-[60px] px-2 py-1 rounded border border-ink/20"
                                  />
                                ) : (
                                  <div className="opacity-90 whitespace-pre-wrap">{place.modernFactual}</div>
                                )}
                              </div>
                            ) : null}
                            {(isEditing || place.modernInterpretation) ? (
                              <div>
                                <div className="font-semibold text-ink/80 mb-1">现代（推断）</div>
                                {isEditing ? (
                                  <textarea
                                    value={placeDraft.modernInterpretation || ''}
                                    onChange={(e) =>
                                      setReviewPlaceDraft((prev) => ({ ...prev, [key]: { ...placeDraft, modernInterpretation: e.target.value } }))
                                    }
                                    className="w-full min-h-[60px] px-2 py-1 rounded border border-ink/20"
                                  />
                                ) : (
                                  <div className="opacity-90 whitespace-pre-wrap">{place.modernInterpretation}</div>
                                )}
                              </div>
                            ) : null}
                            <div>
                              <div className="font-semibold text-ink/80 mb-1">引文证据（{place.citations.length}）</div>
                              {place.citations.length === 0 ? (
                                <div className="opacity-60">暂无引文</div>
                              ) : (
                                <div className="space-y-1">
                                  {place.citations.map((c, idx) => (
                                    <div key={`${place.id}-cite-${idx}`} className="bg-white rounded border border-ink/10 px-2 py-1">
                                      <div className="opacity-70">《{c.chapterTitle}》 · 证据强度：{c.evidenceStrength || 'inferred'}</div>
                                      <div className="whitespace-pre-wrap">「{c.quoteText}」</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {isEditing && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded border border-ink/20 text-xs"
                                  onClick={() => void props.onReviewStatus(place, 'reviewed', placeDraft)}
                                >
                                  保存草稿（已审）
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded border border-olive text-olive text-xs"
                                  onClick={() => void props.onReviewStatus(place, 'locked', placeDraft)}
                                >
                                  保存并锁定
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <textarea
                          value={props.reviewNoteDraft[key] ?? review?.reviewNote ?? ''}
                          onChange={(e) => props.onReviewNoteDraftChange(key, e.target.value)}
                          placeholder="校审备注（可选，最多 500 字）"
                          className="w-full min-h-[68px] px-2 py-1.5 rounded border border-ink/15 text-xs"
                        />
                      </div>
                    );
                  })}
                {props.geoPlaces.filter((place) => {
                  if (props.reviewFilter === 'all') return true;
                  const review = props.geoReviews.find((r) => normalizePlaceKey(r.placeKey) === normalizePlaceKey(place.name) && r.month === props.selectedMonth);
                  return (review?.status || 'pending') === props.reviewFilter;
                }).length === 0 && (
                  <p className="text-sm opacity-60">该筛选条件下暂无条目。</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeSection === 'rebuild' && (
          <div className="space-y-4">
            <div className="bg-white rounded-[20px] border border-ink/10 p-4">
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  disabled={props.geoAdminBusy}
                  className="px-3 py-2 rounded-lg border border-olive text-olive text-sm disabled:opacity-50"
                  onClick={() => void props.onPreviewDiff()}
                >
                  预览重算 diff（不写库）
                </button>
              </div>
            </div>
            <div className="bg-white rounded-[20px] border border-ink/10 p-4">
              <h3 className="font-semibold text-ink mb-2">重算差异预览（{props.selectedMonth}）</h3>
              <pre className="text-[11px] bg-ink/5 p-2 rounded-lg overflow-x-auto max-h-72">
                {props.geoAdminDiffText || '点击「预览重算 diff（不写库）」查看'}
              </pre>
            </div>
          </div>
        )}

        {activeSection === 'users' && props.adminRole === 'admin' && (
          <div className="bg-white rounded-[20px] border border-ink/10 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-semibold text-ink">用户管理</h3>
                <p className="text-xs opacity-70 mt-1">
                  在此创建与维护 <span className="font-medium text-ink/80">viewer</span> /{' '}
                  <span className="font-medium text-ink/80">editor</span> 的登录账号与密码；对方凭此登录工作台。管理员账号由部署与环境配置维护，不在此创建。
                </p>
              </div>
              <button type="button" className="px-3 py-1.5 rounded-lg border border-ink/20 text-xs" onClick={() => void props.onRefreshUsers()} disabled={props.authUsersLoading}>
                刷新列表
              </button>
            </div>
            <p className="text-xs opacity-70 border-t border-ink/10 pt-3">
              <span className="font-medium text-ink/80">editor</span>：校审与重建；<span className="font-medium text-ink/80">viewer</span>
              ：仅查看指标与审计。<span className="font-medium text-ink/80">admin</span> 不在此列表中创建。密码至少 6 位。
            </p>

            <div className="rounded-xl border border-olive/25 bg-olive/5 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-olive">新建账号</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink/70 mb-1">登录用户名</label>
                  <input
                    type="text"
                    value={props.newUserName}
                    onChange={(e) => props.onNewUserNameChange(e.target.value)}
                    placeholder="例如 zhangsan"
                    className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink/70 mb-1">角色</label>
                  <select
                    value={props.newUserRole}
                    onChange={(e) => props.onNewUserRoleChange(e.target.value as ManagedUserRole)}
                    className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                  >
                    <option value="viewer">viewer（只读）</option>
                    <option value="editor">editor（校审）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink/70 mb-1">登录密码</label>
                  <input
                    type="password"
                    value={props.newUserPassword}
                    onChange={(e) => props.onNewUserPasswordChange(e.target.value)}
                    placeholder="至少 6 位"
                    className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink/70 mb-1">确认密码</label>
                  <input
                    type="password"
                    value={props.newUserPasswordConfirm}
                    onChange={(e) => props.onNewUserPasswordConfirmChange(e.target.value)}
                    placeholder="再次输入密码"
                    className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-olive text-white text-sm font-medium disabled:opacity-50"
                disabled={!props.newUserName.trim() || !props.newUserPassword || !props.newUserPasswordConfirm}
                onClick={() => void props.onCreateUser()}
              >
                创建账号
              </button>
            </div>

            {props.authUsersLoading ? (
              <p className="text-sm opacity-60">加载中...</p>
            ) : (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-ink">已有用户</h4>
                {props.authUsers.map((u) => {
                  const isSelf = u.username === props.adminUsername;
                  const isAdminRow = u.role === 'admin';
                  return (
                    <div key={`auth-user-${u.id}`} className="border border-ink/10 rounded-xl p-3 flex flex-wrap gap-2 items-center justify-between">
                      <div className="text-sm">
                        <span className="font-semibold text-ink">{u.username}</span>
                        <span className="opacity-60 ml-2">{u.role}</span>
                        {isSelf && <span className="ml-2 text-xs text-olive">当前账号</span>}
                      </div>
                      <div className="flex gap-1 items-center flex-wrap">
                        {isAdminRow ? (
                          <span className="px-2 py-1 rounded border border-ink/10 text-xs text-ink/70 bg-ink/5">admin（不在此改角色）</span>
                        ) : (
                        <select
                          value={u.role === 'member' ? 'member' : u.role}
                          disabled={isSelf}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'viewer' || v === 'editor') void props.onChangeUserRole(u.id, v);
                          }}
                          className="px-2 py-1 rounded border border-ink/15 text-xs disabled:opacity-60"
                        >
                          {u.role === 'member' && <option value="member">member（请改为 viewer/editor）</option>}
                          <option value="viewer">viewer</option>
                          <option value="editor">editor</option>
                        </select>
                        )}
                        <button
                          type="button"
                          className="px-2 py-1 rounded border border-ink/15 text-xs hover:bg-ink/5"
                          onClick={() => {
                            setPasswordDialog({ id: u.id, username: u.username });
                            setPasswordForm({ next: '', confirm: '' });
                          }}
                        >
                          设置密码
                        </button>
                        <button
                          type="button"
                          disabled={isSelf}
                          className="px-2 py-1 rounded border border-amber-300 text-amber-700 text-xs disabled:opacity-60"
                          onClick={() => void props.onDeleteUser(u.id, u.username)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
                {props.authUsers.length === 0 && <p className="text-sm opacity-60">暂无用户，请先创建账号。</p>}
              </div>
            )}
          </div>
        )}

        {activeSection === 'audit' && (
          <div className="bg-white rounded-[20px] border border-ink/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">审计日志</h3>
              <button
                type="button"
                disabled={props.geoAdminBusy}
                className="px-3 py-2 rounded-lg border border-ink/20 text-sm disabled:opacity-50"
                onClick={() => void props.onFetchAuditLogs()}
              >
                刷新日志
              </button>
            </div>
            <pre className="text-[11px] bg-ink/5 p-2 rounded-lg overflow-x-auto max-h-96">
              {props.auditLogsText || '点击「刷新日志」查看最近操作'}
            </pre>
          </div>
        )}
      </div>

      <LLMConfigModal open={llmConfigOpen} onClose={() => setLlmConfigOpen(false)} adminToken={props.geoAdminToken} />

      {passwordDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="关闭"
            onClick={() => !passwordBusy && setPasswordDialog(null)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl border border-ink/10 shadow-xl p-5 space-y-4">
            <h3 className="serif text-lg font-bold text-olive">设置登录密码</h3>
            <p className="text-sm text-ink/70">
              用户 <span className="font-semibold text-ink">{passwordDialog.username}</span> 将使用新密码登录。
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink/70">新密码（至少 6 位）</label>
              <input
                type="password"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                autoComplete="new-password"
              />
              <label className="block text-xs font-medium text-ink/70">确认密码</label>
              <input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-ink/15 text-sm"
                autoComplete="new-password"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={passwordBusy}
                className="px-3 py-2 rounded-lg border border-ink/20 text-sm"
                onClick={() => setPasswordDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={passwordBusy || !passwordForm.next.trim()}
                className="px-3 py-2 rounded-lg bg-olive text-white text-sm disabled:opacity-50"
                onClick={() => {
                  if (passwordForm.next !== passwordForm.confirm) {
                    alert('两次输入的密码不一致');
                    return;
                  }
                  setPasswordBusy(true);
                  void props
                    .onSetUserPassword(passwordDialog.id, passwordForm.next)
                    .then(() => {
                      alert('密码已更新，请通知对方使用新密码登录。');
                      setPasswordDialog(null);
                      setPasswordForm({ next: '', confirm: '' });
                    })
                    .catch(() => {
                      /* 错误已在 hook 中提示 */
                    })
                    .finally(() => setPasswordBusy(false));
                }}
              >
                {passwordBusy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

