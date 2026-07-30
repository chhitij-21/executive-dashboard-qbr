import React, { useRef, useEffect } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';

ChartJS.register(...registerables);

/**
 * Chart — thin wrapper around Chart.js canvas.
 * Supports bar, line, pie, doughnut types.
 */
export default function Chart({ type = 'bar', data, options = {} }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const defaultOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#0f172a',
            font: { weight: 'bold', size: 12 },
            padding: 12,
          },
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#f1f5f9',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 10,
        },
      },
      scales: type === 'pie' || type === 'doughnut' ? {} : {
        x: {
          ticks: { color: '#0f172a', font: { weight: 'bold' }, maxRotation: 45 },
          grid: { color: '#e2e8f0' },
        },
        y: {
          ticks: { color: '#0f172a', font: { weight: 'bold' } },
          grid: { color: '#e2e8f0' },
        },
      },
    };

    const merged = deepMerge(defaultOptions, options);

    chartRef.current = new ChartJS(canvasRef.current, {
      type,
      data,
      options: merged,
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [type, data, options]);

  return (
    <div className="chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
