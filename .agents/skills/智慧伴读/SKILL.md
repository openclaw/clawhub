---
name: 智慧伴读
version: "1.0.0"
description: "基于花叔《阅读的方法》改良版构建的分层阅读系统。帮你从「读完一本书」升级到「真正读懂一本书」，支持三级深度模式：轻量（狩猎法，快速定位内容）→ 标准（狩猎+费曼，内化概念）→ 深度（狩猎+费曼+辩论，压力测试）。最终可输出markdown笔记和可视化HTML阅读卡片。"
kind: bundle
author: ""
tags:
  - reading
  - 阅读
  - education
  - 教育
  - feynman
  - 费曼
  - debate
  - 辩论
dependencies:
  - reading-hunting
  - reading-feynman
  - meta-huashan-debate
  - meta-reading-companion
---

# 智慧伴读 · 阅读伴侣系统

> 不是替人读书，而是伴人读懂。

## 系统架构

```
智慧伴读/
├── SKILL.md                        ← 本文件（Bundle 入口）
├── reading-hunting/SKILL.md        ← Stage 1：狩猎法
├── reading-feynman/SKILL.md        ← Stage 2：费曼法
├── meta-huashan-debate/SKILL.md    ← Stage 3：华山论剑
├── meta-reading-companion/SKILL.md ← Stage 4：分层阅读伴侣
└── 通用指南/
    └── 智慧伴读-通用阅读指南.md     ← 跨平台方法论
```

## 安装

```bash
# OpenSquilla 用户
opensquilla skills install 智慧伴读
```

## 使用

```bash
# 方式一：直接触发分层阅读伴侣（推荐）
# 说"帮我分层阅读《书名》，我的问题是..."
# 或触发 meta-reading-companion

# 方式二：单独使用各模块
# 狩猎法：说"帮我用狩猎法读..."
# 费曼法：说"帮我用费曼法理解..."
# 辩论：说"帮我辩论这个观点..."
```

## 三级深度模式

| 模式 | 流程 | 适合场景 |
|------|------|---------|
| 🏹 **轻量** | 狩猎法 → 苏格拉底追问 | 快速找答案、定位书中内容 |
| 🧠 **标准** | 狩猎法 → 费曼法 | 想搞懂一个概念、暴露模糊地带 |
| ⚔️ **深度** | 狩猎法 → 费曼法 → 华山论剑 | 验证核心观点是否经得起推敲 |

## 输出

- Markdown 结构化阅读笔记
- HTML 可视化阅读卡片（huashu-design）

## 系统名称

**智慧伴读**（2026-06-24 命名）
