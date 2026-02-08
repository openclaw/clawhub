# Tushare API 参考文档

## 股票基础信息

### stock_basic - 股票基础列表

**描述**: 获取基础信息数据，包括股票代码、名称、上市日期、退市日期等

**权限**: 2000积分起

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | TS股票代码 |
| name | str | N | 名称 |
| market | str | N | 市场类别（主板/创业板/科创板/CDR/北交所） |
| list_status | str | N | 上市状态 L上市 D退市 P暂停上市 G过会未交易 |
| exchange | str | N | 交易所 SSE上交所 SZSE深交所 BSE北交所 |
| is_hs | str | N | 是否沪深港通标的，N否 H沪股通 S深股通 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | TS代码 |
| symbol | str | 股票代码 |
| name | str | 股票名称 |
| area | str | 地域 |
| industry | str | 所属行业 |
| fullname | str | 股票全称 |
| market | str | 市场类型 |
| exchange | str | 交易所代码 |
| list_status | str | 上市状态 |
| list_date | str | 上市日期 |
| delist_date | str | 退市日期 |
| is_hs | str | 是否沪深港通标的 |

**示例**:
```python
pro = ts.pro_api()
data = pro.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,area,industry,list_date')
```

---

## 行情数据

### daily - A股日线行情

**描述**: 获取股票日线行情数据

**数据说明**: 交易日每天15点～16点之间入库。本接口是未复权行情，停牌期间不提供数据

**权限**: 基础积分每分钟内可调取500次，每次6000条数据

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | 股票代码（支持多个，逗号分隔） |
| trade_date | str | N | 交易日期（YYYYMMDD） |
| start_date | str | N | 开始日期(YYYYMMDD) |
| end_date | str | N | 结束日期(YYYYMMDD) |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| trade_date | str | 交易日期 |
| open | float | 开盘价 |
| high | float | 最高价 |
| low | float | 最低价 |
| close | float | 收盘价 |
| pre_close | float | 昨收价【除权价】 |
| change | float | 涨跌额 |
| pct_chg | float | 涨跌幅 |
| vol | float | 成交量（手） |
| amount | float | 成交额（千元） |

**示例**:
```python
# 获取单只股票日线
df = pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20240201')

# 获取多只股票
df = pro.daily(ts_code='000001.SZ,600000.SH', start_date='20240101', end_date='20240201')

# 获取某交易日全部股票
df = pro.daily(trade_date='20240115')
```

---

### weekly/monthly - 周线/月线行情

**描述**: 获取周线/月线行情数据

**输入参数**: 同 daily

**输出参数**: 同 daily

---

### daily_basic - 每日指标

**描述**: 获取每日股票的基本面指标，包括PE、PB、市值等

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| trade_date | str | N | 交易日期 |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| trade_date | str | 交易日期 |
| close | float | 收盘价 |
| turnover_rate | float | 换手率 |
| turnover_rate_f | float | 换手率(自由流通股) |
| volume_ratio | float | 量比 |
| pe | float | 市盈率（总市值/净利润） |
| pe_ttm | float | 市盈率（TTM） |
| pb | float | 市净率（总市值/净资产） |
| ps | float | 市销率 |
| ps_ttm | float | 市销率（TTM） |
| dv_ratio | float | 股息率（%） |
| dv_ttm | float | 股息率（TTM）（%） |
| total_share | float | 总股本（万股） |
| float_share | float | 流通股本（万股） |
| free_share | float | 自由流通股本（万） |
| total_mv | float | 总市值（万元） |
| circ_mv | float | 流通市值（万元） |

---

### adj_factor - 复权因子

**描述**: 获取股票复权因子，用于计算前复权/后复权价格

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| trade_date | str | N | 交易日期 |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| trade_date | str | 交易日期 |
| adj_factor | float | 复权因子 |

---

## 财务数据

### income - 利润表

**描述**: 获取上市公司利润表数据

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| ann_date | str | N | 公告日期 |
| f_ann_date | str | N | 实际公告日期 |
| start_date | str | N | 报告期开始日期 |
| end_date | str | N | 报告期结束日期 |
| period | str | N | 报告期(每个季度最后一天的日期) |
| report_type | str | N | 报告类型 |
| comp_type | str | N | 公司类型 |

**主要输出字段**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| ann_date | str | 公告日期 |
| f_ann_date | str | 实际公告日期 |
| end_date | str | 报告期 |
| revenue | float | 营业收入(元) |
| operate_profit | float | 营业利润(元) |
| total_profit | float | 利润总额(元) |
| n_income | float | 净利润(元) |
| total_cogs | float | 营业总成本(元) |
| operate_expense | float | 销售费用(元) |
| admin_expense | float | 管理费用(元) |
| financial_expense | float | 财务费用(元) |

---

### balance_sheet - 资产负债表

**描述**: 获取上市公司资产负债表数据

**主要输出字段**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| ann_date | str | 公告日期 |
| end_date | str | 报告期 |
| total_assets | float | 资产总计(元) |
| total_liab | float | 负债合计(元) |
| total_hldr_eqy_exc_min_int | float | 股东权益合计(不含少数股东权益)(元) |
| total_hldr_eqy_inc_min_int | float | 股东权益合计(含少数股东权益)(元) |

