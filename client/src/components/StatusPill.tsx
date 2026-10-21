import React from 'react';

export interface StatusPillProps {
  label: string;
  variant?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  dot?: boolean;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  variant = 'blue',
  dot = true,
}) => {
  return (
    <span className={`pill ${variant}`}>
      {dot && (
        <span
          className="pill-dot"
          style={{
            backgroundColor:
              variant === 'green'
                ? 'var(--green)'
                : variant === 'amber'
                ? 'var(--amber)'
                : variant === 'red'
                ? 'var(--red)'
                : variant === 'purple'
                ? 'var(--violet)'
                : 'var(--blue)',
          }}
        />
      )}
      {label}
    </span>
  );
};
