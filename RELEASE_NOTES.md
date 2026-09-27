# BioFrontier 0.9.0

BioFrontier 是一个本地优先的个人生物学前沿阅读台。本次首个公开版本提供多来源同步、组合筛选、收藏与保存、可选本地 AI，以及由用户手动触发的外部 AI 初读、匹配、分类和专题速报。

## 主要内容

- PubMed、bioRxiv、medRxiv、arXiv q-bio 与公开 RSS/Atom；
- 统一的一二级生物学分类体系与筛选抽屉；
- DeepSeek、OpenAI、Claude API 可选模型；
- 用户自行下载与配置 GGUF、llama.cpp 的本地分类和 20 分钟专题速报；
- 外部 AI 逐服务商确认、AI 生成标识和 API Key 安全存储；
- 自定义来源内网保护、Windows DPI 和长列表性能优化。

## 下载

- `BioFrontier-Setup-0.9.0.exe`：Windows 10/11 x64 安装程序；
- `BioFrontier-Source-0.9.0.zip`：与此版本对应的人工整理源码包（可选，GitHub 同时自动生成源码归档）。

安装包不含 GGUF 模型、llama.cpp、CUDA 或显卡驱动。当前没有 Windows 代码签名证书，因此 SmartScreen 可能显示“未知发布者”。

## SHA-256

- 安装包：`B2D0C773C6F2CCA37141277AAA7BBBDB8F0F588F6D0D4EDBAF75549419361500`
- 源码包：上传 Release 时填写最终文件的 SHA-256

## 使用边界

分类、初读和专题速报只用于发现线索，不能替代原文阅读、系统综述或专业判断。软件只访问公开接口、公开订阅和用户主动提供的地址，不绕过登录、验证码、机构权限或付费墙。外部 AI 仅在用户手动操作并确认数据发送范围后调用，可能产生服务商费用。
