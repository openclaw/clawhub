#!/usr/bin/env python3
"""
中国银行股分析报告
分析主要国有大行的行情、估值和分红情况
"""

import sys
import pandas as pd
from datetime import datetime, timedelta

# 主要国有银行股代码
BANK_STOCKS = {
    '601398.SH': '工商银行',
    '601939.SH': '建设银行', 
    '601288.SH': '农业银行',
    '601988.SH': '中国银行',
    '601328.SH': '交通银行',
    '601658.SH': '邮储银行'
}

def check_tushare():
    """检查 tushare 是否安装"""
    try:
        import tushare as ts
        return ts
    except ImportError:
        print("请先安装 tushare: pip install tushare")
        sys.exit(1)

def get_token():
    """获取 Tushare Token"""
    import os
    token = os.getenv('TUSHARE_TOKEN')
    return token

def analyze_bank_stocks(ts):
    """分析银行股核心数据"""
    pro = ts.pro_api()
    
    # 获取最近一个交易日
    today = datetime.now()
    end_date = today.strftime('%Y%m%d')
    start_date = (today - timedelta(days=30)).strftime('%Y%m%d')
    
    # 获取最新每日指标数据
    stock_codes = ','.join(BANK_STOCKS.keys())
    
    print("=" * 80)
    print(f"中国银行股分析报告 - 数据日期: {today.strftime('%Y-%m-%d')}")
    print("=" * 80)
    
    # 1. 获取最新估值指标
    print("\n【一、最新估值指标】")
    print("-" * 80)
    
    try:
        daily_basic = pro.daily_basic(ts_code=stock_codes, trade_date='')
        if daily_basic is not None and len(daily_basic) > 0:
            # 获取最新日期
            latest_date = daily_basic['trade_date'].max()
            latest_data = daily_basic[daily_basic['trade_date'] == latest_date].copy()
            
            latest_data['股票名称'] = latest_data['ts_code'].map(BANK_STOCKS)
            latest_data['收盘价'] = latest_data['close'].round(2)
            latest_data['PE_TTM'] = latest_data['pe_ttm'].round(2)
            latest_data['PB'] = latest_data['pb'].round(2)
            latest_data['股息率(%)'] = latest_data['dv_ttm'].round(2)
            latest_data['总市值(亿)'] = (latest_data['total_mv'] / 10000).round(2)
            latest_data['流通市值(亿)'] = (latest_data['circ_mv'] / 10000).round(2)
            
            display_cols = ['股票名称', '收盘价', 'PE_TTM', 'PB', '股息率(%)', '总市值(亿)', '流通市值(亿)']
            result_df = latest_data[display_cols].sort_values('总市值(亿)', ascending=False)
            print(result_df.to_string(index=False))
        else:
            print("无法获取最新估值数据")
    except Exception as e:
        print(f"获取估值数据失败: {e}")
    
    # 2. 获取最新行情
    print("\n【二、最新行情】")
    print("-" * 80)
    
    try:
        latest_trade = pro.trade_cal(exchange='SSE', start_date=end_date, end_date=end_date, is_open='1')
        trade_date = None
        if len(latest_trade) > 0:
            trade_date = latest_trade.iloc[0]['cal_date']
        else:
            # 往前找交易日
            for i in range(1, 10):
                check_date = (today - timedelta(days=i)).strftime('%Y%m%d')
                latest_trade = pro.trade_cal(exchange='SSE', start_date=check_date, end_date=check_date, is_open='1')
                if len(latest_trade) > 0:
                    trade_date = check_date
                    break
        
        if trade_date is None:
            print("无法找到最近交易日")
            return
        
        daily = pro.daily(ts_code=stock_codes, trade_date=trade_date)
        if daily is not None and len(daily) > 0:
            daily['股票名称'] = daily['ts_code'].map(BANK_STOCKS)
            daily['开盘价'] = daily['open'].round(2)
            daily['最高价'] = daily['high'].round(2)
            daily['最低价'] = daily['low'].round(2)
            daily['收盘价'] = daily['close'].round(2)
            daily['涨跌幅(%)'] = daily['pct_chg'].round(2)
            daily['成交额(亿)'] = (daily['amount'] / 100000).round(2)
            
            display_cols = ['股票名称', '开盘价', '最高价', '最低价', '收盘价', '涨跌幅(%)', '成交额(亿)']
            result_df = daily[display_cols].sort_values('涨跌幅(%)', ascending=False)
            print(f"交易日: {trade_date}")
            print(result_df.to_string(index=False))
        else:
            print("无法获取行情数据")
    except Exception as e:
        print(f"获取行情数据失败: {e}")
    
    # 3. 获取分红数据
    print("\n【三、历史分红情况 (近5年)】")
    print("-" * 80)
    
    try:
        # 获取最近5年的分红数据
        for ts_code, name in BANK_STOCKS.items():
            try:
                dividend = pro.dividend(ts_code=ts_code)
                if dividend is not None and len(dividend) > 0:
                    # 按年度排序，取最近5年
                    dividend = dividend.head(5)
                    print(f"\n{name} ({ts_code}):")
                    
                    for _, row in dividend.iterrows():
                        end_date_str = row.get('end_date', '')
                        div_type = row.get('div_proc', '')
                        cash_div = row.get('cash_div_tax', 0)
                        stk_div = row.get('stk_div', 0)
                        
                        if pd.notna(cash_div) and cash_div > 0:
                            print(f"  {end_date_str[:4]}年度: 每股派息 {cash_div:.3f}元")
                else:
                    print(f"\n{name} ({ts_code}): 暂无分红数据")
            except Exception as e:
                print(f"\n{name} ({ts_code}): 获取分红数据失败 - {e}")
    except Exception as e:
        print(f"获取分红数据失败: {e}")
    
    # 4. 获取最新财务指标
    print("\n【四、最新财务指标】")
    print("-" * 80)
    
    try:
        # 获取最新报告期
        current_year = today.year
        # 尝试获取最新年报或三季报
        periods = [f'{current_year-1}1231', f'{current_year}0930']
        
        fina_data = []
        for ts_code, name in BANK_STOCKS.items():
            for period in periods:
                try:
                    fina = pro.fina_indicator(ts_code=ts_code, period=period)
                    if fina is not None and len(fina) > 0:
                        row = fina.iloc[0]
                        fina_data.append({
                            '股票名称': name,
                            '报告期': period[:4] + '-' + period[4:6] + '-' + period[6:],
                            'ROE(%)': round(row.get('roe', 0) or 0, 2),
                            'ROE_diluted(%)': round(row.get('roe_diluted', 0) or 0, 2),
                            '净利率(%)': round(row.get('netprofit_margin', 0) or 0, 2),
                            '资产负债率(%)': round(row.get('debt_to_assets', 0) or 0, 2)
                        })
                        break
                except:
                    continue
        
        if fina_data:
            fina_df = pd.DataFrame(fina_data)
            print(fina_df.to_string(index=False))
        else:
            print("无法获取财务指标数据")
    except Exception as e:
        print(f"获取财务指标失败: {e}")
    
    # 5. 获取今年以来涨跌幅
    print("\n【五、今年以来涨跌幅】")
    print("-" * 80)
    
    try:
        year_start = f"{today.year}0101"
        year_change_data = []
        
        for ts_code, name in BANK_STOCKS.items():
            try:
                # 获取年初和最新价格
                start_price = pro.daily(ts_code=ts_code, start_date=year_start, end_date=year_start)
                latest_price = pro.daily(ts_code=ts_code, trade_date=trade_date)
                
                if start_price is not None and len(start_price) > 0 and latest_price is not None and len(latest_price) > 0:
                    start_close = start_price.iloc[0]['close']
                    latest_close = latest_price.iloc[0]['close']
                    ytd_change = ((latest_close - start_close) / start_close * 100)
                    year_change_data.append({
                        '股票名称': name,
                        '年初价格': round(start_close, 2),
                        '最新价格': round(latest_close, 2),
                        '年初至今涨幅(%)': round(ytd_change, 2)
                    })
            except Exception as e:
                continue
        
        if year_change_data:
            ytd_df = pd.DataFrame(year_change_data)
            ytd_df = ytd_df.sort_values('年初至今涨幅(%)', ascending=False)
            print(ytd_df.to_string(index=False))
        else:
            print("无法获取年度涨跌幅数据")
    except Exception as e:
        print(f"获取年度涨跌幅失败: {e}")
    
    print("\n" + "=" * 80)
    print("数据来源: Tushare Pro")
    print("=" * 80)

def main():
    ts = check_tushare()
    token = get_token()
    
    if not token:
        print("警告: 未设置 TUSHARE_TOKEN 环境变量，使用免费额度")
    else:
        ts.set_token(token)
    
    analyze_bank_stocks(ts)

if __name__ == '__main__':
    main()
