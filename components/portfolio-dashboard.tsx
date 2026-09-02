'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react';
import { calculatePositionPnl } from '@/lib/pnl';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type DashboardView = 'overview' | 'ibkr' | 'longbridge';
type CalendarMode = 'month' | 'year';
type ValueMode = 'amount' | 'rate';
type Broker = 'IBKR' | 'LONGPORT';

type Holding = {
  broker: Broker;
  symbol: string;
  name: string;
  market: string;
  quantity: number;
  currency: 'USD' | 'HKD';
  cost: number;
  price: number;
  multiplier?: number;
  dailyPnl?: number | null;
  dayRate: number | null;
  realizedPnlNet: number;
  lifetimePnl?: number;
};

type LiveAccount = {
  connected: boolean;
  disabled?: boolean;
  nav?: number;
  dailyPnl?: number | null;
  sessionDate?: string;
  sessionLabel?: string;
  positions?: Holding[];
  lifetimeSource?: string;
  refreshError?: string;
};

type DailyReturn = {
  date: string;
  pnl: number;
  nav: number;
  rate: number;
  estimated?: boolean;
  cashFlow?: number;
};

type BenchmarkKey = 'nasdaq' | 'sp500' | 'dow';
type ComparisonRange = 'today' | 'month' | '1m' | '6m' | 'ytd' | '1y';

type LivePayload = {
  mode: 'live' | 'disconnected';
  updatedAt: string | null;
  accounts: { ibkr: LiveAccount; longbridge: LiveAccount };
  history?: { ibkr: DailyReturn[]; longbridge: DailyReturn[] };
  benchmarks?: Record<BenchmarkKey, {
    label: string;
    symbol: string;
    points: { date: string; close: number }[];
  }>;
  performanceRanges?: {
    longbridge?: Partial<Record<ComparisonRange, {
      startDate: string;
      endDate: string;
      pnl: number;
      rate: number;
      source: 'longbridge-twr';
    }>>;
  };
};

type ViewConfig = {
  title: string;
  subtitle: string;
  account: string;
  accent: string;
  refreshLabel: string;
};

const configs: Record<DashboardView, ViewConfig> = {
  overview: {
    title: '投资组合总览',
    subtitle: 'IBKR 与长桥的统一资产、收益和持仓视图',
    account: '已配置券商账户',
    accent: 'teal',
    refreshLabel: '更新全部数据',
  },
  ibkr: {
    title: 'IBKR 收益日历',
    subtitle: '独立查看 Interactive Brokers 的收益、净值与持仓',
    account: 'IBKR 账户',
    accent: 'teal',
    refreshLabel: '更新 IBKR 数据',
  },
  longbridge: {
    title: '长桥收益日历',
    subtitle: '独立查看长桥证券的收益、净值与持仓',
    account: '长桥账户',
    accent: 'gold',
    refreshLabel: '更新长桥数据',
  },
};

const monthNames = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];
const weekNames = ['日', '一', '二', '三', '四', '五', '六'];

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function localMoney(value: number, currency: Holding['currency']) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

function navHref(view: DashboardView) {
  return view === 'overview' ? '/' : view === 'ibkr' ? '/ibkr' : '/longbridge';
}

function BrokerMark({ broker }: { broker: Broker }) {
  return (
    <span className={`broker-mark ${broker === 'IBKR' ? 'ib' : 'lb'}`}>
      {broker === 'IBKR' ? 'IB' : 'L'}
    </span>
  );
}

