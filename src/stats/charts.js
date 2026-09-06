// Lightweight Canvas 2D charts — no external dependencies
// Canvas has no var() support, so palette/text/track colors are read from
// theme.css custom properties at render time instead of being hardcoded here.

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartPalette() {
  return [
    token('--tg-accent', '#7c3aed'),
    token('--tg-info', '#22d3ee'),
    token('--tg-danger', '#ff4d6d'),
    token('--tg-success', '#3ddc97'),
    token('--tg-warning', '#ffa94d'),
    token('--tg-accent-strong', '#9257ff'),
    token('--tg-accent-soft', '#c9b8ff'),
    token('--tg-text-secondary', '#b6a8d1'),
  ];
}

/**
 * Render a horizontal bar chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number}[]} data
 * @param {{ unit?: string, maxValue?: number }} opts
 */
export function renderBarChart(canvas, data, opts = {}) {
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.clientWidth  || 500;
  const H      = Math.max(data.length * 32 + 40, 80);

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, W, H);

  const textColor  = token('--tg-text', '#f3eefc');

  if (!data.length) {
    ctx.fillStyle = token('--tg-text-muted', '#8577a3');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data for this period.', W / 2, H / 2);
    return;
  }

  const maxVal     = opts.maxValue || Math.max(...data.map(d => d.value), 1);
  const labelW     = Math.min(140, W * 0.28);
  const barAreaW   = W - labelW - 70; // right margin for value label
  const rowH       = 28;
  const barH       = 16;
  const startY     = 16;
  const trackColor = token('--tg-surface-2', '#241a35');
  const colors     = chartPalette();

  ctx.font = '12px system-ui, sans-serif';

  data.forEach(({ label, value }, i) => {
    const y      = startY + i * rowH;
    const barW   = Math.max((value / maxVal) * barAreaW, value > 0 ? 2 : 0);
    const color  = colors[i % colors.length];
    const valStr = opts.unit ? `${opts.unit}${value}` : String(value);

    // Track
    ctx.fillStyle = trackColor;
    ctx.beginPath();
    ctx.roundRect(labelW, y + (rowH - barH) / 2, barAreaW, barH, 3);
    ctx.fill();

    // Bar
    if (barW > 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(labelW, y + (rowH - barH) / 2, barW, barH, 3);
      ctx.fill();
    }

    // Label (left, truncated)
    ctx.fillStyle   = textColor;
    ctx.textAlign   = 'right';
    ctx.textBaseline = 'middle';
    const truncated = truncateText(ctx, label, labelW - 8);
    ctx.fillText(truncated, labelW - 6, y + rowH / 2);

    // Value (right)
    ctx.textAlign = 'left';
    ctx.fillText(valStr, labelW + barAreaW + 6, y + rowH / 2);
  });
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '…';
}
