import React, { useState, useEffect } from 'react';
import { StatusPill } from '../components/StatusPill';
import { fetchTasksApi, createTaskApi, updateTaskApi, deleteTaskApi } from '../services/api';

export const FollowupsPage: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formTaskType, setFormTaskType] = useState('Call');
  const [formPriority, setFormPriority] = useState('Medium');
  const [formDueAt, setFormDueAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await fetchTasksApi();
      setTasks(data);
    } catch (err: any) {
      showToast(`Failed to load tasks: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const toggleTask = async (task: any) => {
    const nextCompleted = !task.completed;
    const nextStatus = nextCompleted ? 'Completed' : 'Pending';

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: nextCompleted, status: nextStatus } : t))
    );

    try {
      await updateTaskApi(task.id, { completed: nextCompleted, status: nextStatus });
      showToast(nextCompleted ? `Task "${task.title}" completed!` : `Task marked as pending.`);
    } catch (err: any) {
      showToast(`Failed to update task: ${err.message}`);
      loadTasks(); // rollback
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTaskApi(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showToast('Task removed.');
    } catch (err: any) {
      showToast(`Failed to delete task: ${err.message}`);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      showToast('Please enter a task title.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createTaskApi({
        title: formTitle.trim(),
        leadName: formLeadName.trim() || undefined,
        company: formCompany.trim() || undefined,
        taskType: formTaskType,
        priority: formPriority,
        dueAt: formDueAt ? new Date(formDueAt).toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      });

      setTasks((prev) => [created, ...prev]);
      setShowModal(false);
      setFormTitle('');
      setFormLeadName('');
      setFormCompany('');
      setFormDueAt('');
      showToast('Follow-up task scheduled successfully!');
    } catch (err: any) {
      showToast(`Failed to create task: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#1e293b',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🔔</span> {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Follow-ups & Task Reminders</h1>
          <div className="page-header-sub">
            Track timely reminders, customer touchpoints, and scheduled calls with real PostgreSQL persistence.
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-soft" onClick={loadTasks} disabled={loading}>
            🔄 {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Schedule Follow-up
          </button>
        </div>
      </div>

      {/* Task Categories Grid */}
      <div style={{ display: 'grid', gap: '20px' }}>
        {['Overdue', 'Today', 'Upcoming'].map((cat) => {
          const catTasks = tasks.filter((t) => t.category === cat);
          return (
            <div key={cat} className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2>{cat} Follow-ups</h2>
                  <StatusPill
                    label={`${catTasks.filter((t) => !t.completed).length} pending`}
                    variant={cat === 'Overdue' ? 'red' : cat === 'Today' ? 'amber' : 'blue'}
                  />
                </div>
              </div>

              <div className="table-container" style={{ border: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>Done</th>
                      <th>Task / Lead Contact</th>
                      <th>Task Type</th>
                      <th>Due Scheduled Time</th>
                      <th>Priority</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catTasks.length > 0 ? (
                      catTasks.map((task) => (
                        <tr key={task.id} style={{ opacity: task.completed ? 0.5 : 1 }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={task.completed}
                              onChange={() => toggleTask(task)}
                              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                              aria-label={`Mark task ${task.title} completed`}
                            />
                          </td>
                          <td>
                            <strong>{task.title}</strong>
                            {(task.leadName || task.company) && (
                              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                                {task.leadName} {task.company ? `(${task.company})` : ''}
                              </small>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: '12px' }}>
                              {task.taskType === 'Call' && '📞 '}
                              {task.taskType === 'WhatsApp follow-up' && '💬 '}
                              {task.taskType === 'Meeting' && '👥 '}
                              {task.taskType}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              fontWeight: 600,
                              color: task.category === 'Overdue' ? 'var(--red-text)' : 'inherit',
                            }}>
                              {new Date(task.dueAt).toLocaleDateString()} {new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td>
                            <StatusPill
                              label={task.priority}
                              variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'amber' : 'blue'}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-soft"
                              style={{ padding: '3px 8px', fontSize: '11px', color: '#dc2626' }}
                              onClick={() => handleDelete(task.id)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
                          No {cat.toLowerCase()} follow-ups scheduled.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Schedule Follow-up Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="card" style={{ width: '480px', maxWidth: '90vw', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Schedule Follow-up Task</h2>
              <button
                className="btn btn-soft"
                onClick={() => setShowModal(false)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Task Title *
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="e.g. Discovery call with CEO"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Contact / Lead Name
                  </label>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="e.g. Rajesh Sharma"
                    value={formLeadName}
                    onChange={(e) => setFormLeadName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Company
                  </label>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="e.g. Sharma Traders"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Task Type
                  </label>
                  <select
                    className="input-select"
                    value={formTaskType}
                    onChange={(e) => setFormTaskType(e.target.value)}
                  >
                    <option value="Call">📞 Phone Call</option>
                    <option value="WhatsApp follow-up">💬 WhatsApp Message</option>
                    <option value="Meeting">👥 Demo / Meeting</option>
                    <option value="Send proposal">📄 Send Proposal</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Priority
                  </label>
                  <select
                    className="input-select"
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                  >
                    <option value="High">🔴 High</option>
                    <option value="Medium">🟡 Medium</option>
                    <option value="Low">⚪ Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Due Date & Time
                </label>
                <input
                  type="datetime-local"
                  className="input-text"
                  value={formDueAt}
                  onChange={(e) => setFormDueAt(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : 'Save Follow-up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
