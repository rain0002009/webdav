import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJson } from '../../lib/api'
import { accountStatusLabel } from '../../lib/account-status'
import { button, card, notice, page } from '../../lib/styles'

type AdminAccountView = {
  accountKey: string
  nickname?: string
  userId?: string
  status: 'pending' | 'approved' | 'rejected'
  registeredAt: string
  lastLoginAt: string
  username?: string
}

const pageStyles = page()
const cardStyles = card()

export default function AdminPanel() {
  const adminToken = useMemo(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
    [],
  )
  const [accounts, setAccounts] = useState<AdminAccountView[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const adminFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      return fetchJson<T>(url, {
        ...init,
        headers: {
          'x-admin-token': adminToken,
          ...(init?.headers ?? {}),
        },
      })
    },
    [adminToken],
  )

  const loadAccounts = useCallback(async () => {
    if (!adminToken) {
      setErrorMessage('缺少管理令牌：请通过 /admin?token=... 访问本页面。')
      return
    }

    setLoadingAccounts(true)
    setErrorMessage(null)
    try {
      const data = await adminFetch<{ accounts: AdminAccountView[] }>('/api/admin/accounts')
      setAccounts(data.accounts ?? [])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载账户列表失败')
    } finally {
      setLoadingAccounts(false)
    }
  }, [adminFetch, adminToken])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAccounts()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loadAccounts])

  const onUpdateStatus = useCallback(
    async (accountKey: string, status: 'approved' | 'rejected') => {
      setMutating(true)
      setErrorMessage(null)
      setInfoMessage(null)
      try {
        await adminFetch(`/api/admin/accounts/${encodeURIComponent(accountKey)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        })
        setInfoMessage(`账户 ${accountKey} 已更新为「${accountStatusLabel(status)}」。`)
        await loadAccounts()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '更新账户状态失败')
      } finally {
        setMutating(false)
      }
    },
    [adminFetch, loadAccounts],
  )

  const onDeleteAccount = useCallback(
    async (accountKey: string) => {
      if (!window.confirm(`确定删除账户 ${accountKey}？其 WebDAV 凭据、会话与身份映射都会被清除。`)) {
        return
      }

      setMutating(true)
      setErrorMessage(null)
      setInfoMessage(null)
      try {
        const result = await adminFetch<{ identityFileRemoved?: boolean }>(
          `/api/admin/accounts/${encodeURIComponent(accountKey)}`,
          { method: 'DELETE' },
        )
        setInfoMessage(
          `账户 ${accountKey} 已删除。身份文件清理：${
            result.identityFileRemoved
              ? '已从网盘根目录删除'
              : '未执行（文件已不存在或 Cookie 已失效），如有残留请自行删除网盘根目录的 dav-id.txt'
          }。`,
        )
        await loadAccounts()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '删除账户失败')
      } finally {
        setMutating(false)
      }
    },
    [adminFetch, loadAccounts],
  )

  return (
    <main className={pageStyles.base()}>
      <header>
        <h1 className={pageStyles.title()}>账户审核与管理</h1>
        <p className={pageStyles.subtitle()}>管理 WebDAV 账户的准入：批准、拒绝或删除</p>
      </header>

      <div className={notice({ intent: 'warning' })}>
        本页面受 TOKEN 保护，但令牌会出现在地址栏中。请勿把带 token 的链接转发给他人，使用后建议清理浏览器历史。
      </div>

      {errorMessage ? (
        <div className={notice({ intent: 'error' })} role="alert">
          {errorMessage}
        </div>
      ) : null}

      {infoMessage ? <div className={notice()}>{infoMessage}</div> : null}

      <section className={cardStyles.base()}>
        <div className={cardStyles.header()}>
          <h2 className={cardStyles.title()}>账户列表</h2>
          <button
            className={button({ intent: 'ghost' })}
            onClick={() => void loadAccounts()}
            disabled={loadingAccounts || mutating}
          >
            {loadingAccounts ? '刷新中...' : '刷新列表'}
          </button>
        </div>

        {accounts.length === 0 ? (
          <p className={cardStyles.footnote()}>暂无账户记录。</p>
        ) : (
          <div className="grid gap-[12px]">
            {accounts.map((account) => (
              <article className="flex flex-wrap gap-[12px] justify-between items-start border border-solid border-border rounded-[12px] p-[12px]" key={account.accountKey}>
                <div className="grid gap-[4px] min-w-[240px] flex-1">
                  <strong>{account.nickname ?? '(未获取到昵称)'}</strong>
                  <span className="text-heading text-[13px]">状态：{accountStatusLabel(account.status)}</span>
                  <span className="text-heading text-[13px]">WebDAV 用户名：{account.username ?? '-'}</span>
                  <span className="text-heading text-[13px]">注册时间：{account.registeredAt}</span>
                  <span className="text-heading text-[13px]">最近登录：{account.lastLoginAt}</span>
                  <span className="text-heading text-[13px] truncate" title={account.accountKey}>
                    账户标识：{account.accountKey}
                  </span>
                </div>
                <div className="flex flex-wrap gap-[8px]">
                  {account.status !== 'approved' ? (
                    <button
                      className={button()}
                      onClick={() => void onUpdateStatus(account.accountKey, 'approved')}
                      disabled={mutating}
                    >
                      批准
                    </button>
                  ) : null}
                  {account.status !== 'rejected' ? (
                    <button
                      className={button({ intent: 'ghost' })}
                      onClick={() => void onUpdateStatus(account.accountKey, 'rejected')}
                      disabled={mutating}
                    >
                      拒绝
                    </button>
                  ) : null}
                  <button
                    className={button({ intent: 'danger' })}
                    onClick={() => void onDeleteAccount(account.accountKey)}
                    disabled={mutating}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
