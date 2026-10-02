'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import styles from '../page.module.css'

interface Member {
  id: string
  userId: string
  email: string
  role: 'owner' | 'member' | 'viewer'
  joinedAt: string
}

interface TeamData {
  orgId: string
  orgName: string
  plan: string
  members: Member[]
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
}

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  owner: { bg: 'rgba(255,215,0,0.1)', border: 'rgba(255,215,0,0.3)', text: '#ffd700' },
  member: { bg: 'rgba(0,212,127,0.1)', border: 'rgba(0,212,127,0.25)', text: 'var(--color-primary)' },
  viewer: { bg: 'rgba(161,161,170,0.1)', border: 'rgba(161,161,170,0.25)', text: 'var(--color-text-muted)' },
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member')
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const loadTeam = useCallback(async () => {
    try {
      const res = await fetch('/api/org/members')
      const json = await res.json()
      if (json.success) setTeam(json.data)
    } catch {
      setMessage({ type: 'error', text: 'Failed to load team' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTeam() }, [loadTeam])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/org/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const json = await res.json()
      if (json.success) {
        setMessage({ type: 'success', text: json.message })
        setInviteEmail('')
        loadTeam()
      } else {
        setMessage({ type: 'error', text: json.error })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm('Remove this team member?')) return
    setRemovingId(memberId)
    try {
      const res = await fetch(`/api/org/members?id=${memberId}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        setMessage({ type: 'success', text: 'Member removed' })
        loadTeam()
      } else {
        setMessage({ type: 'error', text: json.error })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove member' })
    } finally {
      setRemovingId(null)
    }
  }

  const isPaidPlan = team && (team.plan === 'pro' || team.plan === 'enterprise')

  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h1>Team <span className="text-gradient">Management</span></h1>
        <Link href="/dashboard/settings" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
          Settings
        </Link>
      </header>

      {/* Status message */}
      {message && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          fontSize: '0.85rem',
          background: message.type === 'success' ? 'rgba(0,212,127,0.08)' : 'rgba(255,77,77,0.08)',
          border: `1px solid ${message.type === 'success' ? 'rgba(0,212,127,0.25)' : 'rgba(255,77,77,0.25)'}`,
          color: message.type === 'success' ? 'var(--color-primary)' : '#ff4d4d',
        }}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--color-text-muted)', padding: '48px', textAlign: 'center' }}>Loading team...</div>
      ) : !isPaidPlan ? (
        /* Free/Starter plan — upgrade prompt */
        <section className={styles.tableSection} style={{ padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>👥</div>
          <h3 style={{ marginBottom: '8px' }}>Team Members</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '24px', maxWidth: '400px', margin: '0 auto 24px' }}>
            Invite team members to collaborate on document verification and identity checks.
            Available on Pro and Enterprise plans.
          </p>
          <Link href="/pricing" className="btn btn-primary" style={{ fontSize: '0.9rem', padding: '10px 28px' }}>
            Upgrade to Pro
          </Link>
        </section>
      ) : (
        <>
          {/* Organization info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px',
            padding: '16px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px',
            border: '1px solid var(--color-border)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '2px' }}>{team?.orgName}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {team?.members.length} member{team?.members.length !== 1 ? 's' : ''}
              </div>
            </div>
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.7rem',
              borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.1em',
              background: 'rgba(0,255,157,0.15)', color: 'var(--color-primary)',
              border: '1px solid rgba(0,255,157,0.3)',
            }}>
              {team?.plan}
            </span>
          </div>

          {/* Invite form */}
          <section className={styles.tableSection} style={{ padding: '24px', marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '16px', fontSize: '0.9rem' }}>Invite Team Member</h4>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  style={{
                    width: '100%', padding: '10px', background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)', borderRadius: '8px',
                    color: 'white', fontSize: '0.88rem', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: '0 0 140px' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'member' | 'viewer')}
                  style={{
                    width: '100%', padding: '10px', background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)', borderRadius: '8px',
                    color: 'white', fontSize: '0.88rem',
                  }}
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviting}
                style={{ fontSize: '0.85rem', padding: '10px 20px' }}
              >
                {inviting ? 'Inviting...' : 'Send Invite'}
              </button>
            </div>
          </section>

          {/* Members list */}
          <section className={styles.tableSection} style={{ padding: '0' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
              <h4 style={{ margin: 0 }}>Team Members</h4>
            </div>
            {team?.members.map(member => (
              <div key={member.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 24px', borderBottom: '1px solid var(--color-border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: 'rgba(0,212,127,0.12)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-primary)',
                  }}>
                    {member.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{member.email}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 600, padding: '3px 10px',
                    borderRadius: '20px',
                    background: ROLE_COLORS[member.role]?.bg ?? 'rgba(161,161,170,0.1)',
                    border: `1px solid ${ROLE_COLORS[member.role]?.border ?? 'var(--color-border)'}`,
                    color: ROLE_COLORS[member.role]?.text ?? 'var(--color-text-muted)',
                  }}>
                    {ROLE_LABELS[member.role] ?? member.role}
                  </span>
                  {member.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(member.id)}
                      disabled={removingId === member.id}
                      style={{
                        background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)',
                        borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem',
                        color: '#ff4d4d', cursor: 'pointer',
                      }}
                    >
                      {removingId === member.id ? '...' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(!team?.members || team.members.length === 0) && (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                No team members yet.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
