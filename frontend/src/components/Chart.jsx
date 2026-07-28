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
        legend: { labels: { color: '#E6EDF3' } },
        tooltip: {
          backgroundColor: '#161B22',
          titleColor: '#E6EDF3',
          bodyColor: '#8B949E',
          borderColor: '#30363D',
          borderWidth: 1,
        },
      },
      scales: type === 'pie' || type === 'doughnut' ? {} : {
        x: {
          ticks: { color: '#8B949E', maxRotation: 45 },
          grid: { color: '#21262D' },
        },
        y: {
          ticks: { color: '#8B949E' },
          grid: { color: '#21262D' },
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
