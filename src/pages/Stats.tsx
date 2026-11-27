import React from 'react';
import { useAppStore } from '../stores';
import { formatDuration, localDateStr } from '../utils';
import { StatsIcon } from '../components/Icons';

// 柱状图上方的紧凑时长（1h20m / 45m / <1m）
function formatShortDuration(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return '<1m';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export default function Stats() {
  const books = useAppStore(s => s.books);
  const readingStats = useAppStore(s => s.readingStats);
  const vocabulary = useAppStore(s => s.vocabulary);

  // Calculate totals
  const totalSeconds = readingStats.reduce((sum, s) => sum + s.duration, 0);
  const todayStr = localDateStr(new Date());
  const todaySeconds = readingStats
    .filter(s => s.date === todayStr)
    .reduce((sum, s) => sum + s.duration, 0);

  // 已读完的书（progress ≥ 0.99）
  const finishedBooks = books.filter(b => (b.progress ?? 0) >= 0.99);
  // 完成时间：优先 finishedAt，老数据用 lastReadAt 兜底
  const finishTimeOf = (b: typeof books[number]) => b.finishedAt || b.lastReadAt || 0;

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  const finishedThisYear = finishedBooks.filter(b => {
    const t = finishTimeOf(b);
    return t > 0 && new Date(t).getFullYear() === thisYear;
  });
  const finishedThisMonth = finishedBooks.filter(b => {
    const t = finishTimeOf(b);
    if (!t) return false;
    const d = new Date(t);
    return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
  });

  // Last 7 days chart
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = localDateStr(d);
    const daySeconds = readingStats
      .filter(s => s.date === dateStr)
      .reduce((sum, s) => sum + s.duration, 0);
    return {
      date: dateStr,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      seconds: daySeconds,
    };
  });

  const maxDaySeconds = Math.max(...last7Days.map(d => d.seconds), 60); // at least 1 min

  return (
    <div className="page-content">
      <div className="stats-header">
        <h1>阅读统计</h1>
      </div>

      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-value">{formatDuration(todaySeconds)}</div>
          <div className="stat-label">今日阅读</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatDuration(totalSeconds)}</div>
          <div className="stat-label">累计阅读</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{books.length}</div>
          <div className="stat-label">在读书籍</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{vocabulary.length}</div>
          <div className="stat-label">生词数量</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{finishedThisYear.length}</div>
          <div className="stat-label">今年读完</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{finishedThisMonth.length}</div>
          <div className="stat-label">本月读完</div>
        </div>
      </div>

      <div className="stats-chart">
        <h3>最近 7 天</h3>
        <div className="chart-bars">
          {last7Days.map(day => (
            <div key={day.date} className="chart-bar-wrapper">
              <span className="chart-bar-value">
                {day.seconds > 0 ? formatShortDuration(day.seconds) : '—'}
              </span>
              <div
                className="chart-bar"
                style={{ height: `${(day.seconds / maxDaySeconds) * 100}%` }}
                title={`${formatDuration(day.seconds)}`}
              />
              <span className="chart-bar-label">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      {books.length === 0 && (
        <div className="empty-state">
          <StatsIcon />
          <p>暂无阅读数据</p>
          <small>开始阅读后这里会显示你的阅读统计</small>
        </div>
      )}
    </div>
  );
}
