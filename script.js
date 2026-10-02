const TF = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' };

const state = {
  tf: '5m',
  data: [],
  ws: null,
  gen: 0,
  showHeatmap: true,
  showProfile: true,
  mouseX: null,
  mouseY: null,
  hoverIndex: null,
};

const ui = {
  canvas: document.getElementById('chartCanvas'),
  tfRoot: document.getElementById('tf'),
  miniPrice: document.getElementById('miniPrice'),
  miniDelta: document.getElementById('miniDelta'),
  lastPrice: document.getElementById('lastPrice'),
  priceChange: document.getElementById('priceChange'),
  bidAsk: document.getElementById('bidAsk'),
  spreadValue: document.getElementById('spreadValue'),
  statOpen: document.getElementById('statOpen'),
  statHigh: document.getElementById('statHigh'),
  statLow: document.getElementById('statLow'),
  statRange: document.getElementById('statRange'),
  statVolume: document.getElementById('statVolume'),
  pocVal: document.getElementById('pocVal'),
  vahVal: document.getElementById('vahVal'),
  valVal: document.getElementById('valVal'),
  ohlcDisplay: document.getElementById('ohlcDisplay'),
  connectionStatus: document.getElementById('connectionStatus'),
  statusDot: document.getElementById('statusDot'),
  cursorLiquidity: document.getElementById('cursorLiquidity'),
  cursorPrice: document.getElementById('cursorPrice'),
  sessionRange: document.getElementById('sessionRange'),
  sessionTag: document.getElementById('sessionTag'),
};

const ctx = ui.canvas.getContext('2d');
const h = (a, b) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function strength(p) {
  const k0 = Math.round(p / 5);
  let s = 0;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const g = k * 5;
    const w = 0.2 + 0.45 * h(k, 7) + (k % 2 ? 0 : 0.2) + (k % 10 ? 0 : 0.35) + (k % 20 ? 0 : 0.2);
    s += w * Math.exp(-Math.pow((p - g) / 0.7, 2));
  }
  return Math.min(s, 1.2);
}