---

### cashflow - 现金流量表

**描述**: 获取上市公司现金流量表数据

**主要输出字段**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| ann_date | str | 公告日期 |
| end_date | str | 报告期 |
| n_cashflow_act | float | 经营活动产生的现金流量净额(元) |
| n_cashflow_inv_act | float | 投资活动产生的现金流量净额(元) |
| n_cash_fnc_act | float | 筹资活动产生的现金流量净额(元) |
| free_cashflow | float | 企业自由现金流量(元) |

---

### fina_indicator - 财务指标

**描述**: 获取上市公司财务指标数据，包括盈利能力、偿债能力、成长能力等

**主要输出字段**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| ann_date | str | 公告日期 |
| end_date | str | 报告期 |
| eps | float | 基本每股收益 |
| dt_eps | float | 稀释每股收益 |
| bps | float | 每股净资产 |
| roe | float | 净资产收益率(%) |
| grossprofit_margin | float | 销售毛利率(%) |
| netprofit_margin | float | 销售净利率(%) |
| debt_to_assets | float | 资产负债率(%) |

---

## 市场数据

### moneyflow - 个股资金流向

**描述**: 获取个股资金流向数据，包括超大单、大单、中单、小单流入流出情况

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| trade_date | str | N | 交易日期 |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| trade_date | str | 交易日期 |
| buy_sm_vol | int | 小单买入量（手） |
| sell_sm_vol | int | 小单卖出量（手） |
| buy_md_vol | int | 中单买入量（手） |
| sell_md_vol | int | 中单卖出量（手） |
| buy_lg_vol | int | 大单买入量（手） |
| sell_lg_vol | int | 大单卖出量（手） |
| buy_elg_vol | int | 特大单买入量（手） |
| sell_elg_vol | int | 特大单卖出量（手） |
| net_mf_vol | int | 净流入量（手） |
| net_mf_amount | float | 净流入额（元） |

---

### limit_list - 每日涨跌停股票

**描述**: 获取每日涨跌停股票列表

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| trade_date | str | N | 交易日期 |
| ts_code | str | N | 股票代码 |
| limit_type | str | N | 涨跌停类型（U涨停D跌停） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| trade_date | str | 交易日期 |
| ts_code | str | 股票代码 |
| name | str | 股票名称 |
| close | float | 收盘价 |
| pct_chg | float | 涨跌幅 |
| amount | float | 成交金额（元） |
| limit_amount | float | 封单金额（元） |
| limit_type | str | 涨跌停类型（U涨停D跌停） |

---

## 其他重要接口

### trade_cal - 交易日历

**描述**: 获取各大交易所交易日历

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| exchange | str | N | 交易所 SSE上交所 SZSE深交所 |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| is_open | str | N | 是否交易 0休市 1交易 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| exchange | str | 交易所 |
| cal_date | str | 日历日期 |
| is_open | str | 是否交易 0休市 1交易 |
| pretrade_date | str | 上一个交易日 |

---

### new_share - IPO新股列表

**描述**: 获取IPO新股列表

**输入参数**:

| 名称 | 类型 | 必选 | 描述 |
|------|------|------|------|
| start_date | str | N | 上网发行开始日期 |
| end_date | str | N | 上网发行结束日期 |

**输出参数**:

| 名称 | 类型 | 描述 |
|------|------|------|
| ts_code | str | 股票代码 |
| sub_code | str | 申购代码 |
| name | str | 股票名称 |
| ipo_date | str | 上网发行日期 |
| issue_date | str | 上市日期 |
| amount | float | 发行总量（万股） |
| market_amount | float | 上网发行数量（万股） |
| price | float | 发行价格（元） |

---

## 使用示例汇总

### 获取股票列表
```python
import tushare as ts
pro = ts.pro_api('your_token')

# 所有正常上市股票
stocks = pro.stock_basic(exchange='', list_status='L', 
                         fields='ts_code,symbol,name,area,industry,list_date')
```

### 获取历史行情
```python
# 日线数据
df = pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20240201')

# 周线数据
df = pro.weekly(ts_code='000001.SZ', start_date='20240101', end_date='20240201')
```

### 获取财务数据
```python
# 利润表
df = pro.income(ts_code='000001.SZ', period='20231231')

# 资产负债表
df = pro.balance_sheet(ts_code='000001.SZ', period='20231231')

# 财务指标
df = pro.fina_indicator(ts_code='000001.SZ', period='20231231')
```

### 获取市场数据
```python
# 资金流向
df = pro.moneyflow(ts_code='000001.SZ', start_date='20240101', end_date='20240201')

# 涨跌停股票
df = pro.limit_list(trade_date='20240201')
```

---

## 注意事项

1. **Token 申请**: 需要在 https://tushare.pro 注册并申请 token
2. **积分系统**: 不同接口消耗不同积分，高频接口消耗更多
3. **数据更新**: 日线数据通常在收盘后 1-2 小时更新
4. **频次限制**: 免费用户有调用频次限制，详见积分频次表
5. **股票代码**: 所有股票代码必须带交易所后缀（.SH/.SZ/.BJ）
