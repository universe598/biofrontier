# 首次公开发布清单

## GitHub 仓库

1. 在 GitHub 创建空仓库，建议名称 `BioFrontier`；
2. 不要勾选自动生成 README、`.gitignore` 或许可证，本地已经准备好；
3. 将本目录添加为 GitHub Desktop 的本地仓库；
4. 首次提交建议写：`Initial public release: BioFrontier 0.9.0`；
5. 发布前再次确认 `git status` 中没有数据库、模型、下载资料、`.env` 或构建目录；
6. 推送后在仓库 Settings → Security 中启用 Private vulnerability reporting。

## GitHub Release

- Tag：`v0.9.0`
- Title：`BioFrontier 0.9.0 — 首个公开版本`
- 必选附件：`BioFrontier-Setup-0.9.0.exe`
- 可选附件：`BioFrontier-Source-0.9.0.zip`（GitHub 也会自动生成源码压缩包）；
- 不要把安装程序直接提交进 Git 仓库；只上传到 Release；
- 安装包 SHA-256：`B2D0C773C6F2CCA37141277AAA7BBBDB8F0F588F6D0D4EDBAF75549419361500`；
- 源码包重新打包后，用 `Get-FileHash` 计算 SHA-256，并与安装包校验值一起粘贴到 GitHub Release 正文；
- 发布时同时说明当前没有 Windows 代码签名证书；
- 不上传或另行捆绑模型、llama.cpp、CUDA；用户从设置页打开上游官方页面并自行配置。

GitHub 普通仓库不接受超过 100 MiB 的单个文件，本安装包约 107 MiB，因此必须走 Release 附件，不能通过 Git LFS 或普通提交混入源码历史。

### Release 说明范本

BioFrontier 是一个本地优先的个人生物学前沿阅读台。本版本支持多来源同步、组合筛选、收藏与下载、手动外部 AI 初读，以及由用户自行下载和配置的可选本地 AI 分类与专题速报。

本次公开版重点：

- PubMed、bioRxiv、medRxiv、arXiv q-bio 与 RSS/Atom；
- 统一的一二级生物学分类体系；
- 最长 20 分钟、附原始链接的本地专题速报；
- DeepSeek、OpenAI、Claude API 手动调用；
- 外部 AI 首次发送提示、AI 生成标识和自定义来源内网保护；
- 首次启动协议确认，以及“仅本次/以后不再弹出确认框”的外部 AI 授权选择；
- Windows DPI 和长列表性能优化。

请注意：本工具只帮助初步筛选和发现线索，不替代全文阅读、系统综述或专业判断。安装包不含模型与推理运行时；可选组件应从其官方页面取得并遵守原许可证。当前安装程序未购买代码签名证书，Windows SmartScreen 可能显示未知发布者。

## B站图文 / 知乎专栏结构

推荐标题：**我做了一个只为自己服务的生物学前沿阅读器：BioFrontier**

正文顺序：

1. 每次面对数百篇新论文时遇到的真实问题；
2. 为什么不是再做一个通用 AI 聊天框；
3. 最新动态、来源管理和筛选抽屉；
4. 如何按需配置本地模型并根据摘要分类；
5. 20 分钟专题速报能做什么、不能做什么；
6. 本地隐私与外部 API 的明确边界；
7. Windows 和 8 GB 显存实测；
8. GitHub、下载方式、MIT 开源和未来计划。

首图建议同时展示“最新动态”“筛选抽屉”“专题速报”三块，不要把大段设置页面当首图。正文中明确说明模型只读标题与摘要，避免让读者误以为软件自动获取了论文全文。
