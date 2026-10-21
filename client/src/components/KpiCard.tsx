import React from 'react';

export interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaType?: 'positive' | 'negative' | 'neutral';
  icon: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  delta,
  deltaType = 'positive',
  icon,
}) => {
  return (
    <div className="card kpi-card">
      <div className="kpi-icon-wrap" aria-hidden="true">
        {icon}
      </div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        {delta && (
          <div className={`kpi-delta ${deltaType}`}>
            {deltaType === 'positive' ? '↑ ' : deltaType === 'negative' ? '↓ ' : '• '}
            {delta}
          </div>
        )}
      </div>
    </div>
  );
};
