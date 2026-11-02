# WebDAV-on-Quark

把夸克网盘以 WebDAV 形式暴露给客户端、并为每个使用者提供独立 WebDAV 凭据的 Worker 服务。

## Language

**Quark identity（夸克身份）**:
一个夸克使用者在本系统中的唯一稳定标识，即其身份文件所携带的身份 key。账户归属由它唯一决定。
_Avoid_: accountKey（旧义：cookie 派生值）、uid、nickname

**Account（账户）**:
WebDAV 凭据与网盘访问权的归属单位，与夸克身份一一对应。
_Avoid_: user、profile、账号（口语混用）

**Quark session（夸克会话）**:
一组可轮换的夸克 cookie，只证明访问权，不代表身份。重新登录刷新会话，不产生新账户。
_Avoid_: cookie session、登录态

**WebDAV credentials（WebDAV 凭据）**:
WebDAV 客户端使用的用户名/密码，恰好映射到一个账户。
_Avoid_: dav 密码、登录信息

**Auth channel（鉴权通道）**:
WebDAV 凭据的两种使用方式：客户端通道（401 时携带挑战信号，由客户端接管输入）与控制台 API 通道（显式携带凭据头，绝不携带挑战信号，否则浏览器会弹出原生认证框）。
_Avoid_: 登录方式

**Identity key（身份 key）**:
注册时生成的随机凭证值，是夸克身份的载体；持有者即被认定为该账户的主人。
_Avoid_: token、邀请码

**Identity file（身份文件）**:
网盘根目录中承载身份 key 的标记文件。凭证级资产：不得分享、转存或删除。
_Avoid_: 标记文件、key 文件

**Registration（注册）**:
首次登录时生成身份 key、写入身份文件并创建待审核账户的过程。
_Avoid_: 开户、激活

**Approval（审核）**:
管理员对注册产生的待审核账户作出的准入裁决。审核通过后 WebDAV 凭据才可用。
_Avoid_: 批准（口语）、授权

**会话获取途径（Session acquisition path）**:
获得或刷新夸克会话的途径，目前有扫码登录与一键登录两种。只影响会话来源，不影响账户生命周期。
_Avoid_: 登录方式（该词留给 Auth channel）

**扫码登录（QR sign-in）**:
会话获取途径之一：通过夸克手机 App 扫码，把手机上的夸克身份转换为本系统可用的夸克会话。
_Avoid_: 扫码、二维码登录（口语）

**一键登录（One-click sign-in）**:
会话获取途径之一：通过本机夸克浏览器的桌面桥，把浏览器中已登录的夸克身份转换为夸克会话。同一夸克身份得到的仍是同一账户的会话。
_Avoid_: 自动登录、快捷登录

**桌面桥（Desktop bridge）**:
夸克浏览器内置的本机服务，是桌面端夸克身份转换为夸克会话的出入口；只对其自家网页源开放跨域读取。
_Avoid_: 本地接口、9128 服务
