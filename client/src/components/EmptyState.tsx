import React from 'react';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '📂',
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="card empty-state" role="status">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto' }}>
        {description}
      </p>
      {actionLabel && onAction && (
        <button className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};
