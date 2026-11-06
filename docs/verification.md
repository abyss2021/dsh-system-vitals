# 安装 / 启动 / 卸载验证记录

这份记录回答一个问题：**把 `dsh-system-vitals` 装进一个干净的一次性 profile，
Host 半侧真的会开始采样、Client 半侧真的会出现在输入框工具行里、卸载后真的会消失吗。**

测试环境：

| 项 | 值 |
| --- | --- |
| DSH | `0.2.2-rc.1`（桌面版宿主） |
| Node | `v24.21.0` |
| pnpm | `11.28.5`（DSH 自带 runtime） |
| OS | Windows 11 x64（`platform: win32`） |
| 插件版本 | `1.3.16` |
| 一次性 profile | 空的 `DSH_HOME`，让 `dsh plugin` 自己初始化 `profiles/web` |

命令都在一次性 `DSH_HOME` 里执行，**不碰日常 profile**：

```sh
export DSH_HOME=/tmp/dsh-verify        # Windows: 一个空目录
dsh plugin --profile web add <包路径>
dsh --profile web --port 64995 --no-open
dsh plugin --profile web remove dsh-system-vitals
```

---

## 1. 安装（install）

```
dsh plugin --profile web add /path/to/dsh-system-vitals

dependencies:
+ dsh-system-vitals 1.3.16
Done in 390ms using pnpm v11.28.5
```

`bundles` 自动追加该层 —— 只有进了 `bundles`，`cordis.patch.yml` 才会被当成 patch 层
应用，`id: system-vitals` 这一行才会出现在组好的配置树里：

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-system-vitals"
] } }
```

## 2. 启动（start）

```
dsh --profile web --port 64995 --no-open
dsh web: http://127.0.0.1:64995/?token=…
```

两半分别验：

**Host 半侧** —— 采样路由：

```
GET /system-vitals/api/snapshot  ->  200，533 字节
{cpu: 3%, temperature: 72.1, mem: 54%, disk: 68.9%, platform: "win32", …}
```

也就是说采样循环跑起来了，字段齐全（温度在消费级主板上本来就是「可能为 null」的那一项，
这台机器读到了 72.1°C）。

**Client 半侧** —— 启动页引用的 chunk：

```
boot GET /?token=…             -> 200，40297 字节
含本插件的 chunk                -> 200，2592628 字节
  模块 id 'dsh-system-vitals'  -> 命中
  smx-root                     -> 命中（细条的样式）
  settings.section             -> 命中（设置 → 负载条）
  conversation.input.right     -> 命中（输入框工具行的挂载点）
```

两个挂载点都注册上了：没有 `conversation.input.right` 细条不显示，没有
`settings.section` 设置页不出现。

## 3. 卸载（uninstall）

先停服务，再移除：

```
dsh plugin --profile web remove dsh-system-vitals

- dsh-system-vitals link:/path/to/dsh-system-vitals
Done in 413ms using pnpm v11.28.5
```

| 检查项 | 结果 |
| --- | --- |
| `bundles` | 回到 `dsh-base` + `dsh-web-app` 两层 |
| `node_modules/dsh-system-vitals` | 已移除 |
| 端口 64995 | 已释放 |
| `GET /system-vitals/api/snapshot` | 路由随进程消失 |

插件不写 Host 状态：显示哪些读数、顺序、间隔都在浏览器 `localStorage`（`system-vitals:visible`
/ `:order`）。卸载后刷新即完全还原。

---

## 已知边界

- **`link:` 安装（本地目录开发）卸载后可能留下一个 junction**：
  `node_modules/dsh-system-vitals` 会指向源码目录。它不参与依赖解析、不影响 DSH 启动，
  但会让下一次 `add` 报 `EPERM: rename … _tmp_…`；删掉那个 junction 即可。git / tarball 安装
  装的是真实目录，不会出现。
- **Windows 温度依赖 WMI**：`MSAcpi_ThermalZoneTemperature` 在多数消费级主板上不暴露，
  读不到时该字段返回 `null`，界面显示 `—` —— 这是设计行为，不是安装失败。
- **本记录只覆盖「装得上、起得来、采样有数、卸得掉」**，不等于视觉验收：细条的格宽是否
  稳定、裁切是否落在两格之间，仍要人眼看（见 CHANGELOG 里 1.3.11 / 1.3.13 / 1.3.15 的测量数据）。
