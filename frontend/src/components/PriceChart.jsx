import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot,
} from 'recharts';
import { formatPrice, formatPriceShort, formatDateTime } from '../lib/format.js';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="viz-tip">
      <div className="t">{formatDateTime(p.scrapedAt)}</div>
      <div className="v">{formatPrice(p.price, p.currency)}</div>
      <div style={{ marginTop: 4, color: p.inStock ? 'var(--ok)' : 'var(--fail)', fontSize: 12 }}>
        {p.inStock ? `✓ In stock${p.stockQty != null ? ` · ${p.stockQty}` : ''}` : '✕ Out of stock'}
      </div>
    </div>
  );
}

function PricePoint(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  return (
    <Dot
      cx={cx} cy={cy} r={3.5}
      fill={payload.inStock ? 'var(--accent)' : 'var(--surface)'}
      stroke="var(--accent)"
      strokeWidth={2}
    />
  );
}

export default function PriceChart({ history }) {
  if (!history?.length) {
    return (
      <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        No successful scrapes yet — the chart fills in as scrapes succeed.
      </p>
    );
  }

  if (history.length === 1) {
    const only = history[0];
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
          {formatPrice(only.price, only.currency)}
        </div>
        <p style={{ fontSize: 12.5, margin: '6px 0 0', color: 'var(--text-muted)' }}>
          One data point so far ({formatDateTime(only.scrapedAt)}). A trend line needs at least two.
        </p>
      </div>
    );
  }

  const data = [...history].reverse();

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.15, max * 0.02, 1);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="scrapedAt"
          tickFormatter={(v) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          stroke="var(--border-strong)"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={[Math.max(0, min - pad), max + pad]}
          tickFormatter={formatPriceShort}
          stroke="var(--border-strong)"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={58}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }} />
        <Line
          type="monotone"
          dataKey="price"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={<PricePoint />}
          activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
          isAnimationActive={false}
          name="Price"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
