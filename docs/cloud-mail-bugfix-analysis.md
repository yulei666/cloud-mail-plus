# `cloud-mail` 后期 Bugfix 与 `cloud-mail-plus` 差异及迁移分析报告 (修订版)

> **生成与修订时间**：2026-09-24  
> **对比基准**：
> - 上游主仓：`cloud-mail`（分支：`main`，最新提交：`ec7a2bb`）
> - 本地衍生仓：`cloud-mail-plus`（分支：`feat/ai-agent-enhancements`，最新提交：`c1a3059`）
> - 分叉点提交：`2026-04-06` 提交 `24a4e93` / `a7b45d0` (`fix: repair failed user check for email favorites`)

---

## 目录
1. [基线与分叉背景](#一-基线与分叉背景)
2. [分析结论矩阵总览](#二-分析结论矩阵总览)
3. [存在且必须修复的安全漏洞与缺陷 (P0 / P1)](#三-存在且必须修复的安全漏洞与缺陷-p0--p1)
   - [3.1 用户恢复接口越权漏洞与权限树未授权访问 (P0)](#31-用户恢复接口越权漏洞与权限树未授权访问-p0)
   - [3.2 Plus 子地址抢注导致邮件窃听漏洞 (P0)](#32-plus-子地址抢注导致邮件窃听漏洞-p0)
   - [3.3 用户修改密码长度校验失效漏洞 (P1)](#33-用户修改密码长度校验失效漏洞-p1)
   - [3.4 HTML 模板字符串注入与渲染崩溃 (P1)](#34-html-模板字符串注入与渲染崩溃-p1)
   - [3.5 Telegram 消息超长导致推送崩溃 (P1)](#35-telegram-消息超长导致推送崩溃-p1)
   - [3.6 角色服务空指针容错、OAuth silenced 取反与全部邮件伪并发 (P1/P2)](#36-角色服务空指针容错oauth-silenced-取反与全部邮件伪并发-p1p2)
4. [Cloudflare D1 性能、稳定性与业务破坏缺陷 (P0 / P1)](#四-cloudflare-d1-性能稳定性与业务破坏缺陷-p0--p1)
   - [4.1 🚨 每日定时任务将 AI 草稿误改为已收邮件 (plus 重大 Bug 与 completeReceiveAll 改造) (P0)](#41--每日定时任务将-ai-草稿误改为已收邮件-plus-重大-bug-与-completereceiveall-改造-p0)
   - [4.2 补齐 D1 核心复合索引与部分索引条件陷阱 (P1)](#42-补齐-d1-核心复合索引与部分索引条件陷阱-p1)
   - [4.3 数据统计查询负时区 Bug 与全表扫描优化 (P1)](#43-数据统计查询负时区-bug-与全表扫描优化-p1)
   - [4.4 批量操作 SQLite 变量超限：后端分块保障 (P1)](#44-批量操作-sqlite-变量超限后端分块保障-p1)
   - [4.5 站内互发信 Plus 地址回退机制 (P2)](#45-站内互发信-plus-地址回退机制-p2)
5. [体验与交互细节缺陷 (P2)](#五-体验与交互细节缺陷-p2)
   - [5.1 系统设置 Telegram Token 掩码展示与前端联动脱敏 (P2)](#51-系统设置-telegram-token-掩码展示与前端联动脱敏-p2)
   - [5.2 弹窗表单回车触发整页刷新与快捷回车提交 (P2)](#52-弹窗表单回车触发整页刷新与快捷回车提交-p2)
   - [5.3 系统设置保存竞态与空配置覆盖 (P2)](#53-系统设置保存竞态与空配置覆盖-p2)
   - [5.4 暗黑模式列表行右键高亮底色适配 (P2)](#54-暗黑模式列表行右键高亮底色适配-p2)
6. [无需迁移 / 不适用内容说明](#六-无需迁移--不适用内容说明)
7. [迁移实施路线与检查清单](#七-迁移实施路线与检查清单)

---

## 一、 基线与分叉背景

`cloud-mail-plus` 在 2026 年 4 月基于 `cloud-mail` 进行分叉开发。在此之后，两套代码库走向了不同的演进路径：

1. **`cloud-mail-plus` 的独立自研演进**：
   - 实现了基于 Vercel AI SDK 的 **AI Email Agent 智能代理** 与服务端草稿持久化。
   - 实现了基于 Workers AI 的 **邮件多语言实时翻译与 D1 级联缓存**。
   - 彻底重构了出站发信模块：使用 **RFC 5322 Raw MIME 协议流** 重建了二进制附件和内联图片组装，替代了上游脆弱的结构化发信。
   - 增加了 **反钓鱼凭证窃取检测（Heuristic Phishing Filter）**、**邮件 ZIP/EML 导出** 以及 **邮件物理删除与 R2 资源级联清理**。

2. **`cloud-mail` 上游的后期演进**：
   - 累计提交了 80 余个 commit。
   - 重点修复了一批初期遗留的安全鉴权盲区、输入验证失效以及类型逻辑 Bug。
   - 针对 Cloudflare D1 数据库执行计划和成本，进行了深度索引和查询优化。
   - 尝试对前端邮件列表和正文做懒加载拆分（但在上游引入了若干次生 Bug）。

---

## 二、 分析结论矩阵总览

| 模块 / 类别 | 严重级别 | 上游对应 Commit | `cloud-mail-plus` 是否存在 | 迁移必要性 | 核心影响与修复要点 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **定时任务篡改草稿状态** | **P0 严重业务破坏** | 强相关 `a8c9ae3`/`5ea856b` | **是 (plus 特有缺陷)** | **必须修复** | 每天 16:00 UTC 执行 `completeReceiveAll` 把 `status=6` 的草稿改为 `status=0 (已接收)`，草稿箱被清空且再无法发送；需在两条 SQL 中加 `AND type = 0` 保护，并对历史已被改坏的草稿执行数据订正恢复。 |
| **`/user/restore` 鉴权缺失** | **P0 严重安全** | `8b563c5` | **是** | **必须迁移** | 普通登录用户可直接恢复已软删除的用户及其邮件和账号。在 `security.js` 补上路由与权限映射。 |
| **`/role/permTree` 路由不匹配** | **P0 严重安全** | 同 `8b563c5` | **是** | **必须迁移** | 路由为 `/role/permTree` 但白名单拦截写为 `/role/tree`，导致任意登录用户可免鉴权读取完整权限树。统一更名为 `/role/tree`。 |
| **Plus 子地址越权抢注** | **P0 严重安全** | `b2d42ea` | **是** | **必须迁移** | 精确匹配优先于降级回退，普通用户注册 `admin+xxx@` 会直接截获管理员邮件。邮箱添加严格要求主地址存在且属于当前用户；注册与管理员添加用户直接禁止使用带 `+` 的子地址格式。 |
| **修改密码长度校验失效** | **P1 核心安全** | `a54ae42` | **是** | **必须迁移** | `resetPassword` 错误使用 `password < 6`，字母及纯数字短密码均可绕过限制。需改为 `.length < 6` 并补齐 30 位上限检查。 |
| **HTML 模板字符串注入** | **P1 稳定性/代码执行** | `b62deec` | **是** | **已就绪/待合入 XSS 分支 ✅** | Telegram 查看页邮件含 `${}` 触发任意代码执行及反引号崩溃。采用 `JSON.stringify(html).replace(/</g, '\\u003C')` 转义。(工作区已就绪并通过单测，统一合入 XSS 分支；innerHTML 引发的 DOM XSS 亦由该分支专项处理) |
| **TG 推送消息长度超限** | **P1 稳定性** | `bd0410d` | **是** | **必须迁移** | 长邮件超 4096 字符导致 Telegram API 400 报错，消息推送丢失。增加 3500 字符截断与 HTML 转义。 |
| **统计查询负时区 Bug 与全表扫描** | **P1 功能与性能**| `a8c9ae3` | **是** | **强烈建议** | `'+-5 hours'` 语法错误导致西区管理员图表空白；`DATE(create_time)` 导致全表扫描。引入 `tzModifiers` 并按日期区间查询。已决定迁移前缀匹配 `LIKE ${email + '%'}` 充分利用索引。 |
| **批量操作 SQLite 变量超限**| **P1 稳定性** | `e7dfed2` | **是** | **建议迁移** | 全量覆盖后端全部 7 处（`email-service.js:144, 640-644, 911`、`email-api.js`、`external-api.js`）`inArray(emailIds)`。前端限制 95 封，**后端必须补充分块（chunking）保底**。 |
| **补齐 D1 核心复合索引** | **P1 性能优化** | `55110ee` 等 | **是** | **强烈建议** | 缺少列表分页、星标、时间排序复合索引。在新增的 `v3_4DB` 迁移中补齐 22 个复合索引（上游共 23 个，`idx_email_user_id_account_id` 在 plus 已有；补回 `idx_email_create_time` 与 `idx_oauth_user_id`），仅对 `idx_email_saving_account` 增加 `WHERE status=6 AND type=0` 约束。 |
| **Telegram Token 脱敏与前端联动**| **P2 安全/防覆盖** | `b62deec` | **是** | **建议迁移** | 掩码保留前 6-8 位；**必须联动修改前端**：`change()` 过滤 `tgBotToken`，避免带掩码写回覆盖真实 Token。 |
| **站内互发信 Plus 回退** | **P2 业务完善** | `b2d42ea` | **是** | **建议迁移** | 站内信发往 `user+tag@domain` 时，精确查不到则调用 `emailUtils.getBaseEmail` 回退到 `user@domain` 投递。 |
| **全部邮件伪并发查询** | **P2 性能优化** | `5c8c8a6` | **是** | **建议优化** | 管理员 `allList` 查询中提前 `await` 破坏 Promise.all 并发。 |
| **角色服务空指针与 OAuth 取反** | **P2 逻辑健壮** | `5c8c8a6` | **是** | **建议优化** | 修复 `!userIds || userIds.length === 0` 及 `userInfo.silenced` 取反赋值错误。 |
| **设置页表单回车防刷新** | **P2 交互体验** | `a42f0cc` | **是** | **建议优化** | 在 `sys-setting` 的全部 8 个 `<form>` 增加 `@submit.prevent`，并在输入框绑定 `@keyup.enter`。 |
| **暗黑模式高亮配色** | **P2 视觉体验** | `c75884b` | **是** | **建议优化** | 邮件列表右键高亮改用 CSS 变量 `--email-right-click-background`。 |
| **OAuth 平台动态展示** | **-** | `7c7c077` | **不适用** | **无需迁移** | plus 目前仅对接 LinuxDo，数据库无 `platform` 字段，硬编码展示 "L" 是正确的。 |
| **列表懒加载衍生 Bug 组** | **-** | `ec7a2bb`, `4770960`, `ee7eb51` | **否** | **禁止盲目迁移** | 上游改造列表导致的衍生 Bug，plus 未做列表裁剪，迁移会破坏回复/展示。 |
| **发件 MIME / ArrayBuffer** | **-** | `6cf3d04`, `868d736` | **不适用** | **无需迁移** | plus 已采用更完善的 RFC 5322 Raw MIME 独立实现。 |

---

## 三、 存在且必须修复的安全漏洞与缺陷 (P0 / P1)

### 3.1 用户恢复接口越权漏洞与权限树未授权访问 (P0)
- **上游修复**：Commit `8b563c5` (`fix: permission vulnerability`)
- **文件位置**：
  - 安全鉴权层：[`mail-worker/src/security/security.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/security/security.js)
  - 角色接口层：[`mail-worker/src/api/role-api.js#L22`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/api/role-api.js#L22)
  - 前端请求层：[`mail-vue/src/request/role.js#L8`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/request/role.js#L8)
- **问题分析**：
  1. **`/user/restore` 鉴权缺失**：
     `user-api.js` 暴露了 `app.put('/user/restore', ...)`，用于将已软删除的用户恢复为正常状态。如果 `type` 为真值时，还会连同该用户旗下的邮件、账户一同恢复（[`user-service.js:352`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js#L352)）。但 `security.js` 的 `requirePerms` 和 `premKey` 遗漏了该路由，导致普通用户可以任意越权调用，恢复已被注销或封禁的账号及数据。
  2. **`/role/permTree` 路由不匹配导致越权读取权限树**：
     `role-api.js:22` 定义的路由为 `/role/permTree`，但 `security.js` 中配置的路由白名单与鉴权映射均为 `/role/tree`。两者不匹配导致该接口被视为无需特定权限的普通路由，任何普通登录用户均可任意读取系统的完整权限树结构。
- **修复方案**：
  1. 在 `security.js` 中补齐 `/user/restore`：
     ```javascript
     // mail-worker/src/security/security.js
     const requirePerms = [
         ...
         '/user/restore',
     ];
     const premKey = {
         ...
         'user:set-status': ['/user/setStatus', '/user/restore'],
     };
     ```
  2. 将后端路由与前端请求统一改名为 `/role/tree`：
     ```javascript
     // mail-worker/src/api/role-api.js:22
     app.get('/role/tree', async (c) => {
         const tree = await permService.tree(c);
         return c.json(result.ok(tree));
     });
     
     // mail-vue/src/request/role.js:8
     export function permTree() {
         return http.get('/role/tree')
     }
     ```

---

### 3.2 Plus 子地址抢注导致邮件窃听漏洞 (P0)
- **上游修复**：Commit `b2d42ea` (`Plus Address`)
- **文件位置**：
  - 邮箱添加服务：[`mail-worker/src/service/account-service.js#L22`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/account-service.js#L22)
  - 开放注册服务：[`mail-worker/src/service/login-service.js#L68`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/login-service.js#L68)
  - 管理员添加用户：[`mail-worker/src/service/user-service.js#L308`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js#L308)
  - 邮件入站投递：[`mail-worker/src/email/email.js#L42`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/email/email.js#L42)
- **安全风险剖析**：
  - 在邮件入站投递时（`email.js`），逻辑是**精确匹配优先于基准地址降级**：
    ```javascript
    let accountRow = await accountService.selectByEmail(c, address);
    if (!accountRow) {
        // 只有在查不到精确匹配的 account 时，才会尝试截取 baseEmail 投递给主地址
        ...
    }
    ```
  - 如果一个恶意普通用户注册或绑定了管理员或高管的子地址（例如 `admin+billing@domain` 或 `ceo+confidential@domain`）：
    任何外部系统（银行、云厂商、服务平台）发往该子地址的通知邮件，都会因为精确命中而被直接投递进该恶意用户的邮箱，导致极其严重的**凭证泄露与邮件窃听漏洞**！
- **全量修复方案与依赖补齐**：
  1. **公共工具方法迁移与三处统一 (`emailUtils.getBaseEmail`)**：
     严格对齐上游 `b2d42ea` 在 `mail-worker/src/utils/email-utils.js` 中的标准实现。plus 此前未包含此方法（在 `email.js` 里是直接写正则）。本次迁移在 `email-utils.js` 照搬上游实现：
     ```javascript
     getBaseEmail(email) {
         const parts = email.split('@');
         if (parts.length !== 2) return '';
         const localPart = parts[0].split('+')[0];
         return localPart + '@' + parts[1];
     }
     ```
     并将以下三处统一切换为调用该标准工具方法：
     - ① `account-service.js:add`（子地址所有权归属校验）；
     - ② `mail-worker/src/email/email.js`（外部入站邮件加号降级投递）；
     - ③ `mail-worker/src/service/email-service.js` 的 `HandleOnSiteEmail`（4.5 节站内信投递降级回退）。
  2. **i18n 多语言 Key 补齐（拒绝死代码与裸 Key）**：
     - 上游遗漏了 `notOwner` 的多语言配置，导致异常信息直接暴露出裸 key `notOwner`。在 plus 的 `mail-worker/src/i18n/zh.js`（`"notOwner": "无权使用该主邮箱的子地址"`）与 `mail-worker/src/i18n/en.js`（`"notOwner": "You do not own the base email of this sub-address"`）中补全。
     - 为注册和管理员添加用户新增统一 i18n key `subAddressNotAllowed`：`zh.js`（`"subAddressNotAllowed": "不支持使用子地址注册或创建用户"`）、`en.js`（`"subAddressNotAllowed": "Sub-addresses are not allowed for user registration or creation"`），杜绝代码硬编码中文。
  3. **邮箱添加入口 (`account-service.js:add`)**：严格与上游 `b2d42ea` 保持一致，要求主地址**必须存在且必须属于当前用户**：
     ```javascript
     if (email.includes('+')) {
         const baseEmail = emailUtils.getBaseEmail(email);
         const baseAccount = await this.selectByEmailIncludeDel(c, baseEmail);
         if (!baseAccount || baseAccount.userId !== userId) {
             throw new BizError(t('notOwner')); // 基础邮箱不存在或不属于当前用户，一律拦截
         }
     }
     ```
  4. **开放注册入口 (`login-service.js:register`) 与 管理员添加用户入口 (`user-service.js:add`)**：
     - 在 `login-service.js` 的 `register(c, params, oauth = false)` 方法中（注意函数名为 `register`），因 OAuth 登录亦会执行 `register(c, ..., true)`，校验逻辑必须置于最前置公共位置（如邮箱格式校验之后），不受 `oauth` 参数影响：
       ```javascript
       if (email.includes('+')) {
           throw new BizError(t('subAddressNotAllowed'));
       }
       ```
     - 在 `user-service.js:add` 中同样加入此判断，直接阻断新用户使用带 `+` 的子地址建号。

---

### 3.3 用户修改密码长度校验失效漏洞 (P1)
- **上游修复**：Commit `a54ae42` (`fix: validation not working`)
- **文件位置**：[`mail-worker/src/service/user-service.js#L61`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js#L61)
- **问题分析**：
  - 经排查，在用户开放注册（[`login-service.js:60`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/login-service.js#L60)）和管理员添加用户（[`user-service.js:313`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js#L313)）处，均已正确使用了 `password.length < 6`。
  - 唯独在**用户自身修改密码接口** `resetPassword`（[`user-service.js:61`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js#L61)）中，错误写成了：
    ```javascript
    const { password } = params;
    if (password < 6) { // ❌ 错误判断
        throw new BizError(t('pwdMinLength'));
    }
    ```
  - **弱口令绕过**：
    - 字母/符号弱口令：`'abc' < 6` 转换为 `NaN < 6`，其值为 `false`。
    - 纯数字短密码：`'12345' < 6` 转换为 `12345 < 6`，其值为 `false`。
    - 无论传入什么样的 1~5 位短密码，该判断都不会抛出异常！
  - 此外，此处还遗漏了注册时具备的 `password.length > 30` 长度上限防御。
- **修复方案**：
  ```javascript
  if (!password || password.length < 6) {
      throw new BizError(t('pwdMinLength'));
  }
  if (password.length > 30) {
      throw new BizError(t('pwdLengthLimit'));
  }
  ```

---

### 3.4 HTML 模板字符串注入与代码执行漏洞 (P1) [已就绪/待合入 XSS 分支 ✅]
- **上游修复**：Commit `b62deec` (`fix: mask Telegram bot token`)
- **分支归属统一说明**：该项修复已在当前 `feat/ai-agent-enhancements` 工作区中完成修改并通过单元测试（`test/template/email-html.test.js`）。目前尚未独立 commit，其本质属于模板注入与前端执行安全范畴，**后续将统一作为 XSS 与安全防护提交，合入专门的 XSS 分支**。
- **文件位置**：[`mail-worker/src/template/email-html.js#L130`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/template/email-html.js#L130)
- **漏洞准确分析**：
  - `emailHtmlTemplate` 组装生成的是供 Telegram 客户端点击查看邮件详情的 Web 页面（路由为 `/telegram/getEmail/:token`），并非管理端前端页面的 iframe。
  - 原代码在 HTML `<script>` 标签内直接用 ES6 反引号插值拼接：
    ```javascript
    const exampleHtml = `${html}`;
    ```
  - **严重安全危害**：
    1. 若邮件正文中包含 `${...}`，在客户端浏览器解析该 script 脚本时，其内容会**直接当作任意 JavaScript 代码求值并执行**，构成严重的前端代码执行（Template Literal Injection）风险，而绝非仅仅是抛出 ReferenceError；
    2. 若邮件正文包含反引号 \`，会提前闭合模板字面量导致 `SyntaxError` 脚本崩溃；
    3. 若包含 `</script>`，会提前闭合外层 script 标签导致页面结构损坏。
  - **边界说明**：此处的安全修复专注于彻底杜绝 script 标签内的**模板字符串代码执行与语法注入**；对于邮件正文自身包含的恶意 HTML 标签及属性引发的 DOM XSS，由单独的 XSS 分支做专项净化防护。
- **修复方案**：
  ```javascript
  const safeHtmlJson = JSON.stringify(html).replace(/</g, '\\u003C');
  // 模板内去掉反引号，直接引用标准 JS 字符串字面量：
  const exampleHtml = ${safeHtmlJson};
  ```

---

### 3.5 Telegram 消息超长导致推送崩溃 (P1)
- **上游修复**：Commit `bd0410d` (`fix: resolve TG message character limit overflow`)
- **文件位置**：[`mail-worker/src/template/email-msg.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/template/email-msg.js)
- **问题分析**：
  Telegram Bot API 对消息长度有 4096 字符的严格硬性限制。收到较长邮件时，推送接口报 `400 Bad Request`，导致消息推送彻底丢失。此外，邮件发件人或主题中包含未转义的 `<`、`>` 也会导致 TG HTML 解析报错。
- **修复方案**：
  增加长度截断（限制在 3500 字符内，留足格式化空间）与安全 HTML 字符转义：
  ```javascript
  function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function truncateText(str, max = 3500) {
      if (!str) return '';
      return str.length > max ? str.slice(0, max) + '...' : str;
  }
  ```

---

### 3.6 角色服务空指针容错、OAuth silenced 取反与全部邮件伪并发 (P2)
- **上游修复**：Commit `5c8c8a6`
- **问题分析与定位**：
  1. **角色服务防御性判空 (P2)**：[`role-service.js:181`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/role-service.js#L181) 中 `if (!userIds && userIds.length === 0)` 逻辑矛盾。调用方传入的通常是数组，实际触发几率低，建议改为 `if (!userIds || userIds.length === 0)`。
  2. **OAuth `silenced` 取反错误 (P2)**：[`oauth-service.js:73`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/oauth-service.js#L73) 中：
     ```javascript
     userInfo.active = userInfo.active ? 0 : 1;
     userInfo.silenced = userInfo.active ? 0 : 1; // ❌ 错误使用了前面已被反转的 active
     ```
     修复为 `userInfo.silenced = userInfo.silenced ? 0 : 1;`。
  3. **全部邮件查询并发退化 (P2)**：[`email-service.js:777-786`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L777-L786) 的 `allEmail`（管理员界面的“全部邮件”查询）中提前 `await`，破坏了 `Promise.all` 的并行执行能力，导致管理员页面响应延迟翻倍。移除内部 `await` 恢复并发即可。

---

## 四、 Cloudflare D1 性能、稳定性与业务破坏缺陷 (P0 / P1)

### 4.1 🚨 每日定时任务将 AI 草稿误改为已收邮件 (plus 重大 Bug 与 completeReceiveAll 改造) (P0)
- **问题属性**：`cloud-mail-plus` 自身设计与上游定时任务语义冲突导致的 **重大业务破坏缺陷**（与上游 `a8c9ae3` / `5ea856b` 优化改造直接强相关）。
- **文件位置**：
  - 调用入口：[`mail-worker/src/index.js#L36`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/index.js#L36) (`emailService.completeReceiveAll({ env })`)
  - 执行实现：[`mail-worker/src/service/email-service.js#L847-L850`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L847-L850)
  - 草稿定义：[`mail-worker/src/service/email-service.js#L941, L1009`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L941)
- **Bug 根因深度剖析**：
  1. **状态语义冲突**：
     - 在上游 `cloud-mail` 中，`status = 6 (SAVING)` 纯粹表示“外部入站邮件正在写入落盘中”（只在 `email.js` 接收邮件时临时存在，写入完毕即转为 0）。
     - 但在 `cloud-mail-plus` 中，引入了服务端 AI 草稿持久化功能（`saveDraft` / `draftList` / `sendDraft` / `agent/tools.js`），将其复用为“服务端未发送草稿”（标记为 `type = 1 (SEND)` 且 `status = 6 (SAVING)`）。
  2. **定时任务无差别覆盖**：
     - Cloudflare Worker 每天 16:00 UTC 触发 `scheduled` 任务，执行 `completeReceiveAll`：
       ```javascript
       await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.RECEIVE} WHERE status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
       await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.NOONE} WHERE status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
       ```
     - **致命缺陷**：上述两条 UPDATE 语句**完全没有限制邮件的 `type`（收件/发件/草稿）**！
  3. **破坏性后果**：
     - 每天定时任务一触发，所有服务端草稿（无论是由 AI Agent 生成还是用户手动保存的草稿，由于都有绑定的 `account_id`）都会被无差别刷成 `status = 0 (RECEIVE，已接收)`！
     - 前端草稿箱 `draftList` 筛选条件为 `status = 6 AND type = 1`，导致**所有草稿瞬间从草稿箱中永久蒸发**。
     - 该草稿因 `type = 1, status = 0` 会错误混入发件箱中并显示为“已接收”，且用户点击发送时 `sendDraft` 判定 `draft.status !== status.SAVING`，直接报错“草稿不存在”，导致所有草稿永久报废无法再发出。
- **⚠️ 迁移上游 `a8c9ae3` 与 `5ea856b` 时要特别注意的陷阱**：
  1. **`a8c9ae3` 的优化陷阱**：
     上游 `a8c9ae3` 在优化 D1 读行数时重写了 `completeReceiveAll`：
     ```javascript
     // 上游 a8c9ae3 代码:
     await c.env.db.prepare(
         `UPDATE email SET status = ${emailConst.status.RECEIVE}
          WHERE status = ${emailConst.status.SAVING}
            AND EXISTS (SELECT 1 FROM account WHERE account.account_id = email.account_id)`
     ).run();
     await c.env.db.prepare(
         `UPDATE email SET status = ${emailConst.status.NOONE}
          WHERE status = ${emailConst.status.SAVING}` // ⚠️ 上游删除了 NOT EXISTS 校验！
     ).run();
     ```
     **上游去掉了第二条的 `NOT EXISTS`**。如果把上游写法照搬到 `cloud-mail-plus` 且没有限制 `type`，那么未匹配到账号的草稿将直接被刷成 `NOONE (7)`，造成不可逆的破坏！
  2. **`5ea856b` 的索引陷阱**：
     上游创建的部分索引 `CREATE INDEX IF NOT EXISTS idx_email_saving_account ON email(account_id) WHERE status = 6;` 同样基于上游假定。在 plus 中如果创建该索引，必须指定为 `WHERE status = 6 AND type = 0`。
- **修复方案与代码变更**：
  在 [`mail-worker/src/service/email-service.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js) 的 `completeReceiveAll` 中，为两条 UPDATE 语句严格加上 `AND type = ${emailConst.type.RECEIVE}`（即 `type = 0`），使其绝不波及草稿：
  ```javascript
  async completeReceiveAll(c) {
      await c.env.db.prepare(
          `UPDATE email as e
           SET status = ${emailConst.status.RECEIVE}
           WHERE status = ${emailConst.status.SAVING}
             AND type = ${emailConst.type.RECEIVE}
             AND EXISTS (SELECT 1 FROM account WHERE account.account_id = e.account_id)`
      ).run();
      await c.env.db.prepare(
          `UPDATE email as e
           SET status = ${emailConst.status.NOONE}
           WHERE status = ${emailConst.status.SAVING}
             AND type = ${emailConst.type.RECEIVE}
             AND NOT EXISTS (SELECT 1 FROM account WHERE account.account_id = e.account_id)`
      ).run();
  },
  ```

- **历史已被改坏的草稿数据修复**：
  若草稿同步功能此前已上线或被测试过，可能已有部分草稿被历史定时任务改成了 `status = 0 (已接收)` 或 `status = 7 (NOONE)`。
  1. **排查影响量**：
     ```sql
     SELECT COUNT(*) FROM email WHERE type = 1 AND status IN (0, 7);
     ```
  2. **批量订正还原**（恢复为 `status = 6 (草稿)`）：
     ```sql
     UPDATE email SET status = 6 WHERE type = 1 AND status IN (0, 7);
     ```
     此修复可在 `v3_4DB` 迁移中执行，或由运维人员在 D1 控制台执行一次性数据订正。若环境未曾上线草稿同步，可跳过此订正。

---

### 4.2 补齐 D1 核心复合索引与部分索引条件陷阱 (P1)
- **上游标准索引基准**：基于上游 `55110ee` 及其后续演进版本。
- **落地文件**：[`mail-worker/src/init/init.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/init/init.js)（推荐在 plus 中新增 `v3_4DB` 迁移函数承接）。
- **核准后的完整 22 个新增索引列表（上游最新版共 23 个索引，其中 idx_email_user_id_account_id 在 plus 的 v2_4DB 中已存在，故实际需补齐 22 个；补回 idx_email_create_time 与 idx_oauth_user_id；仅对 status=6 增加 AND type = 0 约束）**：
  ```sql
  -- 1. 邮件列表分页核心复合索引 (极其重要，极大降低扫描行数)
  CREATE INDEX IF NOT EXISTS idx_email_list_user ON email(user_id, type, is_del, email_id);
  CREATE INDEX IF NOT EXISTS idx_email_list_account ON email(user_id, account_id, type, is_del, email_id);
  
  -- 2. 星标联查与反查索引
  CREATE INDEX IF NOT EXISTS idx_star_user_email ON star(user_id, email_id);
  CREATE INDEX IF NOT EXISTS idx_star_email_user ON star(email_id, user_id);
  
  -- 3. 不区分大小写的邮件/发件人/收件人搜索索引
  CREATE INDEX IF NOT EXISTS idx_email_name_nocase ON email(name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_email_subject_nocase ON email(subject COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_user_email_nocase ON user(email COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_email_to_email_nocase ON email(to_email COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_email_send_email_nocase ON email(send_email COLLATE NOCASE);
  
  -- 4. 账户排序、邮件类型与时间索引
  CREATE INDEX IF NOT EXISTS idx_account_user_del_sort ON account(user_id, is_del, sort, account_id);
  CREATE INDEX IF NOT EXISTS idx_email_noone_id ON email(email_id) WHERE status = 7;
  CREATE INDEX IF NOT EXISTS idx_email_type_id ON email(type, email_id);
  CREATE INDEX IF NOT EXISTS idx_email_type_name ON email(type, name);
  CREATE INDEX IF NOT EXISTS idx_email_type_create_time ON email(type, create_time);
  CREATE INDEX IF NOT EXISTS idx_email_create_time ON email(create_time);
  
  -- 5. 用户、附件、权限与 OAuth 索引
  CREATE INDEX IF NOT EXISTS idx_user_create_time ON user(create_time);
  CREATE INDEX IF NOT EXISTS idx_user_type ON user(type);
  CREATE INDEX IF NOT EXISTS idx_attachments_email_type ON attachments(email_id, type);
  CREATE INDEX IF NOT EXISTS idx_role_perm_role ON role_perm(role_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_oauth_user_id ON oauth(oauth_user_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth(user_id);
  
  -- 6. ⚠️ 特别注意：必须带上 type = 0 约束的部分索引 (防草稿被误扫描)
  CREATE INDEX IF NOT EXISTS idx_email_saving_account ON email(account_id) WHERE status = 6 AND type = 0;
  ```

---

### 4.3 数据统计查询负时区 Bug 与全表扫描优化 (P1)
- **上游修复**：Commit `a8c9ae3` (`feat: optimize number of rows read`)
- **文件位置**：[`mail-worker/src/dao/analysis-dao.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/dao/analysis-dao.js)、[`mail-worker/src/service/user-service.js`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/user-service.js)
- **深层 Bug 与性能问题分析**：
  1. **西区时区（负偏移）图表空白 Bug**：
     原代码写为 `'+${diffHours} hours'`。当用户的时区位于 UTC 以西（如美东时区 EST 为 UTC-5），`diffHours = -5`，字符串拼成了 `'+-5 hours'`。
     在 SQLite 中执行 `SELECT DATE('now', '+-5 hours')` 时，由于格式非法直接返回 **`NULL`**！导致西区管理员看到的每日统计折线图完全为空。
  2. **全表扫描开销大**：
     原代码在列上使用 `DATE(create_time, ...)`，导致 SQLite 无法使用 `create_time` 上的索引，每次查询都要扫描全表。
  3. **用户前缀搜索行为变更（已决定迁移）**：
     上游在 `a8c9ae3` 中把 `user-service.js:133` 的模糊搜索由 `'%'+ email + '%'`（全子串匹配，强制全表扫描）改成了 `${email + '%'}`（前缀匹配）。本次已明确决定对齐迁移该改动，以充分命中前面新增的 `idx_user_email_nocase` 索引，彻底避免百万级用户搜索时的全表扫描。
- **修复方案**：
  引入 `tzModifiers` 计算合法的 SQLite 时区修饰符，并改用原生列区间匹配：
  ```javascript
  tzModifiers(diffHours) {
      const tzMod = diffHours >= 0 ? `+${diffHours} hours` : `${diffHours} hours`;
      const tzBack = (-diffHours) >= 0 ? `+${-diffHours} hours` : `${-diffHours} hours`;
      return { tzMod, tzBack };
  }
  // 查询改为：
  create_time >= datetime('now', '${tzMod}', 'start of day', '-15 days', '${tzBack}')
  AND create_time < datetime('now', '${tzMod}', 'start of day', '${tzBack}')
  ```

---

### 4.4 批量操作 SQLite 变量超限：后端分块保障 (P1)
- **上游修复**：Commit `e7dfed2` (`feat: limit max selected emails`)
- **文件位置**：
  - 前端虚拟滚动：[`mail-vue/src/components/email-scroll/index.vue`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/components/email-scroll/index.vue)
  - 邮件服务核心（原计划遗漏，本次补齐）：
    1. 用户邮件批量软删除：[`mail-worker/src/service/email-service.js#L144`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L144) (`delete`)
    2. 管理员"全部邮件"批量物理删除：[`mail-worker/src/service/email-service.js#L640-644`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L640) (`physicsDelete`)
    3. 批量标记已读：[`mail-worker/src/service/email-service.js#L911`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L911) (`read`)
  - 邮件接口层：
    4. 批量彻底物理删除：[`mail-worker/src/api/email-api.js#L37`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/api/email-api.js#L37)
    5. 批量导出 ZIP/EML：[`mail-worker/src/api/email-api.js#L109`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/api/email-api.js#L109)
  - 外部开放接口：
    6. 批量删除邮件：[`mail-worker/src/api/external-api.js#L367`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/api/external-api.js#L367)
    7. 批量删除指定账号邮件：[`mail-worker/src/api/external-api.js#L391`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/api/external-api.js#L391)
- **架构级差异与后端分块必须性**：
  - SQLite/D1 对单次 SQL 调用的占位符参数存在默认 100 个的限制。
  - 上游仅在前端限制用户最多勾选 95 封邮件。
  - **但在 `cloud-mail-plus` 中，后端调用 `inArray(emailIds)` 的地方远多于上游**：不仅有普通邮件的删除和标记已读，还有管理员全部邮件物理删除、批量导出 ZIP/EML 以及外部开放 API（external-api）。第三方调用外部 API 或管理员一次性选择大量数据时，完全可以传入几百个 ID，导致数据库直接抛出 `too many SQL variables` 崩溃！
- **修复方案**：
  前端限制 95 封仅作为 UX 引导防线，**后端必须编写通用的分块处理工具函数 `chunkArray`**（每批次最多 80~90 个），对上述所有 7 处 `inArray` 的批处理实行全量分批循环或分批并行处理，从根本上杜绝参数超限崩溃。

---

### 4.5 站内互发信 Plus 地址回退机制 (P2)
- **上游提交**：Commit `b2d42ea`
- **文件位置**：[`mail-worker/src/service/email-service.js#L453`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/email-service.js#L453) (`HandleOnSiteEmail`)
- **问题分析**：
  当站内用户给 `user+shopping@domain` 发信时，系统目前只做精准匹配 `where inArray(account.email, receiveEmail)`。如果接收方没有在后台显式绑定这个具体的 `+shopping` 子地址，站内发信就会因为找不到收件人而静默丢失。
- **修复方案**：
  未命中的收件人自动尝试剥离 `+tag`，回退到主地址匹配投递。

---

## 五、 体验与交互细节缺陷 (P2)

### 5.1 系统设置 Telegram Token 掩码展示与前端联动脱敏 (P2)
- **上游提交**：Commit `b62deec` (`fix: mask Telegram bot token`)
- **文件位置**：
  - 服务端脱敏：[`mail-worker/src/service/setting-service.js#L103`](file:///Users/yulei/workspace/cloud-mail-plus/mail-worker/src/service/setting-service.js#L103)
  - 前端设置页：[`mail-vue/src/views/sys-setting/index.vue#L531, L1064, L1213, L1468`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/views/sys-setting/index.vue)
- **⚠️ 避免空值/掩码覆盖的联动细节**：
  1. **前端必须同步修改**：`sys-setting/index.vue` 在 `change()`（例如点击某个开关）时，会把当前响应式 `setting` 整体提交回后端。如果后端脱敏返回了类似 `123456******`，前端不删掉该字段直接回传，就会把数据库中的真实 Token 永久破坏！
  2. **前端修改要点**：
     - 在 `change()` 中补充 `delete settingForm.tgBotToken;`。
     - 打开 TG 设置弹窗时将输入框清空：`tgBotToken.value = ''`，占位符显示已有掩码。
     - 保存 TG 设置时，仅当 `tgBotToken.value` 非空才加入提交 payload。
  3. **保留位数收缩**：上游保留前 20 位字符，泄露了 Bot ID 与部分密钥。建议在 `setting-service.js` 中收缩为仅保留前 6~8 位（例如 `${token.slice(0, 6)}******`）。

---

### 5.2 弹窗表单回车触发整页刷新与快捷回车提交 (P2)
- **上游提交**：Commit `a42f0cc` (`feat: optimize button event handling`)
- **文件位置**：[`mail-vue/src/views/sys-setting/index.vue`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/views/sys-setting/index.vue)
- **问题分析**：
  经排查，`cloud-mail-plus` 的 `user/index.vue` 中并未使用 `<form>` 标签，全工程的原生 `<form>` 集中在 `sys-setting/index.vue` 的 8 处表单区域（5 个弹窗内）。在输入框内按 Enter 会触发原生表单提交导致页面被强制刷新。
- **修复方案**：
  1. 将 `sys-setting/index.vue` 中的 `<form>` 改为 `<form @submit.prevent>`。
  2. 给各弹窗核心输入框绑定 `@keyup.enter` 快捷触发保存动作。

---

### 5.3 系统设置保存竞态与空配置覆盖 (P2)
- **上游提交**：Commit `f2ef215` (`fix: resolve system settings display refresh bug`)
- **文件位置**：[`mail-vue/src/views/sys-setting/index.vue`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/views/sys-setting/index.vue)
- **问题分析**：
  进入设置页时异步拉取配置。在弱网或加载未完成时，若用户快速拨动开关，会触发 `editSetting`，将未初始化的空表单提交至服务端，覆盖数据库中的已有配置。
- **修复方案**：
  增加 `settingReady = ref(false)`，数据加载完成前禁用或拦截配置修改。

---

### 5.4 暗黑模式列表行右键高亮底色适配 (P2)
- **上游提交**：Commit `c75884b` (`fix: dark mode color issues`)
- **文件位置**：[`mail-vue/src/components/email-scroll/index.vue#L57`](file:///Users/yulei/workspace/cloud-mail-plus/mail-vue/src/components/email-scroll/index.vue#L57)
- **问题分析**：
  右键选中邮件行使用了写死的亮黄色背景 `:style="item.rightChecked ? 'background: #FDF6EC' : ''"`，在深色主题下十分刺眼。应替换为 CSS 变量 `--email-right-click-background`。

---

## 六、 无需迁移 / 不适用内容说明

以下上游提交**切勿直接套用或合并**，它们与 `cloud-mail-plus` 当前架构不兼容：

| Commit | 上游内容 | 不迁移的原因与结论 |
| :--- | :--- | :--- |
| **`7c7c077`** | OAuth 平台徽标多平台动态适配 | **对 plus 不适用**。`cloud-mail-plus` 目前仅对接 LinuxDo，数据库 `oauth` 表无 `platform` 字段，前端硬编码展示 "L" 标签完全符合当前设计。只有未来引入上游多平台 OAuth（`b65e77f...f9ddd7b`, `1880d50`）时才需处理。 |
| **`ec7a2bb`** | `fix: quoted email showing as undefined when replying` | 上游在 commit `c31d882` 中裁剪了列表返回字段（不返回邮件 content），导致回复时从列表取不到正文产生 undefined。**`cloud-mail-plus` 并未做该裁剪**，列表对象始终包含完整正文，盲目套用上游针对 `detailMap` 的补丁反而会导致回复功能故障。 |
| **`4770960`** | `fix: blank email detail after auto-refresh` | 同上。上游列表重构导致刷新时正文被清空的衍生 Bug，`cloud-mail-plus` 不受影响。 |
| **`ee7eb51`** | `fix: email read status not working` | 同上。由于详情异步懒加载导致未读变已读的时序 Bug，在 `cloud-mail-plus` 中不存在。 |
| **`a8c9ae3` (部分)** | `completeReceiveAll` 移除 `NOT EXISTS` 的改写 | **不可直接照搬**。上游假设 `status=6` 仅代表外部收件，去掉了 `NOT EXISTS`。在 plus 中如果照搬且不限制 `type`，未匹配到账号的草稿会被直接刷成 `NOONE (7)`。必须加上 `AND type = 0` 保护。 |
| **`5ea856b` (部分)** | 部分索引 `WHERE status = 6` | **不可直接照搬**。必须改写为 `WHERE status = 6 AND type = 0`，避免将 `type=1` 的草稿数据纳入入站保存索引。 |
| **`6cf3d04` / `868d736` / `8926c09`** | Cloudflare 邮件发件附件 ArrayBuffer 改造 | `cloud-mail-plus` 早已自研重写出站发信模块（`mail-worker/src/service/cf-email-service.js`），支持纯 RFC 5322 Raw MIME 组装、Base64 编码分块以及内联 CID 图片处理，比上游旧版实现更健壮，无需合并上游代码。 |
| **`5fe5274` / `98968ad`** | AI 验证码提取 JSON 解析与模型更新 | `cloud-mail-plus` 自研了整套多工具 AI Email Agent 与翻译体系，未使用上游的独立验证码识别模块。 |
| **`cced5eb`** | pnpm-workspace 路径修复 | `cloud-mail-plus` 未在子工程维护独立的 `pnpm-workspace.yaml`，不适用。 |

---

## 七、 迁移实施路线与检查清单

### Phase 1: 严重安全漏洞与业务破坏缺陷 (P0 / P1)
- [ ] **1. 修复定时任务篡改草稿 Bug & 订正历史损坏草稿**：
  - 在 `mail-worker/src/service/email-service.js` 的 `completeReceiveAll` 中，为两条 UPDATE 严格加上 `AND type = ${emailConst.type.RECEIVE}`（`type = 0`），彻底阻止每日定时任务篡改草稿。
  - 数据修复：若此前已上线草稿功能，通过 `UPDATE email SET status = 6 WHERE type = 1 AND status IN (0, 7)` 恢复历史被误改成已接收或孤立的草稿。
- [ ] **2. 补齐 `/user/restore` 鉴权**：在 `mail-worker/src/security/security.js` 补充 `/user/restore` 及权限映射。
- [ ] **3. 修正权限树未授权访问**：将 `mail-worker/src/api/role-api.js` 和 `mail-vue/src/request/role.js` 中的 `/role/permTree` 统一更名为 `/role/tree`。
- [ ] **4. 防范 Plus 子地址越权抢注与注册收紧**：
  - 在 `mail-worker/src/utils/email-utils.js` 补齐公共工具方法 `getBaseEmail`，并在 `account-service.js:add`、`mail-worker/src/email/email.js` 和 `email-service.js:HandleOnSiteEmail` 三处统一调用。
  - 在 `mail-worker/src/i18n/zh.js` 和 `mail-worker/src/i18n/en.js` 补齐 `notOwner`，并新增 `subAddressNotAllowed` key（杜绝硬编码中文）。
  - `account-service.add` 严格对齐上游 `!baseAccount || baseAccount.userId !== userId`，拦截抛出 `t('notOwner')`。
  - `login-service.js:register`（置于最前置公共校验处，覆盖自主注册与 OAuth 注册）与 `user-service.js:add`（管理员添加用户）入口直接禁止带 `+` 的子地址格式，拦截抛出 `t('subAddressNotAllowed')`。
- [ ] **5. 修正用户修改密码长度校验**：在 `mail-worker/src/service/user-service.js` 的 `resetPassword` 中将 `password < 6` 修正为 `!password || password.length < 6`，并补充 30 位长度上限。
- [x] **6. HTML 模板注入与代码执行防御**：在 `mail-worker/src/template/email-html.js` 引入 `safeHtmlJson` 并使用 Unicode 转义，解决 Telegram 查看页邮件正文含 `${}` 触发任意代码执行及反引号崩溃。（*注：修改及单测已在当前工作区就绪，作为模板注入与执行防护统一合入专门的 XSS 分支；innerHTML 导致的 DOM XSS 亦由该分支专项处理*）。
- [ ] **7. Telegram 消息溢出截断**：在 `mail-worker/src/template/email-msg.js` 加入 3500 字符上限截断与 HTML 转义。

### Phase 2: D1 性能、稳定性与后端分块保底
- [ ] **8. 补齐 D1 复合索引 (v3_4DB)**：在 `mail-worker/src/init/init.js` 新增 `v3_4DB`，完整补齐 22 个新增索引（上游共 23 个，`idx_email_user_id_account_id` 在 plus 的 `v2_4DB` 已建；补回 `idx_email_create_time` 和 `idx_oauth_user_id`）；对 `idx_email_saving_account` 保持增加 `AND type = 0` 约束。
- [ ] **9. 修复统计查询负时区 Bug、索引区间优化与前缀搜索迁移**：
  - 在 `mail-worker/src/dao/analysis-dao.js` 引入 `tzModifiers` 解决西区时区图表空白，改用原生列区间匹配消除全表扫描；
  - **已决定迁移前缀匹配**：将 `user-service.js:133` 改为 `LIKE ${email + '%'}`，充分利用新补齐的 `idx_user_email_nocase` 索引加速搜索。
- [ ] **10. 批量操作后端分块全覆盖保底**：
  - 编写通用 `chunkArray` 函数；
  - 全量覆盖后端全部 7 处 `inArray(emailIds)` 调用：
    1. 用户邮件删除：`email-service.js:144`；
    2. 管理员全部邮件批量物理删除：`email-service.js:640-644`；
    3. 批量标记已读：`email-service.js:911`；
    4. 邮件物理删除与级联清理：`email-api.js:37`；
    5. 邮件批量导出 ZIP/EML：`email-api.js:109`；
    6. 外部 API 批量删除：`external-api.js:367`；
    7. 外部 API 批量清空账号邮件：`external-api.js:391`。
  - 前端虚拟滚动 `email-scroll/index.vue` 设置 95 封选择上限。
- [ ] **11. 站内信 Plus 地址回退投递**：在 `HandleOnSiteEmail` 中调用 `emailUtils.getBaseEmail` 增加剥离 `+tag` 回退到基准邮箱的投递逻辑。
- [ ] **12. 全部邮件查询并发优化**：在 `email-service.js` 的 `allEmail` 中移除伪异步内部阻塞 await。
- [ ] **13. 角色服务空指针与 OAuth silenced 取反修正**：修复 `role-service.js` 判空及 `oauth-service.js` 状态赋值。

### Phase 3: 设置脱敏与交互体验微调
- [ ] **14. TG Token 脱敏与前端防覆盖**：
  - 后端：在 `setting-service.js` 截取前 6~8 位进行脱敏。
  - 前端：在 `sys-setting/index.vue` 的 `change()` 中 `delete settingForm.tgBotToken`，打开弹窗清空输入框，仅在输入新值时提交。
- [ ] **15. 设置弹窗表单回车防刷新**：在 `sys-setting/index.vue` 的全部 8 个 `<form>` 增加 `@submit.prevent`，并在输入框绑定 `@keyup.enter`。
- [ ] **16. 设置加载竞态防护**：在 `sys-setting/index.vue` 加入 `settingReady` 守卫。
- [ ] **17. 暗黑模式列表右键底色适配**：在 `email-scroll/index.vue` 中修复右键行黄色高亮。
