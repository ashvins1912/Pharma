import React, { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useDashboardAnalytics } from '../context/DashboardAnalyticsContext';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export default function SpendingAnalyticsWidget() {
  const { t } = useLanguage();
  const analytics = useDashboardAnalytics();
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState('30d'); // '7d' | '14d' | '30d'

  if (!user) return null; // Show on sign-in only

  const { chartData } = analytics;

  // Filter chart data based on selected time range navigation filter
  const daysCount = timeRange === '7d' ? 7 : timeRange === '14d' ? 14 : 30;
  const filteredChartData = chartData.slice(-daysCount);

  const filteredSpent = filteredChartData.reduce((sum, d) => sum + (d.spending || 0), 0);
  const filteredOrders = filteredChartData.reduce((sum, d) => sum + (d.ordersCount || 0), 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">📊</span>
            <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
              {t('spendingAnalyticsTitle')}
            </h3>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {t('spendingAnalyticsDesc')}
          </p>
        </div>

        {/* Navigation Filters / Range Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-2xl border border-slate-200">
          {[
            { id: '7d', days: 7 },
            { id: '14d', days: 14 },
            { id: '30d', days: 30 }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTimeRange(tab.id)}
              className={`min-h-11 px-3.5 py-2 text-xs font-black rounded-xl transition cursor-pointer ${
                timeRange === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              {tab.days} {t('days')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl w-fit">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Expenditure ({timeRange})</div>
          <div className="text-sm sm:text-base font-black text-blue-700 font-mono tabular-nums">
            ₹{filteredSpent.toLocaleString()}
          </div>
        </div>
        <div className="h-8 w-px bg-slate-200" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Refills ({timeRange})</div>
          <div className="text-sm sm:text-base font-black text-slate-900 font-mono tabular-nums">
            {filteredOrders} Orders
          </div>
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div className="w-full h-56 sm:h-64 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="spendingGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 10, fill: '#475569' }}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              interval={timeRange === '7d' ? 0 : 4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#475569' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `₹${val}`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white text-slate-900 text-xs px-3 py-2 rounded-xl shadow-sm border border-slate-200 space-y-1">
                      <div className="font-bold text-slate-700">{label}</div>
                      <div className="text-blue-700 font-black">
                        Spending: ₹{data.spending.toLocaleString()}
                      </div>
                      <div className="text-slate-600">
                        Orders placed: {data.ordersCount}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="spending"
              stroke="#2563eb"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#spendingGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
