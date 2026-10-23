# dsh-system-vitals

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux-6c757d)](#兼容性)

**DeepSeek Harness 的系统体征插件** —— 在输入框卡片内部工具行、紧贴「自动审查」右侧，常驻显示
**CPU 占用、CPU 温度、内存、磁盘、实时上传/下载速率**，每秒采样，零运行时依赖。

```
+  自动审查 ⌄   CPU  2.8%  温度  41°C  内存  14%  磁盘  13%  上传  128K/s  下载  1.60M/s
```

不用打开任务管理器、不用切窗口，也不用往下翻对话——体征就在你打字的地方。

## 特性

- **一条极简状态行**：`CPU · 温度 · 内存 · 磁盘 · 上传 · 下载`，全部常驻可见。
- **零依赖、零命令**：直接读 Linux 内核计数器（`/proc`、`/sys`），不调用 `top`/`ps`/`nvidia-smi`，不装原生模块。
- **等宽格子、绝不跳动**：每个读数是 `标签 4ch + 数字 3.5ch + 单位 2.5ch` 的定宽格子，数值从 `9%` 变 `10%` 时整条不会左右晃。
- **数字最多 3 位有效数字**：放不下就换单位（网速 `B/s → K/s → M/s → G/s`），绝不撑宽格子。
- **阈值变色**：CPU/内存 75% 起警示色、90% 起错误色；磁盘 85% / 95%；温度 80°C / 92°C。
- **窄屏自适应**：工具行放不下时按优先级收起次要读数，而不是把模型选择器挤走。
- **跟随主题与语言**：只使用 `--dsw-alias-*` 主题 token，中英文自动切换。

## 安装

要求：DSH `0.2.1-rc.2` 左右版本、Node ≥ 20、`dsh web` 带界面的 profile。

```bash
# 1. 从 GitHub 安装
dsh plugin --profile web add github:abyss2021/dsh-system-vitals

# 2. 或从本地目录安装（开发调试）
dsh plugin --profile web add /path/to/dsh-system-vitals
```

装好后刷新页面即可。卸载：

```bash
dsh plugin --profile web remove dsh-system-vitals
```

> 本插件是 **bundle + Client half** 的组合：Host 半侧负责采样并暴露一条同源 HTTP 路由，
> Client 半侧向 `conversation.input.left` 注册一个 React 组件。不需要构建步骤，`client.js` 是可直接加载的浏览器模块。

## 显示内容

| 指标 | 来源 | 备注 |
|---|---|---|
| CPU 总占用 / 单核占用 | `/proc/stat` | 两次采样求差 |
| CPU 温度 | `/sys/class/hwmon/*/name`（`coretemp`、`k10temp`、`zenpower`、`cpu_thermal`…）→ `temp1_input`；回退 `/sys/class/thermal/thermal_zone*/temp` | 优先 CPU package 传感器；读不到显示 `—` |
| 内存 / 交换 | `/proc/meminfo` | 主行只显示占用率；绝对用量在悬浮提示里 |
| 磁盘占用 | `fs.statfs('/')` | 根卷 |
| 上传 / 下载速率 | `/proc/net/dev` 累计字节差分 | 已排除 `lo`、`veth`、`docker`、`br-`、`tun`、`wg` 等虚拟接口 |
| （Host 侧附带）负载、进程数、运行时长 | `/proc/loadavg`、`/proc`、`/proc/uptime` | 当前 UI 未展示，保留在快照里 |

Host 每秒采样一次，Client 每 2 秒轮询 `GET /system-vitals/api/snapshot`。

## 窄屏行为

宿主工具行本身就是一层 inline-size 容器，插件直接复用它的宽度做判断（不使用自身宽度，避免尺寸隔离把整条压成 0 宽）：

| 卡片宽度 | 显示 |
|---|---|
| > 860px | 六项全显：CPU · 温度 · 内存 · 磁盘 · 上传 · 下载 |
| ≤ 860px | 收起上传/下载 |
| ≤ 620px | 再收起磁盘，保留 CPU · 温度 · 内存 |

被收起的读数仍可通过悬浮提示查看精确值。

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

- **平台**：Linux（读取 `/proc` 与 `/sys`；macOS/Windows 上会缺数据，不建议使用）。
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

## 开发

```bash
node --check index.js      # 语法检查
node --check client.js
npm pack --dry-run         # 查看将发布的文件列表
```

修改后重装即可生效：

```bash
dsh plugin --profile web remove dsh-system-vitals
dsh plugin --profile web add /path/to/dsh-system-vitals
```

## 许可

[MIT](LICENSE)
