# dsh-system-vitals

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-6c757d)](#兼容性)

**DeepSeek Harness 的「负载条」插件** —— 在输入框卡片内部工具行、紧贴「自动审查」右侧，常驻显示
**CPU 占用、CPU 温度、内存、磁盘、实时上传/下载速率**；Linux / macOS / Windows 三平台，每秒采样，零运行时依赖。

```
+  自动审查 ⌄   CPU  2.8%  温度  41°C  内存  14%  磁盘  13%  上传  128K/s  下载  1.60M/s
```

不用打开任务管理器、不用切窗口，也不用往下翻对话——体征就在你打字的地方。

## 特性

- **一条极简状态行**：`CPU · 温度 · 内存 · 磁盘 · 上传 · 下载`，全部常驻可见。
- **零依赖**：Linux 直接读内核计数器（`/proc`、`/sys`）；macOS 用系统自带 `sysctl`/`netstat`；Windows 用常驻 PowerShell 读性能计数器。不装原生模块、不需要管理员权限。
- **等宽格子、绝不跳动**：每个读数是 `标签 4ch + 数字 3.5ch + 单位 2.5ch` 的定宽格子，数值从 `9%` 变 `10%` 时整条不会左右晃。
- **数字最多 3 位有效数字**：放不下就换单位（网速 `B/s → K/s → M/s → G/s`），绝不撑宽格子。
- **阈值变色**：CPU/内存 75% 起警示色、90% 起错误色；磁盘 85% / 95%；温度 80°C / 92°C。
- **窄屏自适应**：工具行放不下时按优先级收起次要读数，而不是把模型选择器挤走。
- **跟随主题与语言**：只使用 `--dsw-alias-*` 主题 token，中英文自动切换。

## 安装

要求：DSH `0.2.1-rc.2` 左右版本、Node ≥ 20、`dsh web` 带界面的 profile。

```bash
dsh plugin --profile web add github:abyss2021/dsh-system-vitals
```

也可以从本地目录安装（开发调试）：`dsh plugin --profile web add /path/to/dsh-system-vitals`。

> 若将来发布到 npm，可用 `dsh plugin --profile web add dsh-system-vitals` 安装。
> 这两条命令**不要同时写进代码块**：插件商店的安装命令探测器遇到两个候选会判为
> `ambiguous`，反而一条都不显示。

装好后刷新页面即可。版本发布记录见 GitHub Releases（首个版本 `v1.3.12`）。卸载：

```bash
dsh plugin --profile web remove dsh-system-vitals
```

> 本插件是 **bundle + Client half** 的组合：Host 半侧负责采样并暴露一条同源 HTTP 路由，
> Client 半侧向 `conversation.input.right`（输入框卡片 `.trailing` 组，与发送按钮同行）和 `settings.section`
> 各注册一个 React 组件。不需要构建步骤，`client.js` 是可直接加载的浏览器模块。

## 显示内容

| 指标 | Linux | macOS | Windows |
|---|---|---|---|
| CPU 总占用 / 单核占用 | `/proc/stat` 两次采样求差 | Node `os.cpus()` 时间片差分 | `Win32_PerfFormattedData_PerfOS_Processor` |
| CPU 温度 | `/sys/class/hwmon`（`coretemp`/`k10temp`/`zenpower`/`cpu_thermal`…）→ 回退 `/sys/class/thermal` | `powermetrics --samplers smc`（无 sudo 时通常不可读；回退 `osx-cpu-temp`/`istats`） | `MSAcpi_ThermalZoneTemperature`（多数消费级主板不暴露，故常为 `—`） |
| 内存 / 交换 | `/proc/meminfo` | Node `os.totalmem/freemem` + `sysctl vm.swapusage` | `Win32_PerfFormattedData_PerfOS_Memory`（交换取 commit 量） |
| 磁盘占用 | `fs.statfs('/')` | `fs.statfs('/')` | `Win32_LogicalDisk`（系统盘） |
| 上传 / 下载速率 | `/proc/net/dev` 累计差分 | `netstat -ib` 累计差分 | `Win32_PerfFormattedData_Tcpip_NetworkInterface` 的 `Bytes*Persec` |
| （Host 侧附带）负载、进程数、运行时长 | `/proc/loadavg`、`/proc`、`/proc/uptime` | `os.loadavg()` / `os.uptime()` | `NumberOfProcesses` / `LastBootUpTime` |

Host 每秒采样一次，Client 每 2 秒轮询 `GET /system-vitals/api/snapshot`。读不到的字段一律返回 `null`，界面显示 `—`，不会编造数值。

### 各平台实现要点

- **Linux**：纯文件读取，零子进程、零依赖。
- **macOS**：`sysctl`/`netstat` 短命令 + Node API；温度采样较贵，每 5 个采样点刷新一次并缓存。
- **Windows**：启动一个常驻 PowerShell 子进程，每秒输出一行 JSON（性能计数器本身已是百分比与每秒字节，无需差分）；子进程退出后按 5 秒退避重启，期间沿用上一次采样。
- 其他平台回退到 Node `os` 的最小读数（内存、负载、运行时长），CPU 占用与网速显示 `—`。

## 拖动排序

每个参数都是**独立可选中的格子**：

- **拖动**：按住任一参数拖到新位置，拖动过程中实时换位，松手即生效；
- **键盘**：Tab 聚焦后用 `←` / `→` 移动（`Enter` / `Space` 选中）；
- **持久化**：顺序存在 `localStorage`（key `dsh-system-vitals:order`），刷新与重启后保留；
  词条表里已不存在的旧 id 会被忽略，缺失的参数自动补回原位。

因为每个格子等宽、且拖动时**不留占位符**，整条的宽度与绝对位置在任何顺序下都不变——变的只是哪个读数占哪个槽位。

## 显示哪些读数

**设置 → 负载条** 里逐项开关：

- 列出全部读数，每项一个开关，取消勾选即隐藏；
- 下方实时预览当前会显示成什么样；
- `全部显示` 一键恢复；`顺序` 区域可 `恢复默认顺序`。

偏好存在浏览器 `localStorage`（`dsh-system-vitals:visible` / `:order`），刷新与重启后保留。

> **为什么不再按窗口宽度自动隐藏**：早期版本用容器查询在窄窗口隐藏次要读数，结果用户自定义的顺序会在改变窗口宽度时"看起来被重置"。现在显隐完全由你决定，**窗口宽度不再影响显示内容与顺序**。窄窗口下若嫌挤，请用设置页手动关掉不关心的项。

## 位置与换行

细条挂在 `conversation.input.right`，位于 `.trailing` 组内、与发送按钮同一 flex 组。

宿主那行是 `flex-wrap: wrap`，并且用 `observeControlRow` 量自身宽度来决定模型选择器是否紧凑——
**细条的宽度被算进这一行**，而 `.trailing` 是 `flex: none`，所以细条若不肯让步，整行就会被挤到换行，
把「完全权限」和发送按钮推走。因此细条按**行内剩余宽度**封顶，超出的部分在自己内部裁切：
它永远是让步的那一方，原生按钮位置不变。

上限是**运行时实测**的，不是固定魔法数：用 `ResizeObserver` 监听那一行，取行的**内容宽度**（与宿主判定
"放得下吗"用的是同一个盒子），减去「不在细条自己这条祖先链上」的所有控件宽度、它们之间的间距，再留 8px 安全余量。
模型选择器按**紧凑宽度**计入——因为空间不足时宿主会自动把它收成图标；若按展开宽度计算，细条会被压到几乎没有，
而宿主又因此永远不会进入紧凑模式。

关键在于这个上限**在绘制之前就生效**：它由 `ResizeObserver` 回调直接写到元素样式上，而不是绕一圈 `setState`。
React 的状态更新要到下一个任务才提交，那时这一帧已经画完了——过去每缩小一档，就会有一帧把细条按旧宽度画出来，
溢出把这一行里可压缩的原生控件（`+`、权限/模式选择器、模型选择器）挤扁，下一帧再弹回去，看起来就是左侧控件
"快速跳动然后归位"。现在上限在同一个渲染更新里生效，任何一帧都不会画出超宽的细条。

典型行为（行宽 → 可见读数 → 宿主结果，数值随字体与宿主版本略有浮动）：396px→1 项→单行；
500px→2 项→单行；620px→4 项→单行；900px 及以上→6 项→单行。

细条**永远单行**，放不下时从右缘裁切——**优先保留靠左的参数**（也就是你自定义顺序里靠前的那些）。
上限对齐到整格，裁切点永远落在两个读数之间，既不会看到半个数字，末尾也没有做渐隐（看不出被淡掉的最后一项）。

> 取舍说明：行宽低于约 400px 时，扣掉宿主控件后只剩一两个读数的位置，这是「不换行、优先靠左」的必然结果。
> 如果你在那个宽度下更希望看到全部读数，我可以改成「尾部折叠成一个 `+N` 展开按钮」。

## 配置

在 profile 的 patch 层覆盖行 `config`：

```yaml
- insert:
    - id: system-vitals
      name: dsh-system-vitals
      config:
        intervalMs: 1000   # Host 采样间隔，250–10000 ms；网速按该间隔的字节差计算
```

## 兼容性

- **平台**：Linux 完整支持；macOS、Windows 支持 CPU/内存/磁盘/网速，温度视机型与权限可能不可用。
- **DSH**：在 `0.2.1-rc.2` 上开发并验证；只使用稳定的 `webServer.register`、
  `ctx.slots.register/inject`、`ctx.locale.register` 接口。
- **Node**：≥ 20（`fs.statfs`）。

## 安全说明

Host 半侧注册的 `GET /system-vitals/api/snapshot` 是**本机未鉴权**路由，只绑在 DSH Web 的
监听地址上（默认 `127.0.0.1`）。同机的其他进程本来就能读 `/proc`，因此不构成额外暴露；
但**不要把 DSH Web 直接暴露到公网**（`--host 0.0.0.0`）后再开着这个插件，否则这些读数会随页面一起对外可见。

## 项目结构

```
dsh-system-vitals/
├── package.json         # 包清单：dsh.bundle / dsh.client / exports
├── cordis.patch.yml     # 插入插件行
├── index.js             # Host 半侧：采样 + HTTP 路由
├── client.js            # Client 半侧：工具行里的状态行
├── locale/{zh,en}.json  # 插件市场展示用元数据
├── icon.svg             # 插件图标
└── README.md / README.en.md / LICENSE
```

## 开发与发布

```bash
node --check index.js                       # 语法检查
node --check client.js
for file in platform/*.js; do node --check "$file"; done
npm pack --dry-run                          # 查看将发布的文件列表
npm publish                                 # 发布到 npm（需先 npm login，目前未发布）
```

发布前记得同步升版本（`npm version patch|minor|major`）并更新 `CHANGELOG.md`。
`package.json` 已声明 `publishConfig.access = public` 与 `provenance`；`.github/workflows/publish.yml`
会在发布 GitHub Release 时校验 tag 并执行 `npm publish --provenance`（需配置 `NPM_TOKEN` secret）。

**当前未发布到 npm**，所以用 GitHub 安装；发布后再把上面的安装命令换成
`dsh plugin --profile web add dsh-system-vitals`，并保持代码块里只有这一条。

修改后重装即可生效：

```bash
dsh plugin --profile web remove dsh-system-vitals
dsh plugin --profile web add /path/to/dsh-system-vitals
```

## 许可

[MIT](LICENSE)