export default function PortfolioDashboard({ view }: { view: DashboardView }) {
  const config = configs[view];
  const now = new Date();
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [valueMode, setValueMode] = useState<ValueMode>('amount');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [visible, setVisible] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('尚未手动更新');
  const [syncText, setSyncText] = useState('仅在点击更新按钮时读取券商数据');
  const [bridgeNonce, setBridgeNonce] = useState(0);
  const [livePortfolio, setLivePortfolio] = useState<LivePayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [benchmarkKey, setBenchmarkKey] = useState<BenchmarkKey>('sp500');
  const [comparisonRange, setComparisonRange] = useState<ComparisonRange>('1m');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const suffix = bridgeNonce > 0 ? '?refresh=1' : '';
        const response = await fetch(
          `http://127.0.0.1:4318/api/portfolio${suffix}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as LivePayload;
        if (active) {
          setLivePortfolio(payload);
          if (payload.updatedAt) {
            setUpdatedAt(
              new Date(payload.updatedAt).toLocaleString('zh-CN', {
                hour12: false,
              }),
            );
          }
          if (bridgeNonce > 0) {
            const selectedAccounts =
              view === 'ibkr'
                ? [payload.accounts.ibkr]
                : view === 'longbridge'
                  ? [payload.accounts.longbridge]
                  : [payload.accounts.ibkr, payload.accounts.longbridge];
            const failed = selectedAccounts.some((item) => item.refreshError);
            setSyncText(
              failed
                ? '手动更新已完成，部分已配置账户沿用上次成功缓存'
                : payload.accounts.longbridge.sessionLabel
                  ? `手动更新完成 · 长桥按${payload.accounts.longbridge.sessionLabel}口径归档`
                  : '手动更新完成 · 已保存今日真实账户数据',
            );
          }
        }
      } catch {
        if (active) setSyncText('无法连接本地数据桥，请确认桥接服务已启动');
      } finally {
        if (active) setRefreshing(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [bridgeNonce, view]);

  const liveAccounts = livePortfolio?.accounts;
  const isLive = livePortfolio?.mode === 'live';
  const scopedHoldings = useMemo(() => {
    const source = [
      ...(liveAccounts?.ibkr.connected
        ? liveAccounts.ibkr.positions || []
        : []),
      ...(liveAccounts?.longbridge.connected
        ? liveAccounts.longbridge.positions || []
        : []),
    ];
    return source.filter((item) => {
      if (view === 'ibkr') return item.broker === 'IBKR';
      if (view === 'longbridge') return item.broker === 'LONGPORT';
      return true;
    });
  }, [liveAccounts, view]);

  const calendarCells = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    return [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: days }, (_, index) => index + 1),
    ];
  }, [year, month]);

  const dailyHistory = useMemo(() => {
    const history = livePortfolio?.history;
    if (!history) return [];
    if (view === 'ibkr') return history.ibkr || [];
    if (view === 'longbridge') return history.longbridge || [];
    const ibkr = new Map((history.ibkr || []).map((item) => [item.date, item]));
    const longbridge = new Map((history.longbridge || []).map((item) => [item.date, item]));
    const dates = [...new Set([...ibkr.keys(), ...longbridge.keys()])].sort();
    const lastNav = { ibkr: 0, longbridge: 0 };
    const initialized = { ibkr: false, longbridge: false };
    return dates.map((date, index) => {
      const ibkrItem = ibkr.get(date);
      const longbridgeItem = longbridge.get(date);
      const previousNav = lastNav.ibkr + lastNav.longbridge;
      let openingCapital = 0;
      if (ibkrItem && !initialized.ibkr) {
        initialized.ibkr = true;
        openingCapital += ibkrItem.nav;
      }
      if (longbridgeItem && !initialized.longbridge) {
        initialized.longbridge = true;
        openingCapital += longbridgeItem.nav;
      }
      if (ibkrItem) lastNav.ibkr = ibkrItem.nav;
      if (longbridgeItem) lastNav.longbridge = longbridgeItem.nav;
      const nav = lastNav.ibkr + lastNav.longbridge;
      const cashFlow =
        (ibkrItem?.cashFlow || 0) +
        (longbridgeItem?.cashFlow || 0) +
        openingCapital;
      const pnl = index === 0
        ? (ibkrItem?.pnl || 0) + (longbridgeItem?.pnl || 0)
        : nav - previousNav - cashFlow;
      return {
        date,
        nav,
        pnl,
        cashFlow,
        rate: previousNav ? (pnl / previousNav) * 100 : 0,
        estimated: false,
      };
    });
  }, [livePortfolio?.history, view]);

  const selectedMonthHistory = useMemo(
    () =>
      dailyHistory.filter((item) => {
        const [itemYear, itemMonth] = item.date.split('-').map(Number);
        return itemYear === year && itemMonth === month;
      }),
    [dailyHistory, month, year],
  );
  const periodEndNav = useMemo(() => {
    const periodHistory =
      calendarMode === 'month'
        ? selectedMonthHistory
        : dailyHistory.filter((item) => item.date.startsWith(`${year}-`));
    if (!periodHistory.length) return undefined;
    return [...periodHistory].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
      ?.nav;
  }, [calendarMode, dailyHistory, selectedMonthHistory, year]);
  const monthPnl = selectedMonthHistory.reduce(
    (sum, item) => sum + item.pnl,
    0,
  );
  const monthRate =
    (selectedMonthHistory.reduce(
      (linked, item) => linked * (1 + item.rate / 100),
      1,
    ) -
      1) *
    100;
  const winDays = selectedMonthHistory.filter((item) => item.pnl > 0).length;
  const lossDays = selectedMonthHistory.filter((item) => item.pnl < 0).length;
  const drawdown = selectedMonthHistory.length
    ? Math.min(...selectedMonthHistory.map((item) => item.rate))
    : null;

  const monthlyReturns = useMemo(
    () =>
      monthNames.map((name, index) => {
        const items = dailyHistory.filter((item) => {
          const [itemYear, itemMonth] = item.date.split('-').map(Number);
          return itemYear === year && itemMonth === index + 1;
        });
        return {
          name,
          hasData: items.length > 0,
          value: items.reduce((sum, item) => sum + item.pnl, 0),
          rate:
            (items.reduce((linked, item) => linked * (1 + item.rate / 100), 1) -
              1) *
            100,
        };
      }),
    [dailyHistory, year],
  );

  const comparisonData = useMemo(() => {
    const allBenchmark = livePortfolio?.benchmarks?.[benchmarkKey]?.points || [];
    const latestPortfolio = dailyHistory.map((item) => item.date).sort((a, b) => a.localeCompare(b)).at(-1);
    const latestBenchmark = allBenchmark.map((item) => item.date).sort((a, b) => a.localeCompare(b)).at(-1);
    const latestDate = latestPortfolio && latestBenchmark
      ? [latestPortfolio, latestBenchmark].sort((a, b) => a.localeCompare(b))[0]
      : latestPortfolio || latestBenchmark;
    if (!latestDate) return [];
    const shift = (months: number, years = 0) => {
      const value = new Date(`${latestDate}T00:00:00Z`);
      value.setUTCMonth(value.getUTCMonth() - months);
      value.setUTCFullYear(value.getUTCFullYear() - years);
      return value.toISOString().slice(0, 10);
    };
    const start = comparisonRange === 'today'
      ? latestDate
      : comparisonRange === 'month'
        ? `${latestDate.slice(0, 7)}-01`
        : comparisonRange === '1m'
          ? shift(1)
          : comparisonRange === '6m'
            ? shift(6)
            : comparisonRange === 'ytd'
              ? `${latestDate.slice(0, 4)}-01-01`
              : shift(0, 1);
    const portfolio = dailyHistory.filter((item) => item.date >= start && item.date <= latestDate);
    const benchmark = allBenchmark.filter((item) => item.date >= start && item.date <= latestDate);
    const dates = [...new Set([...portfolio.map((item) => item.date), ...benchmark.map((item) => item.date)])].sort();
    const portfolioByDate = new Map(portfolio.map((item) => [item.date, item]));
    const benchmarkByDate = new Map(benchmark.map((item) => [item.date, item.close]));
    const baseline = [...allBenchmark]
      .filter((item) => item.date < start)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.close ?? benchmark[0]?.close;
    let linked = 1;
    let lastBenchmark = baseline;
    return dates.map((date) => {
      const daily = portfolioByDate.get(date);
      if (daily) linked *= 1 + daily.rate / 100;
      lastBenchmark = benchmarkByDate.get(date) ?? lastBenchmark;
      return {
        date: date.slice(5).replace('-', '/'),
        fullDate: date,
        portfolio: (linked - 1) * 100,
        benchmark: baseline && lastBenchmark ? (lastBenchmark / baseline - 1) * 100 : null,
      };
    });
  }, [benchmarkKey, comparisonRange, dailyHistory, livePortfolio?.benchmarks]);
  const officialRange = view === 'longbridge' && comparisonRange !== 'today'
    ? livePortfolio?.performanceRanges?.longbridge?.[comparisonRange]
    : undefined;
  const displayedComparisonData = useMemo(() => {
    const rawFinal = comparisonData.at(-1)?.portfolio;
    if (!officialRange || rawFinal === undefined || comparisonData.length < 2) return comparisonData;
    const correction = officialRange.rate - rawFinal;
    return comparisonData.map((item, index) => ({
      ...item,
      portfolio: item.portfolio + correction * (index / (comparisonData.length - 1)),
    }));
  }, [comparisonData, officialRange]);
  const comparisonSummary = displayedComparisonData.at(-1);
  const benchmarkLabel = livePortfolio?.benchmarks?.[benchmarkKey]?.label ||
    ({ nasdaq: '纳斯达克', sp500: '标普 500', dow: '道琼斯' } as const)[benchmarkKey];

  const hide = (value: string) => (visible ? value : '••••••••');
  const previousMonth = () =>
    month === 1
      ? (setMonth(12), setYear((value) => value - 1))
      : setMonth((value) => value - 1);
  const nextMonth = () =>
    month === 12
      ? (setMonth(1), setYear((value) => value + 1))
      : setMonth((value) => value + 1);

  const refresh = () => {
    setRefreshing(true);
    setSyncText(
      view === 'ibkr' ? '正在从 TWS 手动读取账户…' : '正在手动读取券商账户…',
    );
    setNoticeOpen(true);
    setBridgeNonce((value) => value + 1);
  };

  const exportCsv = () => {
    const rows = [
      ['Broker', 'Symbol', 'Name', 'Quantity', 'Currency', 'Cost', 'Price'],
      ...scopedHoldings.map((item) => [
        item.broker,
        item.symbol,
        item.name,
        String(item.quantity),
        item.currency,
        String(item.cost),
        String(item.price),
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${view}-portfolio-2026-${String(month).padStart(2, '0')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="dashboard-shell">
      <div className="dashboard-wrap">
        <header className="hero-bar">
          <div className="title-cluster">
            <div className={`app-icon ${config.accent}`}>
              <CalendarDays size={25} />
            </div>
            <div>
              <h1>{config.title}</h1>
              <p>{config.subtitle}</p>
            </div>
          </div>
          <div className="hero-actions">
            <button className="button cache">
              <Database size={16} />
              本地缓存
            </button>
            <button
              className="button secondary"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={16} />
              连接设置
            </button>
            <button className="button secondary" onClick={exportCsv}>
              <Download size={16} />
              导出当前视图
            </button>
            <button
              className="button primary"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw size={17} />
              {refreshing ? '正在更新…' : config.refreshLabel}
            </button>
          </div>
        </header>

        <nav className="route-tabs" aria-label="券商页面">
          {(
            [
              ['overview', '组合总览', LayoutDashboard],
              ['ibkr', 'Interactive Brokers', Building2],
              ['longbridge', '长桥证券', Landmark],
            ] as const
          ).map(([item, label, Icon]) => (
            <a
              key={item}
              href={navHref(item)}
              className={view === item ? 'active' : ''}
            >
              <Icon size={17} />
              <span>{label}</span>
              {view === item && <i />}
            </a>
          ))}
          <button
            className="privacy-button"
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <Eye size={16} /> : <EyeOff size={16} />}
            {visible ? '隐藏金额' : '显示金额'}
          </button>
        </nav>

        {noticeOpen && (
          <section className="notice-banner" aria-live="polite">
            <AlertTriangle size={19} />
            <div>
              <b>{isLive ? '正在显示本地真实数据缓存' : '尚未保存券商数据'}</b>
              <p>
                {isLive
                  ? '不会后台轮询；只有点击更新按钮才连接已配置券商。日历只展示已保存的真实账户日。'
                  : '请先配置至少一个券商并启动本地数据桥。页面不会填充任何演示收益。'}
              </p>
            </div>
            <button aria-label="关闭提示" onClick={() => setNoticeOpen(false)}>
              <X size={18} />
            </button>
          </section>
        )}

        <section className="account-strip">
          <div className="account-identity">
            {view === 'overview' ? (
              <span className="combined-mark">
                <WalletCards size={21} />
              </span>
            ) : (
              <BrokerMark broker={view === 'ibkr' ? 'IBKR' : 'LONGPORT'} />
            )}
            <div>
              <b>{config.account}</b>
              <span>USD · TWR · 只读</span>
            </div>
          </div>
          {view === 'overview' && (
            <div className="account-split">
              <span>
                <BrokerMark broker="IBKR" />
                <i>IBKR</i>
                <b>
                  {hide(
                    liveAccounts?.ibkr.connected && liveAccounts.ibkr.nav
                      ? usd(liveAccounts.ibkr.nav)
                      : '—',
                  )}
                </b>
              </span>
              <span>
                <BrokerMark broker="LONGPORT" />
                <i>长桥</i>
                <b>
                  {hide(
                    liveAccounts?.longbridge.connected &&
                      liveAccounts.longbridge.nav
                      ? usd(liveAccounts.longbridge.nav)
                      : '—',
                  )}
                </b>
              </span>
            </div>
          )}
          <div className="updated">
            <Clock3 size={15} />
            更新至 {updatedAt}
          </div>
        </section>

        <section className="calendar-controls">
          <div className="control-group">
            <span className="control-label">视图</span>
            <div className="segmented">
              <button
                className={calendarMode === 'month' ? 'active' : ''}
                onClick={() => setCalendarMode('month')}
              >
                月
              </button>
              <button
                className={calendarMode === 'year' ? 'active' : ''}
                onClick={() => setCalendarMode('year')}
              >
                年
              </button>
            </div>
          </div>
          <div className="date-controls">
            <button
              className="square"
              aria-label="上一个月"
              onClick={previousMonth}
            >
              <ChevronLeft size={20} />
            </button>
            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              aria-label="年份"
            >
              <option>2025</option>
              <option>2026</option>
            </select>
            {calendarMode === 'month' && (
              <select
                value={month}
                onChange={(event) => setMonth(Number(event.target.value))}
                aria-label="月份"
              >
                {monthNames.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="square"
              aria-label="下一个月"
              onClick={nextMonth}
            >
              <ChevronRight size={20} />
            </button>
            <button
              className="back-latest"
              onClick={() => {
                const latest = new Date();
                setYear(latest.getFullYear());
                setMonth(latest.getMonth() + 1);
              }}
            >
              <RotateCcw size={15} />
              回到最新
            </button>
          </div>
          <div className="control-group display-mode">
            <span className="control-label">显示</span>
            <div className="segmented">
              <button
                className={valueMode === 'amount' ? 'active' : ''}
                onClick={() => setValueMode('amount')}
              >
                收益金额
              </button>
              <button
                className={valueMode === 'rate' ? 'active' : ''}
                onClick={() => setValueMode('rate')}
              >
                收益率
              </button>
            </div>
          </div>
        </section>

        <p className="sync-caption">
          <CheckCircle2 size={14} />
          {syncText}
        </p>

        <section className="metric-row">
          <article>
            <span>当月收益金额</span>
            <strong className={monthPnl >= 0 ? 'profit' : 'loss'}>
              {selectedMonthHistory.length
                ? hide(`${monthPnl >= 0 ? '+' : '−'}${usd(Math.abs(monthPnl))}`)
                : '—'}
            </strong>
            <small>已保存账户日盈亏合计</small>
          </article>
          <article>
            <span>当月收益率</span>
            <strong className={monthRate >= 0 ? 'profit' : 'loss'}>
              {selectedMonthHistory.length
                ? `${monthRate >= 0 ? '+' : ''}${monthRate.toFixed(2)}%`
                : '—'}
            </strong>
            <small>真实日收益率几何链接</small>
          </article>
          <article>
            <span>盈利 / 亏损日</span>
            <strong>
              {winDays} / {lossDays}
            </strong>
            <small>{selectedMonthHistory.length} 个已保存账户日</small>
          </article>
          <article>
            <span>最大单日回撤</span>
            <strong className="loss">
              {drawdown === null ? '—' : `${drawdown.toFixed(2)}%`}
            </strong>
            <small>按最差真实账户日</small>
          </article>
          <article>
            <span>期末 NAV</span>
            <strong>
              {periodEndNav === undefined ? '—' : hide(usd(periodEndNav))}
            </strong>
            <small>{selectedMonthHistory.length} 个已确认账户日</small>
          </article>
        </section>

        {calendarMode === 'month' ? (
          <section className="calendar-panel">
            <div className="section-heading">
              <div>
                <span>收益日历（USD）</span>
                <h2>
                  {year}/{String(month).padStart(2, '0')}
                </h2>
              </div>
              <div className="legend-row">
                <span>
                  <i className="profit-dot" />
                  盈利
                </span>
                <span>
                  <i className="loss-dot" />
                  亏损
                </span>
                <span>
                  <i className="empty-dot" />
                  无数据
                </span>
              </div>
            </div>
            <div className="week-grid">
              {weekNames.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {calendarCells.map((day, index) => {
                if (day === null)
                  return (
                    <div
                      className="calendar-day outside"
                      key={`empty-${index}`}
                    />
                  );
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const entry = dailyHistory.find(
                  (item) => item.date === dateKey,
                );
                const amount = entry?.pnl ?? null;
                const rate = entry?.rate ?? null;
                const cellDate = new Date(year, month - 1, day);
                const today = new Date();
                cellDate.setHours(0, 0, 0, 0);
                today.setHours(0, 0, 0, 0);
                const isFuture = cellDate > today;
                const isWeekend =
                  cellDate.getDay() === 0 || cellDate.getDay() === 6;
                const status = entry
                  ? entry.estimated
                    ? '估算'
                    : '已确认'
                  : isFuture
                    ? '未发生'
                    : isWeekend
                      ? '休市'
                      : '暂无数据';
                const tone =
                  amount === null ? 'empty' : amount >= 0 ? 'profit' : 'loss';
                return (
                  <article className={`calendar-day ${tone}`} key={day}>
                    <span>{String(day).padStart(2, '0')}</span>
                    <strong>
                      {amount === null
                        ? '—'
                        : valueMode === 'amount'
                          ? `${amount >= 0 ? '+' : '−'}${Math.abs(amount) >= 1000 ? `${(Math.abs(amount) / 1000).toFixed(2)}K` : Math.abs(amount).toFixed(0)}`
                          : `${rate! >= 0 ? '+' : ''}${rate!.toFixed(2)}%`}
                    </strong>
                    <small>{status}</small>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="calendar-panel year-panel">
            <div className="section-heading">
              <div>
                <span>年度收益（USD）</span>
                <h2>{year}</h2>
              </div>
              <div className="legend-row">
                <span>
                  <i className="profit-dot" />
                  盈利月
                </span>
                <span>
                  <i className="loss-dot" />
                  亏损月
                </span>
              </div>
            </div>
            <div className="year-grid">
              {monthlyReturns.map((item, index) => (
                <button
                  key={item.name}
                  className={
                    !item.hasData
                      ? 'empty'
                      : item.value >= 0
                        ? 'profit'
                        : 'loss'
                  }
                  onClick={() => {
                    setMonth(index + 1);
                    setCalendarMode('month');
                  }}
                >
                  <span>{item.name}</span>
                  <strong>
                    {!item.hasData
                      ? '—'
                      : valueMode === 'amount'
                        ? `${item.value >= 0 ? '+' : '−'}${usd(Math.abs(item.value))}`
                        : `${item.rate >= 0 ? '+' : ''}${item.rate.toFixed(2)}%`}
                  </strong>
                  <small>
                    查看每日明细 <ChevronRight size={13} />
                  </small>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="comparison-panel">
          <div className="section-heading comparison-heading">
            <div>
              <span>PERFORMANCE COMPARISON</span>
              <h2>组合收益率对比</h2>
            </div>
            <div className="benchmark-tabs" aria-label="选择比较基准">
              {([['nasdaq', '纳斯达克'], ['sp500', '标普 500'], ['dow', '道琼斯']] as const).map(([key, label]) => (
                <button key={key} className={benchmarkKey === key ? 'active' : ''} onClick={() => setBenchmarkKey(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="comparison-range-row">
            <div className="range-tabs" aria-label="选择比较区间">
              {([['today', '今日'], ['month', '本月'], ['1m', '近1月'], ['6m', '近6月'], ['ytd', 'YTD'], ['1y', '近1年']] as const).map(([key, label]) => (
                <button key={key} className={comparisonRange === key ? 'active' : ''} onClick={() => setComparisonRange(key)}>
                  {label}
                </button>
              ))}
            </div>
            {displayedComparisonData.length > 0 && (
              <span>{officialRange?.startDate || displayedComparisonData[0].fullDate} 至 {officialRange?.endDate || displayedComparisonData.at(-1)!.fullDate}</span>
            )}
          </div>
          {displayedComparisonData.length && comparisonSummary ? (
            <>
              <div className="comparison-stats">
                <span>我的组合 <b>{comparisonSummary.portfolio >= 0 ? '+' : ''}{comparisonSummary.portfolio.toFixed(2)}%</b></span>
                <span>{benchmarkLabel} <b>{comparisonSummary.benchmark !== null && comparisonSummary.benchmark >= 0 ? '+' : ''}{comparisonSummary.benchmark?.toFixed(2) ?? '—'}%</b></span>
                <span>超额收益 <b>{comparisonSummary.benchmark === null ? '—' : `${comparisonSummary.portfolio - comparisonSummary.benchmark >= 0 ? '+' : ''}${(comparisonSummary.portfolio - comparisonSummary.benchmark).toFixed(2)}%`}</b></span>
                {officialRange && <span className="official-source">组合采用长桥官方 TWR</span>}
              </div>
              <div className="comparison-legend" aria-label="图表颜色说明">
                <span><i className="portfolio-line" />我的组合</span>
                <span><i className="benchmark-line" />{benchmarkLabel}</span>
              </div>
              <div className="comparison-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={displayedComparisonData} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="#263b48" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="date" stroke="#71838e" tickLine={false} axisLine={false} fontSize={10} minTickGap={28} />
                    <YAxis stroke="#71838e" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `${value.toFixed(0)}%`} />
                    <Tooltip contentStyle={{ background: '#0c1c27', border: '1px solid #263b48', borderRadius: 10, fontSize: 11 }} formatter={(value) => [`${Number(value).toFixed(2)}%`]} />
                    <Line type="monotone" dataKey="portfolio" name="我的组合" stroke="#ff6e3a" strokeWidth={2.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="benchmark" name={benchmarkLabel} stroke="#4c91ff" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="comparison-empty">点击“更新”获取指数行情后即可比较</div>
          )}
        </section>

        <section className="holdings-panel">
          <div className="section-heading holdings-heading">
            <div>
              <span>POSITIONS</span>
              <h2>
                {view === 'overview'
                  ? '全部持仓'
                  : view === 'ibkr'
                    ? 'IBKR 持仓'
                    : '长桥持仓'}
              </h2>
            </div>
            <p>
              {scopedHoldings.length} 个标的 · 默认按“已实现 +
              当前浮盈”计算累计收益
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>标的</th>
                  {view === 'overview' && <th>券商</th>}
                  <th className="number">数量</th>
                  <th className="number">持仓成本</th>
                  <th className="number">摊薄成本</th>
                  <th className="number">现价</th>
                  <th className="number">市值</th>
                  <th className="number">今日</th>
                  <th className="number">持仓浮盈</th>
                  <th className="number">已实现</th>
                  <th className="number">累计总收益</th>
                </tr>
              </thead>
              <tbody>
                {scopedHoldings.map((item) => {
                  const multiplier = item.multiplier ?? 1;
                  const calculatedUnrealized =
                    item.quantity * multiplier * (item.price - item.cost);
                  const realizedPnlNet =
                    item.lifetimePnl === undefined
                      ? item.realizedPnlNet
                      : item.lifetimePnl - calculatedUnrealized;
                  const pnl = calculatePositionPnl({
                    quantity: item.quantity,
                    multiplier,
                    marketPrice: item.price,
                    openAverageCost: item.cost,
                    realizedPnlNet,
                  });
                  return (
                    <tr key={`${item.broker}-${item.symbol}`}>
                      <td>
                        <div className="holding-name">
                          <BrokerMark broker={item.broker} />
                          <div>
                            <b>{item.symbol}</b>
                            <span>
                              {item.name} · {item.market}
                            </span>
                          </div>
                        </div>
                      </td>
                      {view === 'overview' && (
                        <td>
                          <span
                            className={`broker-tag ${item.broker === 'IBKR' ? 'ib' : 'lb'}`}
                          >
                            {item.broker === 'IBKR' ? 'IBKR' : '长桥'}
                          </span>
                        </td>
                      )}
                      <td className="number">
                        <b>{item.quantity.toLocaleString()}</b>
                        <span>{item.currency}</span>
                      </td>
                      <td className="number">
                        {hide(localMoney(item.cost, item.currency))}
                        <span>剩余仓位口径</span>
                      </td>
                      <td className="number">
                        <b>
                          {hide(
                            pnl.dilutedCost === null
                              ? '—'
                              : localMoney(pnl.dilutedCost, item.currency),
                          )}
                        </b>
                        <span>含历史卖出</span>
                      </td>
                      <td className="number">
                        <b>{hide(localMoney(item.price, item.currency))}</b>
                      </td>
                      <td className="number">
                        <b>
                          {hide(localMoney(pnl.marketValue, item.currency))}
                        </b>
                      </td>
                      <td
                        className={`number ${item.dayRate === null ? '' : item.dayRate >= 0 ? 'profit-text' : 'loss-text'}`}
                      >
                        {item.dayRate === null
                          ? '—'
                          : `${item.dayRate >= 0 ? '+' : ''}${item.dayRate.toFixed(2)}%`}
                      </td>
                      <td
                        className={`number ${pnl.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}
                      >
                        <b>
                          {hide(
                            `${pnl.unrealizedPnl >= 0 ? '+' : '−'}${localMoney(Math.abs(pnl.unrealizedPnl), item.currency)}`,
                          )}
                        </b>
                        <span>
                          {item.price >= item.cost ? '+' : ''}
                          {((item.price / item.cost - 1) * 100).toFixed(2)}%
                        </span>
                      </td>
                      <td
                        className={`number ${realizedPnlNet >= 0 ? 'profit-text' : 'loss-text'}`}
                      >
                        <b>
                          {hide(
                            `${realizedPnlNet >= 0 ? '+' : '−'}${localMoney(Math.abs(realizedPnlNet), item.currency)}`,
                          )}
                        </b>
                        <span>已扣交易费用</span>
                      </td>
                      <td
                        className={`number lifetime-pnl ${pnl.lifetimePnl >= 0 ? 'profit-text' : 'loss-text'}`}
                      >
                        <b>
                          {hide(
                            `${pnl.lifetimePnl >= 0 ? '+' : '−'}${localMoney(Math.abs(pnl.lifetimePnl), item.currency)}`,
                          )}
                        </b>
                        <span>
                          {pnl.recovered
                            ? '已回本'
                            : `${pnl.lifetimeReturnRate! >= 0 ? '+' : ''}${pnl.lifetimeReturnRate!.toFixed(2)}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <footer>
          <span>
            <ShieldCheck size={14} />
            只读看板，不请求交易权限
          </span>
          <span>基准币种 USD · 仅手动更新 · 数据仅供个人记录</span>
        </footer>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop">
          <dialog
            open
            className="settings-modal"
            aria-labelledby="settings-title"
          >
            <div className="modal-title">
              <div>
                <span>CONNECTIONS</span>
                <h2 id="settings-title">券商连接设置</h2>
              </div>
              <button
                aria-label="关闭设置"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="connection-item">
              <BrokerMark broker="IBKR" />
              <div>
                <b>Interactive Brokers</b>
                <span>TWS Socket · localhost · 只读</span>
              </div>
              <em>
                {liveAccounts?.ibkr.disabled
                  ? '未配置'
                  : liveAccounts?.ibkr.connected
                    ? '已缓存'
                    : '待更新'}
              </em>
            </div>
            <div className="connection-item">
              <BrokerMark broker="LONGPORT" />
              <div>
                <b>长桥 OpenAPI</b>
                <span>官方 CLI OAuth · 只读</span>
              </div>
              <em>
                {liveAccounts?.longbridge.disabled
                  ? '未配置'
                  : liveAccounts?.longbridge.connected
                    ? '已缓存'
                    : '待更新'}
              </em>
            </div>
            <p>
              页面不会后台轮询；点击更新时才读取账户，并把当天汇总保存到本机。
            </p>
            <button
              className="button primary modal-done"
              onClick={() => setSettingsOpen(false)}
            >
              知道了
            </button>
          </dialog>
        </div>
      )}
    </main>
  );
}
