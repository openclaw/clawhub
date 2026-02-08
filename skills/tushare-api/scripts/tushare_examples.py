#!/usr/bin/env python3
"""
Tushare API 示例脚本
展示如何使用 Tushare Pro API 获取股票数据
"""

import sys
import pandas as pd

# 使用示例前需要安装: pip install tushare
try:
    import tushare as ts
except ImportError:
    print("请先安装 tushare: pip install tushare")
    sys.exit(1)


def get_stock_list():
    """获取所有正常上市的股票列表"""
    pro = ts.pro_api()
    df = pro.stock_basic(
        exchange='', 
        list_status='L', 
        fields='ts_code,symbol,name,area,industry,list_date'
    )
    return df


def get_daily_price(ts_code, start_date, end_date):
    """
    获取股票日线行情
    
    Args:
        ts_code: 股票代码，如 '000001.SZ'
        start_date: 开始日期，如 '20240101'
        end_date: 结束日期，如 '20240201'
    """
    pro = ts.pro_api()
    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
    return df


def get_daily_indicators(ts_code, start_date, end_date):
    """
    获取每日指标（PE/PB/市值等）
    
    Args:
        ts_code: 股票代码
        start_date: 开始日期
        end_date: 结束日期
    """
    pro = ts.pro_api()
    df = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=end_date)
    return df


def get_income(ts_code, period):
    """
    获取利润表数据
    
    Args:
        ts_code: 股票代码
        period: 报告期，如 '20231231' 表示2023年年报
    """
    pro = ts.pro_api()
    df = pro.income(ts_code=ts_code, period=period)
    return df


def get_money_flow(ts_code, start_date, end_date):
    """
    获取资金流向数据
    
    Args:
        ts_code: 股票代码
        start_date: 开始日期
        end_date: 结束日期
    """
    pro = ts.pro_api()
    df = pro.moneyflow(ts_code=ts_code, start_date=start_date, end_date=end_date)
    return df


def get_limit_list(trade_date):
    """
    获取涨跌停股票列表
    
    Args:
        trade_date: 交易日期，如 '20240201'
    """
    pro = ts.pro_api()
    df = pro.limit_list(trade_date=trade_date)
    return df


def main():
    """主函数示例"""
    import os
    
    # 从环境变量获取 token，或手动设置
    token = os.getenv('TUSHARE_TOKEN')
    if not token:
        print("请设置 TUSHARE_TOKEN 环境变量或在代码中设置 token")
        print("示例: export TUSHARE_TOKEN='your_token_here'")
        return
    
    # 设置 token
    ts.set_token(token)
    
    # 示例1: 获取股票列表
    print("=" * 50)
    print("示例1: 获取股票列表（前10条）")
    print("=" * 50)
    stocks = get_stock_list()
    print(stocks.head(10))
    
    # 示例2: 获取日线行情
    print("\n" + "=" * 50)
    print("示例2: 获取平安银行(000001.SZ)日线行情")
    print("=" * 50)
    daily = get_daily_price('000001.SZ', '20240101', '20240110')
    print(daily)
    
    # 示例3: 获取每日指标
    print("\n" + "=" * 50)
    print("示例3: 获取每日指标（PE/PB）")
    print("=" * 50)
    indicators = get_daily_indicators('000001.SZ', '20240101', '20240110')
    print(indicators[['ts_code', 'trade_date', 'pe', 'pb', 'total_mv']])


if __name__ == '__main__':
    main()