function formatNumber(num, digits = 2) {
  if (!Number.isFinite(num)) return '--';
  return Number(num).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatCompact(num) {
  if (!Number.isFinite(num)) return '--';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(Math.round(num));
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ramp(v) {
  const S = [
    [30, 58, 138],
    [109, 40, 217],
    [219, 39, 119],
    [249, 115, 22],
    [253, 224, 71],
  ];
  v = Math.max(0, Math.min(1, v)) * 4;
  const i = Math.min(3, Math.floor(v));
  const f = v - i;
  return S[i].map((c, j) => Math.round(c + (S[i + 1][j] - c) * f));
}

function setStatus(message, active = true) {
  ui.connectionStatus.textContent = message;
  ui.statusDot.style.background = active ? '#fbbf24' : '#ef4444';
  ui.statusDot.style.boxShadow = active ? '0 0 12px rgba(251, 191, 36, 0.7)' : '0 0 12px rgba(239, 68, 68, 0.7)';
}

function updateSummary() {
  if (state.data.length === 0) return;

  const current = state.data[state.data.length - 1];
  const first = state.data[0];
  const delta = current.c - first.o;
  const high = Math.max(...state.data.map(item => item.h));
  const low = Math.min(...state.data.map(item => item.l));
  const range = high - low;
  const volume = state.data.reduce((sum, item) => sum + item.v, 0);

  const last = Number(current.c);
  ui.miniPrice.textContent = formatNumber(last);
  ui.miniDelta.textContent = `${delta >= 0 ? '+' : ''}${formatNumber(delta, 2)} (${((delta / first.o) * 100).toFixed(2)}%)`;
  ui.miniDelta.style.color = delta >= 0 ? '#21c77d' : '#f15b5b';

  ui.lastPrice.textContent = formatNumber(last, 2);
  ui.priceChange.textContent = `${delta >= 0 ? '+' : ''}${formatNumber(delta, 2)} ${delta >= 0 ? '▲' : '▼'}`;
  ui.priceChange.parentElement.style.borderColor = delta >= 0 ? 'rgba(33, 199, 125, 0.35)' : 'rgba(241, 91, 91, 0.35)';

  ui.statOpen.textContent = formatNumber(first.o, 2);
  ui.statHigh.textContent = formatNumber(high, 2);
  ui.statLow.textContent = formatNumber(low, 2);
  ui.statRange.textContent = formatNumber(range, 2);
  ui.statVolume.textContent = formatCompact(volume);

  const bid = current.c * 0.9996;
  const ask = current.c * 1.0004;
  ui.bidAsk.textContent = `${formatNumber(bid, 2)} / ${formatNumber(ask, 2)}`;
  ui.spreadValue.textContent = formatNumber(ask - bid, 4);
}

function computeProfileMetrics() {
  if (state.data.length < 2) return { poc: 0, vah: 0, val: 0 };

  const priceValues = state.data.flatMap(item => Array(2).fill(item.h));
  const min = Math.min(...state.data.map(item => item.l));
  const max = Math.max(...state.data.map(item => item.h));
  const range = max - min || 1;
  const bins = new Array(70).fill(0);

  state.data.forEach((c) => {
    const start = Math.max(0, Math.floor((max - c.h) / range * bins.length));
    const end = Math.min(bins.length - 1, Math.floor((max - c.l) / range * bins.length));
    const count = end - start + 1 || 1;
    for (let i = start; i <= end; i++) {
      bins[i] += c.v / count;
    }
  });

  let poc = 0;
  let total = 0;
  bins.forEach((v) => { total += v; if (v > bins[poc]) poc = bins.indexOf(v); });

  let lower = poc;
  let upper = poc;
  let acc = bins[poc];

  while (acc < total * 0.7 && (lower > 0 || upper < bins.length - 1)) {
    const up = lower > 0 ? bins[lower - 1] : -1;
    const dn = upper < bins.length - 1 ? bins[upper + 1] : -1;
    if (up >= dn) {
      lower--;
      acc += bins[lower];
    } else {
      upper++;
      acc += bins[upper];
    }
  }

  const pocPrice = max - ((poc + 0.5) / bins.length) * range;
  const vahPrice = max - ((upper + 0.5) / bins.length) * range;
  const valPrice = max - ((lower + 0.5) / bins.length) * range;

  return { poc: pocPrice, vah: vahPrice, val: valPrice };
}

function updateProfileMetrics() {
  const metrics = computeProfileMetrics();
  ui.pocVal.textContent = formatNumber(metrics.poc, 2);
  ui.vahVal.textContent = formatNumber(metrics.vah, 2);
  ui.valVal.textContent = formatNumber(metrics.val, 2);
}

function renderChart() {
  const dpr = window.devicePixelRatio || 1;
  const rect = ui.canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (!width || !height || state.data.length === 0) return;

  ui.canvas.width = width * dpr;
  ui.canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const leftPad = 0;
  const rightPad = 120;
  const plotWidth = width - rightPad;
  const chartAreaWidth = plotWidth;
  const chartHeight = height - 36;
  const top = 20;
  const bottom = height - 20;
  const chartInnerHeight = bottom - top;

  const candles = state.data;
  const low = Math.min(...candles.map(item => item.l));
  const high = Math.max(...candles.map(item => item.h));
  const padding = (high - low) * 0.06 || 0.01;
  const priceMin = low - padding;
  const priceMax = high + padding;
  const candleStep = chartAreaWidth / candles.length;

  const priceToY = (price) => top + ((priceMax - price) / (priceMax - priceMin)) * chartInnerHeight;
  const xForIndex = (i) => leftPad + i * candleStep + candleStep / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1725';
  ctx.fillRect(0, 0, width, height);

  const gridColor = getCssVar('--grid');
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = '#a4b2c9';
  ctx.font = '11px Inter';

  for (let i = 0; i <= 6; i++) {
    const y = top + (chartInnerHeight / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();

    const price = priceMax - ((priceMax - priceMin) / 6) * i;
    ctx.fillText(formatNumber(price, 2), plotWidth + 10, y + 4);
  }

  if (state.showHeatmap) {
    const rows = 26;
    const heatBand = chartInnerHeight / rows;
    for (let r = 0; r < rows; r++) {
      const bandY = top + r * heatBand;
      let strengthSum = 0;
      for (let c = 0; c < candles.length; c++) {
        const price = priceMax - ((r + 0.5) / rows) * (priceMax - priceMin);
        const liquidity = strength(price);
        strengthSum += liquidity;
        const rgb = ramp(liquidity * 0.72);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(0.85, liquidity * 0.75)})`;
        ctx.fillRect(c * candleStep, bandY, candleStep + 1, heatBand + 1);
      }
    }
  }

  if (state.showProfile) {
    const bins = new Array(70).fill(0);
    candles.forEach((c) => {
      const start = Math.max(0, Math.floor((priceMax - c.h) / (priceMax - priceMin) * bins.length));
      const end = Math.min(bins.length - 1, Math.floor((priceMax - c.l) / (priceMax - priceMin) * bins.length));
      const count = end - start + 1 || 1;
      for (let i = start; i <= end; i++) {
        bins[i] += c.v / count;
      }
    });

    const maxBin = Math.max(...bins, 1);
    const profileWidth = Math.min(100, plotWidth * 0.24);
    const profileX = plotWidth - profileWidth;

    bins.forEach((value, index) => {
      const barHeight = (value / maxBin) * chartInnerHeight;
      const y = top + chartInnerHeight - barHeight;
      const x = profileX + ((index / bins.length) * profileWidth);
      ctx.fillStyle = index === 0 ? 'rgba(96,165,250,0.75)' : 'rgba(130,145,175,0.45)';
      ctx.fillRect(x, y, 2, barHeight);
    });
  }

  candles.forEach((c, index) => {
    const x = xForIndex(index);
    const yOpen = priceToY(c.o);
    const yClose = priceToY(c.c);
    const yHigh = priceToY(c.h);
    const yLow = priceToY(c.l);
    const isUp = c.c >= c.o;
    const color = isUp ? '#21c77d' : '#f15b5b';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(2, Math.abs(yOpen - yClose));
    ctx.fillStyle = color;
    ctx.fillRect(x - candleStep * 0.28, bodyTop, candleStep * 0.56, bodyHeight);
  });

  const last = candles[candles.length - 1];
  const currentY = priceToY(last.c);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(0, currentY);
  ctx.lineTo(plotWidth, currentY);
  ctx.stroke();
  ctx.setLineDash([]);

  const priceBarX = plotWidth + 10;
  const priceBarY = currentY - 10;
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(priceBarX, priceBarY, 90, 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 11px Inter';
  ctx.fillText(formatNumber(last.c, 2), priceBarX + 8, priceBarY + 13);

  if (state.mouseX !== null && state.mouseY !== null) {
    const clampedX = Math.max(0, Math.min(plotWidth, state.mouseX));
    const candleIndex = Math.min(candles.length - 1, Math.max(0, Math.floor((clampedX) / candleStep)));
    const candle = candles[candleIndex];
    const crossY = Math.max(top, Math.min(bottom, state.mouseY));

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(clampedX, top);
    ctx.lineTo(clampedX, bottom);
    ctx.moveTo(0, crossY);
    ctx.lineTo(plotWidth, crossY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(17, 24, 39, 0.82)';
    ctx.fillRect(12, 12, 170, 36);
    ctx.fillStyle = '#e5eefb';
    ctx.font = '600 12px Inter';
    ctx.fillText(`${candle.o.toFixed(2)} / ${candle.c.toFixed(2)}`, 20, 28);
    ctx.fillText(`H ${candle.h.toFixed(2)}  L ${candle.l.toFixed(2)}`, 20, 42);

    const liquidity = strength((priceMax - (crossY - top) / chartInnerHeight * (priceMax - priceMin)));
    ui.cursorLiquidity.textContent = `${Math.round(Math.min(1, liquidity) * 100)}%`;
    ui.cursorPrice.textContent = `Price: ${formatNumber(priceMax - ((crossY - top) / chartInnerHeight) * (priceMax - priceMin), 2)} · Volume: ${formatCompact(candle.v)} · Range: ${formatNumber(candle.h - candle.l, 2)}`;
    state.hoverIndex = candleIndex;
  } else {
    ui.cursorLiquidity.textContent = 'Live';
    ui.cursorPrice.textContent = 'Hover over chart to inspect liquidity.';
    state.hoverIndex = null;
  }

  const startTime = candles[0].id;
  const endTime = candles[candles.length - 1].id;
  const labelGap = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += labelGap) {
    const ts = candles[i].id;
    ctx.fillStyle = '#9aa9bd';
    ctx.font = '10px Inter';
    const label = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(label, xForIndex(i) - 18, height - 8);
  }

  const ohlc = candles[candles.length - 1];
  ui.ohlcDisplay.textContent = `O ${formatNumber(ohlc.o, 2)}  H ${formatNumber(ohlc.h, 2)}  L ${formatNumber(ohlc.l, 2)}  C ${formatNumber(ohlc.c, 2)}  Vol ${formatCompact(ohlc.v)}`;

  const rangeStart = new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rangeEnd = new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ui.sessionRange.textContent = `${rangeStart} → ${rangeEnd}`;
  ui.sessionTag.textContent = `${state.tf.toUpperCase()} Session`;

  ui.statusDot.style.background = '#21c77d';
  ui.statusDot.style.boxShadow = '0 0 12px rgba(33,199,125,0.7)';
}

function bindTimeframeButtons() {
  Object.keys(TF).forEach((key) => {
    const btn = document.createElement('button');
    btn.className = `timeframe-btn ${key === state.tf ? 'active' : ''}`;
    btn.textContent = key;
    btn.addEventListener('click', () => {
      state.tf = key;
      Object.values(ui.tfRoot.children).forEach((child) => child.classList.toggle('active', child.textContent === key));
      loadChart();
    });
    ui.tfRoot.appendChild(btn);
  });
}

function bindToggles() {
  const heatmapBtn = document.getElementById('heatmapToggle');
  const profileBtn = document.getElementById('profileToggle');

  heatmapBtn.addEventListener('click', () => {
    state.showHeatmap = !state.showHeatmap;
    heatmapBtn.classList.toggle('active', state.showHeatmap);
    renderChart();
  });

  profileBtn.addEventListener('click', () => {
    state.showProfile = !state.showProfile;
    profileBtn.classList.toggle('active', state.showProfile);
    renderChart();
  });
}

async function loadChart() {
  const gen = ++state.gen;
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
  }

  setStatus('Connecting…', true);

  try {
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${TF[state.tf]}&limit=100`);
    if (!response.ok) throw new Error('Request failed');

    const json = await response.json();
    if (gen !== state.gen) return;

    state.data = json.map((k) => ({
      id: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }));

    updateSummary();
    updateProfileMetrics();
    renderChart();
    connectLiveStream(gen);
  } catch (error) {
    setStatus('Offline mode', false);
    console.error(error);
  }
}

function connectLiveStream(generation) {
  state.ws = new WebSocket(`wss://stream.binance.com:9443/ws/paxgusdt@kline_${TF[state.tf]}`);

  state.ws.onopen = () => {
    setStatus('Live · PAXG/USDT', true);
  };

  state.ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const k = payload.k;
      if (!k || !state.data.length) return;

      const candle = {
        id: Number(k.t),
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
      };

      const last = state.data[state.data.length - 1];
      if (last && last.id === candle.id) {
        state.data[state.data.length - 1] = candle;
      } else {
        state.data.push(candle);
        if (state.data.length > 100) state.data.shift();
      }

      updateSummary();
      updateProfileMetrics();
      renderChart();
    } catch (error) {
      console.error(error);
    }
  };

  state.ws.onclose = () => {
    if (generation === state.gen) {
      setStatus('Reconnecting…', true);
      setTimeout(() => {
        if (generation === state.gen) connectLiveStream(generation);
      }, 2500);
    }
  };
}

ui.canvas.addEventListener('pointermove', (event) => {
  const rect = ui.canvas.getBoundingClientRect();
  state.mouseX = event.clientX - rect.left;
  state.mouseY = event.clientY - rect.top;
  renderChart();
});

ui.canvas.addEventListener('pointerleave', () => {
  state.mouseX = null;
  state.mouseY = null;
  renderChart();
});

window.addEventListener('resize', renderChart);

bindTimeframeButtons();
bindToggles();
loadChart();
