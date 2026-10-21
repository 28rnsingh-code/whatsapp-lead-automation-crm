import React, { useState } from 'react';
import { NavigationPage } from '../types';

export interface OnboardingPageProps {
  onNavigate: (page: NavigationPage) => void;
}

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onNavigate }) => {
  const [completedSteps, setCompletedSteps] = useState<number[]>([1, 2]);

  const steps = [
    { num: 1, title: 'Workspace & Localization Profile', desc: 'Set your primary business currency (INR), timezone (Asia/Kolkata), and team name.', action: 'Review Settings', target: 'settings' as NavigationPage },
    { num: 2, title: 'Customize Sales Pipeline Stages', desc: 'Tailor default stages (New, Contacted, Qualified, Proposal, Won, Lost) to your sales velocity.', action: 'View Pipeline', target: 'pipeline' as NavigationPage },
    { num: 3, title: 'Connect Approved WhatsApp Business API', desc: 'Plug in your Meta Cloud API Phone Number ID and verify inbound lead webhooks.', action: 'Configure WhatsApp', target: 'integrations' as NavigationPage },
    { num: 4, title: 'Capture or Import Your First 10 Leads', desc: 'Use CSV batch import or add leads manually to start tracking customer follow-ups.', action: 'Open Lead Inbox', target: 'leads' as NavigationPage },
  ];

  const toggleStep = (num: number) => {
    if (completedSteps.includes(num)) {
      setCompletedSteps(completedSteps.filter((s) => s !== num));
    } else {
      setCompletedSteps([...completedSteps, num]);
    }
  };

  const progressPercent = Math.round((completedSteps.length / steps.length) * 100);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Getting Started with OneClick Automics</h1>
          <div className="page-header-sub">
            Follow this 4-step checklist to launch your India-first multi-tenant CRM workspace.
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <strong>Onboarding Readiness</strong>
          <span style={{ fontWeight: 700, color: 'var(--blue)' }}>{progressPercent}% Complete ({completedSteps.length} of 4)</span>
        </div>
        <div style={{ height: '10px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: 'var(--blue)', borderRadius: '99px', transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Steps List */}
      <div style={{ display: 'grid', gap: '14px' }}>
        {steps.map((st) => {
          const isDone = completedSteps.includes(st.num);
          return (
            <div
              key={st.num}
              className="card"
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr auto',
                gap: '16px',
                alignItems: 'center',
                borderColor: isDone ? 'var(--line)' : 'var(--blue-border)',
                background: isDone ? 'var(--surface)' : 'var(--blue-subtle)',
              }}
            >
              <div
                onClick={() => toggleStep(st.num)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: isDone ? 'var(--green)' : 'var(--surface)',
                  color: isDone ? '#ffffff' : 'var(--blue)',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  border: isDone ? 0 : '2px solid var(--blue)',
                }}
                title="Click to toggle complete"
              >
                {isDone ? '✓' : st.num}
              </div>

              <div>
                <strong style={{ display: 'block', fontSize: '14px', marginBottom: '2px', textDecoration: isDone ? 'none' : 'none' }}>
                  {st.title}
                </strong>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  {st.desc}
                </p>
              </div>

              <div>
                <button
                  className={isDone ? 'btn' : 'btn btn-primary'}
                  style={{ fontSize: '12px', padding: '7px 12px' }}
                  onClick={() => onNavigate(st.target)}
                >
                  {st.action} →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
