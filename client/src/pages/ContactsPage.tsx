import React, { useState, useEffect } from 'react';
import { fetchContactsApi, createContactApi, deleteContactApi, fetchCompaniesApi } from '../services/api';

export const ContactsPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formCompanyId, setFormCompanyId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async (query?: string) => {
    setLoading(true);
    try {
      const [contactsData, companiesData] = await Promise.all([
        fetchContactsApi(query),
        fetchCompaniesApi(),
      ]);
      setContacts(contactsData);
      setCompanies(companiesData);
    } catch (err: any) {
      showToast(`Failed to load contacts: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      loadData(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) {
      showToast('Name and phone are required.');
      return;
    }

    setSubmitting(true);
    try {
      const selectedCompany = companies.find((c) => c.id === formCompanyId);
      const newContact = await createContactApi({
        name: formName.trim(),
        phoneRaw: formPhone.trim(),
        email: formEmail.trim() || undefined,
        jobTitle: formJobTitle.trim() || undefined,
        companyId: formCompanyId || undefined,
        companyName: selectedCompany ? selectedCompany.name : undefined,
      });

      setContacts((prev) => [newContact, ...prev]);
      setShowModal(false);
      setFormName('');
      setFormPhone('');
      setFormEmail('');
      setFormJobTitle('');
      setFormCompanyId('');
      showToast(`Contact "${newContact.name}" created successfully!`);
    } catch (err: any) {
      showToast(`Failed to create contact: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteContact = async (id: string, name: string) => {
    try {
      await deleteContactApi(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      showToast(`Contact "${name}" deleted.`);
    } catch (err: any) {
      showToast(`Failed to delete contact: ${err.message}`);
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
          <h1>Contacts & Companies</h1>
          <div className="page-header-sub">
            Unified directory of business accounts, decision makers, and opt-in consent records stored in PostgreSQL.
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-soft" onClick={() => loadData(search)} disabled={loading}>
            🔄 {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + New Contact
          </button>
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="toolbar card" style={{ padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search contacts by name, company, email, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-control"
          style={{ minWidth: '280px', flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)' }}
        />
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
          Total <strong>{contacts.length}</strong> contacts
        </div>
      </div>

      {/* Table Card */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Contact Name</th>
                <th>Company</th>
                <th>Job Title</th>
                <th>Phone</th>
                <th>Email</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length > 0 ? (
                contacts.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.companyName || '-'}</td>
                    <td>{c.jobTitle || '-'}</td>
                    <td>{c.phoneRaw}</td>
                    <td>{c.email || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-soft"
                        style={{ padding: '3px 8px', fontSize: '11px', color: '#dc2626' }}
                        onClick={() => handleDeleteContact(c.id, c.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    {loading ? 'Loading contacts...' : 'No contacts found. Click "+ New Contact" to create one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Contact Modal */}
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
          <div className="card" style={{ width: '460px', maxWidth: '90vw', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Create New Contact</h2>
              <button
                className="btn btn-soft"
                onClick={() => setShowModal(false)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateContact} style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="e.g. Ramesh Patel"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Phone Number *
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="e.g. +91 98765 43210"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  className="input-text"
                  placeholder="e.g. ramesh@patelcorp.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Job Title
                  </label>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="e.g. Director"
                    value={formJobTitle}
                    onChange={(e) => setFormJobTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Company
                  </label>
                  <select
                    className="input-select"
                    value={formCompanyId}
                    onChange={(e) => setFormCompanyId(e.target.value)}
                  >
                    <option value="">-- None / Select --</option>
                    {companies.map((comp) => (
                      <option key={comp.id} value={comp.id}>
                        {comp.name}
                      </option>
                    ))}
                  </select>
                </div>
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
                  {submitting ? 'Creating...' : 'Create Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
