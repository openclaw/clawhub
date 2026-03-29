# Revolution Systems - Auto Revolution & Test-Driven Revolution

**版本：** 2.0.1  
**发布：** 2026-03-29  
**作者：** OpenClaw Community

---

## 概述

Revolution 系统是一套**测试驱动的 AI 自动进化系统**，包含两个相关但不同的项目：

```
AI 写代码 → AI 测试 → AI 改 bug → 测试通过 → 下一轮
```

---

## 两个项目的关系

| 特性 | Test-Driven Revolution (TDR) | Auto Revolution |
|------|------------------------------|-----------------|
| **定位** | 用户 interface（AgentSkills 技能包） | 底层执行引擎（Cron 心跳） |
| **触发方式** | 用户手动触发（"用 TDR 创建 XX"） | Cron 定时任务（每 5 分钟） |
| **适用场景** | 主动开发新功能 | 后台自动执行任务队列 |
| **ClawHub Slug** | `test-driven-revolution` | `auto-revolution` |
| **共享资源** | ✅ 任务队列、模型配置、执行脚本、事件日志 | ✅ 任务队列、模型配置、执行脚本、事件日志 |

**核心关系：**
- **两者共享同一套配置和脚本**，只是触发方式不同
- TDR 提供用户友好的手动触发 interface
- Auto Revolution 提供后台自动执行能力

---

## 核心工作流

```
1. 任务分析 → 2. 用户选择流程 → 3. 执行流程 → 4. 循环迭代
                                    ↓
                          审阅 → 执行 → 审核
```

### 三种流程模式

| 流程 | 步骤 | 耗时 | 成本 | 适用场景 |
|------|------|------|------|----------|
| **简化流程** ⚡ | Executor | ~5m | 🆓 | 文档/简单 Bug |
| **完整流程** 📊 | 审阅→执行→审核 | ~15m | 🆓 | 新功能/重构 |
| **高级流程** 🏆 | 审阅→执行→审核 | ~15m | 💰$$ | 核心/安全 |

---

## 安装使用

### 安装 TDR（手动触发）

```bash
clawhub install test-driven-revolution
```

**使用示例：**
```bash
# 自动分析并推荐流程
node scripts/auto-plan.js "创建一个 HTTP 服务器，监听 3000 端口"

# 用户确认后执行
node scripts/auto-plan.js --confirm B
```

### 安装 Auto Revolution（自动执行）

```bash
clawhub install auto-revolution
```

**配置 Cron（一次性）：**
```bash
# 主 Agent 心跳 - 每 5 分钟
openclaw cron add --agent main \
  --name "evolution-heartbeat" \
  --schedule "*/5 * * * *" \
  --message "node <workspace>/evolution/scripts/heartbeat-coordinator.js"
```

---

## 任务难度评估

### 评估维度

| 维度 | 简单 | 中等 | 复杂 |
|------|------|------|------|
| **代码量** | <100 行 | 100-500 行 | >500 行 |
| **文件数** | 1-2 个 | 3-5 个 | >5 个 |
| **依赖** | 无 | 部分 | 跨模块 |
| **风险** | 低 | 中 | 高 |
| **可回滚** | 是 | 部分 | 否 |

### 自动推荐规则

| 任务类型 | 默认流程 | 例外情况 |
|----------|----------|----------|
| 文档更新 | 简化流程 | 大规模重构→完整 |
| Bug 修复 | 简化流程 | 安全漏洞→高级 |
| 新功能 | 完整流程 | 核心功能→高级 |
| 代码重构 | 完整流程 | 核心架构→高级 |
| 安全修复 | 高级流程 | - |
| 批量改进 | 简化流程 | 影响核心→完整 |

---

## 配置文件

**位置：** `config/models.json`

```json
{
  "roles": {
    "reviewer": {
      "primary": "高级模型",
      "fallback": "备用模型"
    },
    "executor": "默认模型",
    "auditor": {
      "primary": "高级模型",
      "fallback": "备用模型"
    }
  },
  "timeouts": {
    "reviewer": 300,
    "executor": 300,
    "auditor": 180
  },
  "enforceAudit": true,
  "executorDefault": "默认模型"
}
```

---

## 安全规则

### 执行前检查

1. **危险命令检测** - 禁止 `rm -rf`、`DROP TABLE` 等
2. **写入路径验证** - 限制在 workspace 目录内
3. **外部 API 调用** - 需要用户确认
4. **大额扣费** - >$100 需要人工审批

### 执行中监控

1. **原子锁** - 防止并发冲突
2. **事件日志** - 所有操作记录到 JSONL
3. **超时保护** - 超时自动终止

### 执行后审核

1. **Auditor 验证** - 完整流程/高级流程必须
2. **测试覆盖** - 关键功能必须通过测试
3. **回滚方案** - 高风险操作必须提供

---

## 最佳实践

### 1. 任务拆解

**好：**
```json
{
  "subtasks": [
    {"title": "创建 HTTP 服务器", "description": "监听 3000 端口"},
    {"title": "添加路由", "description": "GET /health, GET /api/data"},
    {"title": "编写测试", "description": "单元测试覆盖率>80%"}
  ]
}
```

**不好：**
```json
{
  "subtasks": [
    {"title": "完成整个项目"}  // 太笼统
  ]
}
```

### 2. 流程选择

- **文档更新** → 简化流程（快速、免费）
- **新功能** → 完整流程（有审核、免费）
- **安全修复** → 高级流程（顶级模型审核、付费）

### 3. 迭代控制

- 单次迭代 <10 分钟
- 最多 3 次迭代
- 3 次失败后人工介入

---

## 相关链接

- **TDR on ClawHub:** https://clawhub.com/skills/test-driven-revolution
- **Auto Revolution on ClawHub:** https://clawhub.com/skills/auto-revolution
- **ClawHub CLI:** https://clawhub.ai

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 2.0.1 | 2026-03-29 | 脱敏发布到 ClawHub |
| 2.0.0 | 2026-03-29 | 添加任务难度分析、三种流程模式、用户选择机制 |
| 1.0.0 | 2026-03-28 | 初始版本 |

---

**最后更新：** 2026-03-29  
**维护者:** OpenClaw Community
