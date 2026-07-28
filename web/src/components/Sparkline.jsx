// Tiny inline line chart for KPI cards. No axes, no tooltip — just the trend.
import { ResponsiveContainer, AreaChart, Area, LineChart, Line } from 'recharts';

export function Sparkline({ data, dataKey = 'value', color = 'hsl(var(--primary))', height = 40, type = 'line' }) {
  if (!data || data.length === 0) return <div style={{ height }} />;
  const id = `sl-${Math.random().toString(36).slice(2, 8)}`;

  if (type === 'area') {
    return (
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line dataKey={dataKey} stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
