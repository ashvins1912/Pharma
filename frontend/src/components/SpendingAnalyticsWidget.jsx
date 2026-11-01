import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { computeSpendingAnalytics } from '../services/analystService';
import { useApp } from '../context/AppContext';

export default function SpendingAnalyticsWidget() {
  const { orders } = useApp();

  const analytics = useMemo(() => {
    return computeSpendingAnalytics(orders);
  }, [orders]);

  const { chartData, totalSpent30Days, totalOrders30Days } = analytics;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-sm space-y-5 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-tight">
              30-Day Spending & Order Analytics
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Track your pharmacy expenditure and prescription refill patterns over the last month.
          </p>
        </div>

        <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 px-4 py-2.5 rounded-2xl">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total Spent</div>
            <div className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400">
              ₹{totalSpent30Days.toLocaleString()}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Orders</div>
            <div className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
              {totalOrders30Days} Refills
            </div>
          </div>
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div className="w-full h-56 sm:h-64 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="spendingGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }}
              interval={4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `₹${val}`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-slate-900 dark:bg-slate-800 text-white text-xs px-3 py-2 rounded-xl shadow-xl border border-slate-700 space-y-1">
                      <div className="font-bold text-slate-300">{label}</div>
                      <div className="text-blue-400 font-black">
                        Spending: ₹{data.spending.toLocaleString()}
                      </div>
                      <div className="text-slate-300">
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
