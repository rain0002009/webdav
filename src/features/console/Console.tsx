import { QRCodeSVG } from 'qrcode.react'
import { accountStatusLabel } from '../../lib/account-status'
import { button, card, code, details, field, input, notice, page } from '../../lib/styles'
import { qr } from './styles'
import { useConsoleSession } from './useConsoleSession'

const pageStyles = page()
const cardStyles = card()
const detailStyles = details()
const qrStyles = qr()

export default function Console() {
  const {
    session,
    cookieInput,
    setCookieInput,
    qrState,
    qrStatus,
    loadingSession,
    startingQr,
    pollingQr,
    savingCookie,
    savingWebDavCredentials,
    webdavUsernameInput,
    setWebdavUsernameInput,
    webdavPasswordInput,
    setWebdavPasswordInput,
    errorMessage,
    infoMessage,
    webdavEndpoint,
    loadSession,
    onStartQrLogin,
    onPollQrStatus,
    onSaveCookie,
    onLogout,
    onSaveWebDavCredentials,
    isBusy,
  } = useConsoleSession()

  const qrRequestId = qrStatus?.requestId ?? qrState?.requestId
  const qrUrl = qrStatus?.qrUrl ?? qrState?.qrUrl
  const qrToken = qrStatus?.qrToken ?? qrState?.qrToken
  const qrExpiresAt = qrStatus?.expiresAt ?? qrState?.expiresAt
  const qrCurrentStatus = qrStatus?.status
  const qrError = qrStatus?.error
  const hasQrPayload = Boolean(qrUrl || qrToken || qrRequestId)
  const qrValue = qrUrl ?? qrToken ?? ''
  const qrCanRender = qrValue.length > 0

  return (
    <main className={pageStyles.base()}>
      <header>
        <h1 className={pageStyles.title()}>夸克网盘 WebDAV 控制台</h1>
        <p className={pageStyles.subtitle()}>用于管理 Worker 桥接会话与登录状态</p>
      </header>

      <div className={notice({ intent: 'warning' })}>
        ⚠️ 重要：登录后你的网盘根目录会生成 <code className={code()}>dav-id.txt</code>（身份文件），它就是你的 WebDAV 登录凭证。请勿分享、转存、修改或删除该文件，否则账户可能被他人接管，或需要重新注册并等待审核。
      </div>

      {errorMessage ? (
        <div className={notice({ intent: 'error' })} role="alert">
          {errorMessage}
        </div>
      ) : null}

      {infoMessage ? <div className={notice()}>{infoMessage}</div> : null}

      <section className={cardStyles.base()}>
        <div className={cardStyles.header()}>
          <h2 className={cardStyles.title()}>连接与会话状态</h2>
          <button className={button({ intent: 'ghost' })} onClick={() => void loadSession()} disabled={isBusy}>
            {loadingSession ? '刷新中...' : '刷新状态'}
          </button>
        </div>
        <dl className={detailStyles.base()}>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>WebDAV 地址</dt>
            <dd className={detailStyles.value()}>
              <code className={code()}>{webdavEndpoint}</code>
            </dd>
          </div>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>认证状态</dt>
            <dd className={detailStyles.value()}>{session?.loggedIn ? '已登录' : '未登录'}</dd>
          </div>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>账户状态</dt>
            <dd className={detailStyles.value()}>{accountStatusLabel(session?.accountStatus)}</dd>
          </div>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>夸克昵称</dt>
            <dd className={detailStyles.value()}>{session?.user ?? '-'}</dd>
          </div>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>会话过期时间</dt>
            <dd className={detailStyles.value()}>{session?.expiresAt ?? '-'}</dd>
          </div>
          <div className={detailStyles.item()}>
            <dt className={detailStyles.term()}>网盘错误</dt>
            <dd className={detailStyles.value()}>{session?.error ?? '-'}</dd>
          </div>
        </dl>
        <p className={cardStyles.footnote()}>
          使用方式：在 WebDAV 客户端把上方地址作为“服务器地址”；用户名和密码请填写在客户端的认证字段中，不要写成
          <code className={code()}>https://user:pass@host/dav</code> 这类 URL。
        </p>
      </section>

      {session?.loggedIn ? (
        <section className={cardStyles.base()}>
          <div className={cardStyles.header()}>
            <h2 className={cardStyles.title()}>WebDAV 凭据</h2>
            <button className={button()} onClick={onSaveWebDavCredentials} disabled={isBusy}>
              {savingWebDavCredentials ? '保存中...' : '保存凭据'}
            </button>
          </div>
          <p className={cardStyles.footnote()}>
            当前登录的夸克账户会自动绑定一组 WebDAV 用户名和密码。这里显示的是当前有效凭据，你可以直接修改并保存。
          </p>
          {session?.accountStatus === 'pending' ? (
            <div className={notice({ intent: 'warning' })}>
              当前账户处于待审核状态：凭据已生成但尚未激活，WebDAV 客户端连接会被拒绝，直到管理员审核通过。
            </div>
          ) : null}
          {session?.accountStatus === 'rejected' ? (
            <div className={notice({ intent: 'error' })}>
              当前账户已被拒绝：WebDAV 访问已停用。如有疑问请联系管理员。
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-[12px] mt-[14px] max-[720px]:grid-cols-1">
            <label className={field({ inline: true })} htmlFor="webdav-username-input">
              <span className="block mb-[8px]">WebDAV 用户名</span>
              <input className={input()}
                id="webdav-username-input"
                type="text"
                value={webdavUsernameInput}
                onChange={(event) => setWebdavUsernameInput(event.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className={field({ inline: true })} htmlFor="webdav-password-input">
              <span className="block mb-[8px]">WebDAV 密码</span>
              <input className={input()}
                id="webdav-password-input"
                type="text"
                value={webdavPasswordInput}
                onChange={(event) => setWebdavPasswordInput(event.target.value)}
                disabled={isBusy}
              />
            </label>
          </div>
        </section>
      ) : null}

      {!session?.loggedIn ? (
        <>
          <section className={cardStyles.base()}>
            <div className={cardStyles.header()}>
              <h2 className={cardStyles.title()}>二维码登录</h2>
              <div className={cardStyles.actions()}>
                <button className={button()} onClick={onStartQrLogin} disabled={isBusy}>
                  {startingQr ? '启动中...' : '开始二维码登录'}
                </button>
                <button className={button({ intent: 'ghost' })} onClick={onPollQrStatus} disabled={isBusy}>
                  {pollingQr ? '查询中...' : '查询扫码状态'}
                </button>
              </div>
            </div>

            <div className={qrStyles.layout()}>
              <article className={qrStyles.visual()} aria-live="polite">
                {qrCanRender ? (
                  <>
                    <div className={qrStyles.badge()}>可扫码二维码</div>
                    <div className={qrStyles.frame()}>
                      <QRCodeSVG
                        value={qrValue}
                        size={176}
                        marginSize={3}
                        bgColor="transparent"
                        fgColor="currentColor"
                        className="block"
                      />
                    </div>
                    <p className={qrStyles.hint()}>
                      这是根据当前后端真实返回的链接/令牌生成的二维码。你现在至少可以扫码看到对应内容，但这不代表后端已经打通真实夸克扫码登录回调。
                    </p>
                    {qrUrl ? (
                      <a
                        className={qrStyles.link()}
                        href={qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={qrUrl}
                      >
                        在新窗口打开扫码链接
                      </a>
                    ) : null}
                    <div className={qrStyles.url()} title={qrValue}>
                      {qrValue}
                    </div>
                  </>
                ) : hasQrPayload ? (
                  <>
                    <div className={qrStyles.badge()}>已收到登录上下文</div>
                    <p className={qrStyles.hint()}>已拿到请求标识或令牌，但当前数据还不足以生成二维码。请继续点击“查询扫码状态”确认登录进度。</p>
                  </>
                ) : (
                  <>
                    <div className={qrStyles.placeholder()} aria-hidden="true">
                      <span className={qrStyles.marker({ class: 'top-[10px] left-[10px]' })} />
                      <span className={qrStyles.marker({ class: 'top-[10px] right-[10px]' })} />
                      <span className={qrStyles.marker({ class: 'bottom-[10px] left-[10px]' })} />
                    </div>
                    <p className={qrStyles.hint()}>点击“开始二维码登录”后，若后端仅返回链接或令牌，这里会展示真实返回内容与限制说明。</p>
                  </>
                )}
              </article>

              <dl className={detailStyles.base({ class: 'content-start' })}>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>请求 ID</dt>
                  <dd className={detailStyles.value()}>{qrRequestId ?? '-'}</dd>
                </div>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>二维码状态</dt>
                  <dd className={detailStyles.value()}>{qrCurrentStatus ?? '-'}</dd>
                </div>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>二维码链接</dt>
                  <dd className={detailStyles.value({ class: 'truncate' })}>{qrUrl ?? '-'}</dd>
                </div>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>二维码令牌</dt>
                  <dd className={detailStyles.value({ class: 'truncate' })}>{qrToken ?? '-'}</dd>
                </div>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>失效时间</dt>
                  <dd className={detailStyles.value()}>{qrExpiresAt ?? '-'}</dd>
                </div>
                <div className={detailStyles.item()}>
                  <dt className={detailStyles.term()}>最近错误</dt>
                  <dd className={detailStyles.value()}>{qrError ?? '-'}</dd>
                </div>
              </dl>
            </div>

            <p className={cardStyles.footnote()}>说明：页面现在会把后端返回的链接或令牌渲染成可扫码二维码，但真实夸克扫码成功回调仍未接通；如果扫码后没有自动登录，这不是你的操作问题，而是后端链路还在开发中。</p>
          </section>

          <section className={cardStyles.base()}>
            <div className={cardStyles.header()}>
              <h2 className={cardStyles.title()}>手动 Cookie 兜底</h2>
              <button className={button()} onClick={onSaveCookie} disabled={isBusy}>
                {savingCookie ? '保存中...' : '保存 Cookie'}
              </button>
            </div>
            <label className={field()} htmlFor="cookie-input">
              Cookie 字符串
            </label>
            <textarea className={input({ multiline: true })}
              id="cookie-input"
              value={cookieInput}
              onChange={(event) => setCookieInput(event.target.value)}
              rows={4}
              placeholder="粘贴完整 Cookie Header 值"
              disabled={isBusy}
            />
          </section>
        </>
      ) : null}

      {session?.loggedIn ? (
        <section className={cardStyles.base({ intent: 'danger' })}>
          <div className={cardStyles.header()}>
            <h2 className={cardStyles.title()}>退出登录</h2>
            <button className={button({ intent: 'danger' })} onClick={onLogout} disabled={isBusy}>
              退出登录
            </button>
          </div>
          <p>退出当前浏览器的控制台登录，WebDAV 服务将继续运行。</p>
        </section>
      ) : null}
    </main>
  )
}
