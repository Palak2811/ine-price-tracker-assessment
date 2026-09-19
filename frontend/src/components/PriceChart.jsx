/**
 * Price history over time.
 *
 * Form: a line chart, because the job is change-over-time on a continuous
 * measure. One series, so there is no legend -- the card title names it.
 *
 * The series colour comes from a validated palette slot and is read from a CSS
 * custom property, so light and dark mode each get a step chosen for their own
 * surface instead of an automatic inversion.
 *
 * Only real scraped points are plotted. There is no interpolation across a
 * failed scrape and no synthetic data: a gap in the line is a gap in the
 * history, which is the honest representation.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot,
} from 'recharts';
import { formatPrice, formatPriceShort, formatDateTime } from '../lib/format.js';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="viz-tooltip">
      <div className="vt-time">{formatDateTime(p.scrapedAt)}</div>
      <div className="vt-val">{formatPrice(p.price, p.currency)}</div>
      <div style={{ marginTop: 4, color: p.inStock ? 'var(--good)' : 'var(--critical)', fontSize: '.78rem' }}>
        {p.inStock ? `✓ In stock${p.stockQty != null ? ` · ${p.stockQty}` : ''}` : '✕ Out of stock'}
      </div>
    </div>
  );
}

/** Out-of-stock points get a hollow marker, so stock state is not colour-only. */
function PricePoint(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  return (
    <Dot
      cx={cx} cy={cy} r={3.5}
      fill={payload.inStock ? 'var(--series-1)' : 'var(--surface-1)'}
      stroke="var(--series-1)"
      strokeWidth={2}
    />
  );
}

export default function PriceChart({ history }) {
  if (!history?.length) {
    return (
      <p className="muted" style={{ padding: '32px 0', textAlign: 'center', fontSize: '.88rem' }}>
        No successful scrapes yet — the chart fills in as scrapes succeed.
      </p>
    );
  }

  if (history.length === 1) {
    const only = history[0];
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <div className="value" style={{ fontSize: '2rem', fontWeight: 700 }}>
          {formatPrice(only.price, only.currency)}
        </div>
        <p className="muted" style={{ fontSize: '.85rem', margin: '6px 0 0' }}>
          One data point so far ({formatDateTime(only.scrapedAt)}). A trend line needs at least two.
        </p>
      </div>
    );
  }

  // Oldest → newest for a left-to-right time axis.
  const data = [...history].reverse();

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Pad the domain so a flat series is not drawn as a line glued to an edge.
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
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={<PricePoint />}
          activeDot={{ r: 5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', strokeWidth: 2 }}
          isAnimationActive={false}
          name="Price"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Stock over the same period, as a discrete strip rather than a second y-axis.
 *
 * Deliberately NOT plotted onto the price chart: two measures with different
 * scales on one plot means a dual axis, which misleads about correlation.
 */
export function StockTimeline({ history }) {
  if (!history?.length) return null;
  const data = [...history].reverse();

  return (
    <div>
      <div className="stock-strip" role="img"
           aria-label={`Stock status across ${data.length} scrapes, oldest to newest`}>
        {data.map((d, i) => (
          <div
            key={i}
            className={`stock-seg ${d.inStock ? 'in' : 'out'}`}
            title={`${formatDateTime(d.scrapedAt)} — ${d.inStock ? `In stock${d.stockQty != null ? ` (${d.stockQty})` : ''}` : 'Out of stock'}`}
          />
        ))}
      </div>
      <div className="row" style={{ marginTop: 8, fontSize: '.78rem', gap: 16 }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--good)' }} aria-hidden="true" />
          <span className="muted">In stock</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--critical)' }} aria-hidden="true" />
          <span className="muted">Out of stock</span>
        </span>
        <span className="spacer" />
        <span className="muted">oldest → newest</span>
      </div>
    </div>
  );
}
