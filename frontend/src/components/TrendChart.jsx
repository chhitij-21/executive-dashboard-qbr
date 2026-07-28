import React, { useRef, useEffect } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';

ChartJS.register(...registerables);

/**
 * TrendChart — line chart for monthly/quarterly trend data.
 * @param {Array<{label: string, value: number}>} data
 * @param {string} yLabel — label for y-axis
 * @param {string} datasetLabel
 * @param {string} color — CSS color string
 */
export default function TrendChart({ data, yLabel = '', datasetLabel = 'Value', color = 'hsl(212,92%,52%)' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data?.length) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const TEXT = '#8B949E';
    const GRID = '#21262D';

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'line',
      data: {
        labels: data.map((d) => d.label || d.month || d.quarter || ''),
        datasets: [{
          label: datasetLabel,
          data: data.map((d) => parseFloat(d.value ?? d.slaPercent ?? d.count ?? 0)),
          borderColor: color,
          backgroundColor: color.replace(')', ', 0.12)').replace('hsl', 'hsla'),
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: color,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: TEXT } },
          tooltip: {
            backgroundColor: '#161B22',
            titleColor: '#E6EDF3',
            bodyColor: TEXT,
            borderColor: GRID,
            borderWidth: 1,
          },
        },
        scales: {
          x: { ticks: { color: TEXT }, grid: { color: GRID } },
          y: {
            ticks: { color: TEXT, callback: (v) => yLabel.includes('%') ? `${v}%` : v },
            grid: { color: GRID },
            title: { display: !!yLabel, text: yLabel, color: TEXT },
          },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, datasetLabel, color, yLabel]);

  if (!data?.length) {
    return <div className="empty-state" style={{ padding: '2rem' }}><p>No trend data available.</p></div>;
  }

  return (
    <div className="chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}
