---
name: tushare-api
description: Tushare Pro 金融数据 API 查询助手。用于帮助用户查询中国股票、基金、期货、债券等金融数据。当用户需要获取股票行情、财务数据、基础信息、宏观经济数据时使用此 skill。
---

# Tushare API Skill

## 简介

Tushare Pro 是中国领先的金融数据平台，提供股票、基金、期货、债券、外汇、数字货币等全品类金融大数据。

**官网**: https://tushare.pro
**API 文档**: https://tushare.pro/document/2

## 股票代码规范

所有股票代码都需要带后缀：

| 交易所 | 后缀 | 示例 |
|--------|------|------|
| 上海证券交易所 | .SH | 600000.SH |
| 深圳证券交易所 | .SZ | 000001.SZ |
| 北京证券交易所 | .BJ | 835305.BJ |
| 香港证券交易所 | .HK | 00001.HK |

## 常用 API 接口

### 基础数据
- `stock_basic` - 股票基础信息
- `trade_cal` - 交易日历
- `stock_company` - 上市公司基本信息
- `new_share` - IPO 新股列表

### 行情数据
- `daily` - 日线行情
- `weekly` - 周线行情
- `monthly` - 月线行情
- `adj_factor` - 复权因子
- `daily_basic` - 每日指标（PE/PB/市值等）

### 财务数据
- `income` - 利润表
- `balance_sheet` - 资产负债表
- `cashflow` - 现金流量表
- `forecast` - 业绩预告
- `express` - 业绩快报
- `dividend` - 分红送股
- `fina_indicator` - 财务指标

### 市场数据
- `moneyflow` - 个股资金流向
- `limit_list` - 每日涨跌停股票
- `top_list` - 龙虎榜数据
- `block_trade` - 大宗交易

## 使用方法

### Python SDK
```python
import tushare as ts

# 设置 token（需要用户自行申请）
pro = ts.pro_api('your_token_here')

# 获取股票列表
df = pro.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,area,industry,list_date')

# 获取日线行情
df = pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20240201')

# 获取财务数据
df = pro.income(ts_code='600000.SH', start_date='20230101', end_date='20231231')
```

### HTTP API
```bash
curl -X POST https://api.tushare.pro \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "daily",
    "token": "your_token",
    "params": {"ts_code": "000001.SZ", "start_date": "20240101"},
    "fields": "ts_code,trade_date,open,high,low,close,vol"
  }'
```

## 积分系统

- 注册赠送初始积分
- 通过签到、分享、贡献数据等方式获取积分
- 不同 API 调用消耗不同积分
- 积分与频次对应表: https://tushare.pro/document/1?doc_id=290

## 详细文档

更多接口详情见 [references/api-reference.md](references/api-reference.md)

## 注意事项

1. 需要申请 token 才能使用 API
2. 注意积分消耗，高频接口消耗更多积分
3. 数据有更新延迟，日线数据通常在收盘后 1-2 小时更新
4. 免费用户有调用频次限制
