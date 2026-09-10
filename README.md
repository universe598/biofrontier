# BioFrontier 生物前沿

BioFrontier 是一个面向个人研究者的 Windows 桌面阅读台：从公开学术来源同步近期生物学论文与预印本，在本地整理、筛选和收藏，并按需使用外部 API 或用户自行配置的本地模型。

> 当前版本：0.9.0。分类、初读和专题速报用于发现线索，不能替代原文阅读、系统综述或专业判断。

## 主要功能

- 同步 PubMed、bioRxiv、medRxiv、arXiv q-bio，以及公开 RSS/Atom；
- 按阅读状态、时间、来源、内容类型、相关度和一二级研究领域组合筛选；
- 收藏论文，下载可公开取得的 PDF 或保存公开网页；
- 手动调用 DeepSeek、OpenAI 或 Claude API 进行摘要初读、需求匹配、文章分类和专题速报；
- 也可连接本机 GGUF 模型，在本地完成分类，并在最多 20 分钟内生成附原始链接的 AI 专题速报；
- 昵称、头像、收藏、阅读状态与本地报告均保存在本机。

## 下载与可选本地 AI

请从仓库右侧的 **Releases** 页面下载 `BioFrontier-Setup-0.9.0.exe`。安装程序不会提交进 Git 仓库，也不捆绑 GGUF 模型、llama.cpp、CUDA 或显卡驱动。没有本地模型时，同步、筛选、收藏、保存和外部 API 功能均可使用。

当前个人发布版没有 Windows 代码签名证书，SmartScreen 可能显示“未知发布者”。请只从本项目正式 Release 下载，并在 PowerShell 中核对 SHA-256：

```powershell
Get-FileHash .\BioFrontier-Setup-0.9.0.exe -Algorithm SHA256
```

预期值：`B2D0C773C6F2CCA37141277AAA7BBBDB8F0F588F6D0D4EDBAF75549419361500`。

需要本地 AI 时，在“设置 → 可选本地 AI”中：

1. 打开软件提供的 Qwen 官方模型页，下载适合设备的 GGUF 文件；
2. 打开 llama.cpp 官方发布页，下载 Windows 运行环境并解压；
3. 分别选择 GGUF 文件和解压目录中的 `llama-server.exe`；
4. 点击“测试本地 AI”。Windows GPU 版本的 DLL 应留在 `llama-server.exe` 同一发布包目录。

本软件只是连接这些文件，不代替第三方提供下载，也不改变其许可证。8 GB 显存可尝试 Qwen3 8B 的 Q4 量化；运行时接近资源上限，不建议同时运行大型游戏。

## 系统要求

- Windows 10/11 x64；
- 基础功能不要求独立显卡；
- 开发环境需要 Node.js 22 或更高版本。

## 从源码运行

```powershell
git clone <你的仓库地址>
cd biofrontier
npm ci
npm run build
npm run preview
```

开发模式与安装包构建：

```powershell
npm run dev
npm run package:win
```

开发和自动化测试仍可使用 `BIOFRONTIER_CLASSIFIER_PATH` 指向带 `classifier-manifest.json` 的兼容组件目录；普通用户应使用设置页面选择文件。

## 数据、来源与 AI 边界

BioFrontier 只读取公开接口、公开 RSS/Atom 和用户主动导入的网页，不绕过登录、验证码、机构权限或付费墙。自定义来源默认禁止访问本机和局域网地址，只有用户在高级设置中明确允许后才访问。

本地模型处理不会把论文内容发送给 DeepSeek、OpenAI 或 Claude。外部 AI 初读、匹配、分类和专题速报只在用户手动点击时调用；首次向每个服务商发送前会说明数据范围并请求确认。批量分类与专题速报可能产生 API 费用，API Key 通过 Electron 的 Windows 安全存储加密保存。

首次启动会先展示《应用使用协议》和《隐私说明》；用户主动勾选同意后才初始化资料与同步。外部 AI 的内容发送授权仍单独确认，可选择“仅本次同意”或记住选择，以后不再弹出该确认框。

AI 初读、匹配、界面报告及导出报告均带 AI 生成标识。内容权利与隐私边界详见 [CONTENT_RIGHTS.md](CONTENT_RIGHTS.md)、[PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 测试

```powershell
npm test
```

`tests/real-classifier.cjs` 会真实启动用户配置的本地模型，耗时更长并占用显存。

## 参与与反馈

Bug、来源适配建议和分类体系问题可通过 GitHub Issues 提交。提交前请移除 API Key、个人数据库、论文文件和个人路径；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

BioFrontier 应用源码使用 [MIT License](LICENSE)。用户自行下载的模型和运行环境遵循各自原始许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

项目来自实际的个人研究阅读需求：使用者提出目标、判断产品取舍并完成测试，具体实现由 OpenAI Codex 协助完成。知识因分享而更有价值。
