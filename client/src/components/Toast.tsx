import React from 'react';
import { ToastMessage } from '../types';

export interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" role="alert">
          <span>{toast.type === 'error' ? '⚠️' : toast.type === 'success' ? '✓' : 'ℹ️'}</span>
          <span>{toast.text}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: 'transparent',
              border: 0,
              color: '#ffffff88',
              marginLeft: 'auto',
              cursor: 'pointer',
              padding: '0 4px',
            }}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
