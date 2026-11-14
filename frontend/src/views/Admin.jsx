import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import QrCanvas from '../components/QrCanvas.jsx'
import AdminCoach from './AdminCoach.jsx'
import '../admin.css'

const PLAN_TIERS = [
  { days: 7, label: '+1 Week', short: '1W (7d)' },
  { days: 30, label: '+1 Month', short: '1M (30d)' },
  { days: 90, label: '+3 Months', short: '3M (90d)' },
  { days: 365, label: '+1 Year', short: '1Y (365d)' },
]
function membershipStatus(u, now = Date.now()) {
  if (u.admin) return { kind: 'admin', label: u.owner ? 'owner' : 'admin', cls: 'acc' }
  if (typeof u.membershipUntil !== 'number') return { kind: 'unlimited', label: 'no expiry', cls: '' }
  const diff = u.membershipUntil - now
  const days = Math.ceil(diff / 86400000)
  if (diff <= 0) {
    const ago = Math.max(1, Math.floor(-diff / 86400000))
    return { kind: 'expired', label: `expired ${ago}d ago`, cls: 'bad', days }
  }
  if (days <= 3) return { kind: 'expiring', label: `${days}d left`, cls: 'warn', days }
  return { kind: 'active', label: `${days}d left`, cls: 'ok', days }
}
/** Swap localhost for the laptop's Wi-Fi LAN IP in dev so scanned QR codes open on a phone. */
function defaultQrBase() {
  if (typeof window === 'undefined') return ''
  const { protocol, hostname, port, origin, pathname } = window.location
  const lan = typeof __DEV_LAN_HOST__ !== 'undefined' ? __DEV_LAN_HOST__ : ''
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const baseOrigin = isLocal && lan ? `${protocol}//${lan}${port ? ':' + port : ''}` : origin
  return baseOrigin + pathname
}

function InviteQrSheet({ invite, close }) {
  const toast = useUI(s => s.toast)
  const [memberName, setMemberName] = useState(invite.note || '')
  const cleanName = memberName.trim()
  const url = defaultQrBase()
    + '?invite=' + encodeURIComponent(invite.code)
    + (cleanName ? '&name=' + encodeURIComponent(cleanName) : '')
  const copyUrl = () => { navigator.clipboard?.writeText(url).catch(() => {}); toast('Sign-up link copied') }
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 4 }}>Member Sign-Up QR</h3>
    <div className="adm-lead" style={{ marginBottom: 14 }}>
      {cleanName ? <>For <b>{cleanName}</b> · </> : ''}
      {invite.days ? `${invite.days}-day pass` : 'Unlimited membership'}
    </div>
    <div style={{ display: 'inline-block', padding: 14, background: '#fff', borderRadius: 16, marginBottom: 12 }}>
      <QrCanvas value={url} size={200} />
    </div>
    <div style={{ marginBottom: 12 }}>
      <span className="adm-code">{invite.code}</span>
      {url && <div className="dim small" style={{ marginTop: 6, wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{url}</div>}
    </div>
    <input className="input" placeholder="Member name (pre-fills on their phone)" maxLength={40}
      value={memberName} onChange={e => setMemberName(e.target.value)}
      style={{ marginBottom: 12, textAlign: 'center', background: 'var(--surface-2)' }} />
    <div className="adm-hint" style={{ marginBottom: 14 }}>Member points their phone camera at this QR code to open sign-up with their name and pass code pre-filled.</div>
    <Button variant="primary" icon="copy" onClick={copyUrl}>Copy sign-up link</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Done</Button>
  </div>
}

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.
//
// One page of cards, each opening with a sentence that says what it is for. An operator who
// looks at this twice a year should not have to remember what "synced 3d ago" or an invite
// code means.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min' }

// The one time the reset code is visible. Locked, so a tap beside the sheet cannot lose it
// before it has been copied or written down.
function ResetCodeSheet({ name, email, code, expires, close }) {
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied') }
  return <>
    <h3>Reset code for {name}</h3>
    <div className="adm-lead">Give them this code. They choose “Sign in with password” → “Have a reset code from your admin?”, enter their name <b>{name}</b>{email && <> (or their sign-in e-mail <b>{email}</b>)</>}, the code and a new password. It works once, until {new Date(expires).toLocaleString()}, and will not be shown again.</div>
    <button className="adm-code" style={{ fontSize: 'var(--fs-title2)', width: '100%', padding: '14px 0' }} onClick={copy} aria-label="copy code">{code}</button>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>Done</Button>
  </>
}

// The one time a recovery code (#584) is visible. Locked like the reset code's sheet.
function RecoveryCodeSheet({ name, code, expires, close }) {
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied') }
  return <>
    <h3>Recovery code for {name}</h3>
    <div className="adm-lead">Give them this code. On the sign-in screen they tap “Lost access?” → “I have a code” (or “Use a code from your other device”) and enter it; the device they use gets a new passkey for <b>{name}</b> and is signed in. In the phone app they do this in a browser first, then pair the app again. It works once, until {new Date(expires).toLocaleString()}, and will not be shown again.</div>
    <button className="adm-code" style={{ fontSize: 'var(--fs-title2)', width: '100%', padding: '14px 0' }} onClick={copy} aria-label="copy code">{code}</button>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>Done</Button>
  </>
}

function UserDetail({ id, viewerOwner, onChanged, close }) {
  const me = useStore(s => s.user)
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  // The document comes straight off the user's state file. PUT /api/data drops null and
  // shapeless entries now, but a file written before it did still answers with them, and this
  // sheet renders outside the route's ErrorBoundary: one throw here blanked the whole app and
  // left exactly this account un-disableable. setsDone/workoutVolume walk entries and sets, so
  // an entry that lacks either has nothing to show and is skipped rather than drawn.
  const workouts = (d.workouts || []).filter(w => w && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  // Their whole record as the admin API already returns it — the export the delete sheet offers.
  const exportUser = () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `opengym-${u.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}-${u.id}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const doDelete = () => {
    api('/api/admin/user/delete', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast('Account deleted'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const ms = membershipStatus(u)
  const renew = (days, clear = false) => {
    api('/api/admin/user/renew', { method: 'POST', body: JSON.stringify(clear ? { id: u.id, clear: true } : { id: u.id, days }) })
      .then(r => {
        setD(prev => ({ ...prev, user: { ...prev.user, membershipUntil: r.membershipUntil, membershipExpired: r.membershipExpired, renewals: r.renewals } }))
        toast(clear ? 'Membership limit cleared' : `Membership extended +${days}d`)
        onChanged()
      })
      .catch(e => toast(e.message))
  }
  // One owner, any number of admins: only the owner appoints, removes or hands the role on.
  const setRole = admin => api('/api/admin/user/role', { method: 'POST', body: JSON.stringify({ id: u.id, admin }) })
    .then(() => { toast(admin ? u.name + ' is an admin now' : u.name + ' is no longer an admin'); onChanged(); close() })
    .catch(e => toast(e.message))
  const makeOwner = () => confirmSheet({
    title: 'Make ' + u.name + ' the owner?',
    message: 'They get everything you can do here, including removing admins and clearing the activity log. You stay an admin, but only they can change that.',
    confirmText: 'Hand it over', danger: true,
    onConfirm: () => api('/api/admin/owner', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast(u.name + ' owns this instance now'); onChanged(); close() })
      .catch(e => toast(e.message)),
  })
  // Password sign-in (#118): the server only sends `password` when the instance offers it. The
  // code comes back once, is shown once, and is never stored anywhere but as a hash.
  const pwInstance = typeof u.password === 'boolean'
  const resetPassword = () => confirmSheet({
    title: 'Reset ' + u.name + '’s password?',
    message: 'You get a one-time code to hand them. Their current password stops working now and they are signed out everywhere; their passkeys keep working. They set a new password with the code under “Sign in with password”. It is shown once and is valid for 24 hours.',
    confirmText: 'Create reset code',
    danger: true,
    onConfirm: () => api('/api/admin/user/password-reset', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(r => { onChanged(); close(); openSheet(done => <ResetCodeSheet name={r.name} email={u.email} code={r.code} expires={r.expires} close={done} />, { locked: true }) })
      .catch(e => toast(e.message)),
  })
  // A recovery code (#584): any admin for a profile that is not an admin, the owner for an admin;
  // the owner's own comes from the server command (recover.js). Not for oneself.
  const canRecover = !u.owner && !u.disabled && u.id !== me?.id && (!u.admin || viewerOwner)
  const makeRecovery = () => confirmSheet({
    title: 'Recovery code for ' + u.name + '?',
    message: 'For someone who lost every way in: their devices and passkey are gone, and they have no password. You get a one-time code to hand them; the device they enter it on gets a new passkey. They are signed out everywhere now. Their passkeys and password stay. It is shown once and is valid for 24 hours.',
    confirmText: 'Create recovery code',
    danger: true,
    onConfirm: () => api('/api/admin/user/recovery', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(r => { onChanged(); close(); openSheet(done => <RecoveryCodeSheet name={r.name} code={r.code} expires={r.expires} close={done} />, { locked: true }) })
      .catch(e => toast(e.message)),
  })
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.owner ? <span className="adm-pill acc">owner</span> : u.admin && <span className="adm-pill acc">admin</span>}
      {!u.admin && typeof u.membershipUntil === 'number' && <span className={'adm-pill ' + ms.cls}>{ms.label}</span>}
      {u.disabled && <span className="adm-pill bad">disabled</span>}
      {u.invitedBy && <span className="adm-pill">invite {u.invitedBy}</span>}
      {u.password && <span className="adm-pill">password</span>}
      {/* The sign-in e-mail (password instances only): shown to admins and nobody else. */}
      {u.email && <span className="adm-pill" title="sign-in e-mail">{u.email}</span>}
      {u.phone && <span className="adm-pill" title="phone">{u.phone}</span>}
      {u.resetUntil && <span className="adm-pill acc">reset code until {new Date(u.resetUntil).toLocaleString()}</span>}
      {u.recoveryUntil && <span className="adm-pill acc">recovery code until {new Date(u.recoveryUntil).toLocaleString()}</span>}
      <span className="adm-pill">joined {u.created ? fmtDate(u.created.slice(0, 10)) : '–'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v v-sm">{workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v v-sm">{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Measurements</div><div className="v v-sm">{(d.measurements || []).length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v v-sm">{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: 'var(--fs-subhead)' }}>{rel(d.lastSync)}</div></div>
    </div>
    {viewerOwner && !u.owner && !u.disabled && <>
      <button className="btn" style={{ margin: '12px 0 4px' }}
        onClick={() => u.admin
          ? confirmSheet({ title: 'Remove ' + u.name + ' as admin?', message: 'They keep their account and data, but lose this page.', confirmText: 'Remove admin', danger: true, onConfirm: () => setRole(false) })
          : confirmSheet({ title: 'Make ' + u.name + ' an admin?', message: 'They can see everyone on this instance, disable accounts, hand out invites and set up the Coach. Only you can add or remove admins.', confirmText: 'Make admin', onConfirm: () => setRole(true) })}>
        {u.admin ? 'Remove admin' : 'Make admin'}</button>
      <div className="adm-hint">{u.admin ? 'Admins run the instance with you. Remove the role to delete or disable their account.' : 'Admins help run the instance. You stay the owner.'}</div>
      {u.admin && <>
        <button className="btn" style={{ margin: '14px 0 4px' }} onClick={makeOwner}>Make owner</button>
        <div className="adm-hint">There is one owner. Handing it over makes you a regular admin.</div>
      </>}
    </>}
    {!u.admin && <>
      <h4 className="sec">Membership & Renewal</h4>
      <div className="adm-lead" style={{ marginBottom: 8 }}>
        {typeof u.membershipUntil === 'number'
          ? (ms.kind === 'expired'
            ? `Expired on ${fmtDate(new Date(u.membershipUntil).toISOString().slice(0, 10))} (Read-only mode).`
            : `Active until ${fmtDate(new Date(u.membershipUntil).toISOString().slice(0, 10))} (${ms.label}).`)
          : 'No expiration date set (unlimited access).'}
      </div>
      <div className="adm-actions">
        {PLAN_TIERS.map(p => (
          <button key={p.days} className="btn" style={{ width: 'auto', flex: '1 1 auto' }} onClick={() => renew(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      {typeof u.membershipUntil === 'number' && <>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => renew(0, true)}>Clear expiry</button>
      </>}
      {Array.isArray(u.renewals) && u.renewals.length > 0 && (
        <details className="adm-fold" style={{ marginTop: 10 }}>
          <summary>Renewal history ({u.renewals.length})<Icon name="chevronRight" className="chev" /></summary>
          <div className="adm-fold-b">
            <div className="adm-log">
              {u.renewals.map((r, idx) => (
                <div key={idx} className="adm-log-row">
                  <span>{r.days ? `+${r.days}d` : r.until ? `until ${fmtDate(new Date(r.until).toISOString().slice(0, 10))}` : 'unlimited'}{r.by ? ` · by ${r.by}` : ''}</span>
                  <span className="when">{fmtDate(new Date(r.ts).toISOString().slice(0, 10))}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}
      <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
        onClick={() => u.disabled ? setDisabled(false)
          : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled. Their data stays.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
        {u.disabled ? 'Enable account' : 'Disable account'}</button>
      <div className="adm-hint">{u.disabled ? 'Enabling lets them sign in and sync again.' : 'Disabling signs them out everywhere and blocks sign-in. Nothing is deleted.'}</div>
      {/* The one destructive action in the app (issue #107), so it asks twice and offers the
          export first — that history is theirs. The second step names the account again, because
          the first sheet can be dismissed by anyone who was not reading. */}
      <button className="btn danger" style={{ margin: '14px 0 4px' }}
        onClick={() => confirmSheet({
          title: 'Delete ' + u.name + '?',
          message: 'Everything goes: their workouts, weigh-ins, routines, passkeys and notifications. This cannot be undone, and the invite code they joined with stays used. Download their data first if they might want it.',
          confirmText: 'Continue',
          danger: true,
          onConfirm: () => confirmSheet({
            title: 'Delete ' + u.name + ' for good?',
            message: 'Last chance. There’s no undo and no backup of this on the server.',
            confirmText: 'Delete account',
            danger: true,
            onConfirm: doDelete,
          }),
        })}>Delete account</button>
      <button className="btn" style={{ marginBottom: 4 }} onClick={exportUser}>Download their data</button>
      <div className="adm-hint">Deleting removes the account and every trace of its training history from this server.</div>
      {pwInstance && <>
        <button className="btn" style={{ margin: '14px 0 4px' }} onClick={resetPassword}>Reset password</button>
        <div className="adm-hint">{u.password
          ? 'For a forgotten password: a one-time code lets them choose a new one. Their current password stops working at once.'
          : 'No password yet. A one-time code lets them set one. That’s the way back in after losing their only passkey.'}</div>
      </>}
    </>}
    {canRecover && <>
      <button className="btn" style={{ margin: '14px 0 4px' }} onClick={makeRecovery}>Recovery code</button>
      <div className="adm-hint">Lost every device and passkey? A one-time code gives a new device a passkey for this profile. Works with or without password sign-in.</div>
    </>}
    {u.owner && u.id !== me?.id && <div className="adm-hint" style={{ marginTop: 14 }}>A locked-out owner gets a recovery code from the server itself: <code>docker compose exec api node recover.js "{u.name}"</code></div>}
    <h4 className="sec">Workout history</h4>
    {workouts.length ? <div className="list" style={{ gap: 0 }}>
      {workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="adm-empty">No workouts logged.</div>}
  </>
}

function InvitesCard({ invites, reload, inviteOnly }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [planDays, setPlanDays] = useState(30)
  const [note, setNote] = useState('')
  const gen = () => {
    const payload = { ...(planDays ? { days: planDays } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
    api('/api/admin/invites/new', { method: 'POST', body: JSON.stringify(payload) })
      .then(({ invite }) => {
        setNote('')
        navigator.clipboard?.writeText(invite.code).catch(() => {})
        toast('Pass ' + invite.code + ' created & copied')
        reload()
        openSheet(done => <InviteQrSheet invite={invite} close={done} />)
      })
      .catch(e => toast(e.message))
  }
  const revoke = code => confirmSheet({
    title: 'Revoke code ' + code + '?', message: 'Anyone who has it can no longer use it. People who already signed up with it are not affected.',
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  })
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied ' + code) }
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <h2 style={{ margin: '0 0 2px' }}>Invite codes & QR Passes</h2>
    <div className="adm-lead">
      {inviteOnly
        ? 'Sign-up is invite-only: generate a named pass below and let the member scan its QR code to register.'
        : 'Sign-up is open, so passes are optional here. They pre-fill the member’s name and membership duration.'}
    </div>
    <form onSubmit={e => { e.preventDefault(); gen() }} style={{ marginBottom: 16 }}>
      <div className="adm-group-t">1. Member Name (pre-fills on their phone)</div>
      <input className="input" placeholder="Member name (e.g. Juan Dela Cruz)" maxLength={60} value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="adm-group-t">2. Plan duration</div>
      <div className="adm-chips" style={{ marginBottom: 14 }}>
        {PLAN_TIERS.map(p => (
          <button key={p.days} type="button" className={'chip' + (planDays === p.days ? ' on' : '')} onClick={() => setPlanDays(p.days)}>{p.short}</button>
        ))}
        <button type="button" className={'chip' + (planDays === null ? ' on' : '')} onClick={() => setPlanDays(null)}>No expiry</button>
      </div>
      <Button type="submit" variant="primary" icon="qr">Generate Pass & Show QR</Button>
    </form>
    {open.length ? <>
      <div className="adm-group-t">Unused passes · tap QR to scan or click code to copy</div>
      {open.map(i => <div key={i.code} className="row between" style={{ padding: '8px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0, alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{i.note || 'Unnamed pass'}</span>
          {i.days ? <span className="adm-pill acc">{i.days}d</span> : <span className="adm-pill">Unlimited</span>}
          <button type="button" className="adm-code" onClick={() => copy(i.code)} aria-label={'copy ' + i.code}>{i.code}</button>
        </div>
        <div className="row" style={{ gap: 4, flex: 'none' }}>
          <button type="button" className="iconbtn adm-iconbtn" onClick={() => openSheet(done => <InviteQrSheet invite={i} close={done} />)} aria-label="show QR"><Icon name="qr" /></button>
          <button type="button" className="iconbtn adm-iconbtn" onClick={() => copy(i.code)} aria-label="copy"><Icon name="copy" /></button>
          <button type="button" className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
        </div>
      </div>)}
    </> : null}
    {used.length ? <>
      <div className="adm-group-t" style={{ marginTop: open.length ? 14 : 0 }}>Already used</div>
      {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '6px 0', fontSize: 'var(--fs-footnote)' }}>
        <span>
          <b style={{ color: 'var(--label-2)' }}>{i.usedByName || i.note || 'Member'}</b>
          {' · '}
          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}>{i.code}{i.days ? ` (${i.days}d)` : ''}</span>
        </span>
        <span>{i.note && i.usedByName && i.note !== i.usedByName ? `for ${i.note}` : 'redeemed'}</span>
      </div>)}
    </> : null}
    {!open.length && !used.length && <div className="adm-empty">No passes yet. Enter a member's name above and tap "Generate Pass & Show QR".</div>}
  </div>
}

// Who signed in, who tried and failed, what an admin changed. A card rather than its own route:
// the dashboard is deliberately one page of cards, and the 95 % use of this is a glance at the
// last twenty events. Paging follows Library.jsx's house style — "Show more", not page numbers.
function AuditCard({ tick, owner }) {
  const toast = useUI(s => s.toast)
  const [meta, setMeta] = useState(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')

  const load = (c, before) => api('/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then(r => { setMeta(r); setRows(x => (before ? x.concat(r.events) : r.events)) })
    .catch(e => toast(e.message))
  const pick = c => { setCat(c); setRows([]); setMeta(null); load(c) }
  // Reloads on mount and whenever the header's ↻ bumps the tick. Deliberately not on the 15s
  // poll that drives "training now": this is history, not presence.
  useEffect(() => { load(cat) }, [tick])

  const clear = () => confirmSheet({
    title: 'Clear the activity log?',
    message: 'Every recorded event is deleted. The clear itself is logged, so the gap stays visible.',
    confirmText: 'Clear', danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast('Activity log cleared'); pick(cat) }).catch(e => toast(e.message))
  })

  if (meta && !meta.enabled) return null      // AUDIT_LOG=0 — the card isn't there at all

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Activity log</h2>
      {/* Clearing is the owner's alone: an admin could otherwise erase what they did. */}
      {owner && <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={clear} aria-label="clear log"><Icon name="trash" /></button>}</div>
    <div className="adm-lead">
      Who signed in, what failed, and what an admin changed.
      {meta ? ' ' + fmtNum(meta.total) + ' events'
        + (meta.retention.days ? ', kept for ' + meta.retention.days + ' days' : '')
        + (meta.ip_mode === 'off' ? ', without IP addresses' : '') + '.' : ''}
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{l}</button>)}
    </div>
    {rows.map(e => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="adm-pill bad" style={{ marginInlineStart: 6 }}>failed</span>}
            {auditCat(e.ev) === 'admin' && <span className="adm-pill acc" style={{ marginInlineStart: 6 }}>admin</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginInlineStart: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="adm-empty">Nothing logged yet.</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>Show more</Button></div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  // Opened from Settings → AI Coach (the hosted app's way to the Coach, which is the server's):
  // straight to the Coach card rather than the top of the page.
  const toCoach = useLocation().state?.section === 'coach'
  const [tab, setTab] = useState(toCoach ? 'coach' : 'overview')
  useEffect(() => { if (toCoach) setTab('coach') }, [toCoach])
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [usersErr, setUsersErr] = useState(null)   // why the last load failed, until one succeeds
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  // A failed load, or an answer without a list, used to leave the page on "Loading…" for good —
  // with a toast every 15 seconds from the poll, or with nothing at all when the answer was
  // someone else's page. It says so where the list would be instead, and the poll (or ↻) keeps
  // trying; a list that did load stays up, marked as the last one that came through.
  const loadUsers = () => api('/api/admin/users')
    .then(d => {
      if (!Array.isArray(d?.users)) throw new Error('The server answered without a list of users.')
      setUsers(d.users); setInviteOnly(!!d.invite_only); setUsersErr(null)
    })
    .catch(e => setUsersErr(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  // From the list rather than the stored session, which may predate a handover.
  const viewerOwner = !!(users || []).find(u => u.id === user.id)?.owner
  const openUser = id => openSheet(close => <UserDetail id={id} viewerOwner={viewerOwner} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const expiringCount = (users || []).filter(u => membershipStatus(u).kind === 'expiring').length
  const expiredCount = (users || []).filter(u => membershipStatus(u).kind === 'expired').length
  const unusedInvitesCount = (invites || []).filter(i => !i.usedBy && !i.revoked).length
  const q = query.trim().toLowerCase()
  const filteredUsers = (users || []).filter(u => {
    const ms = membershipStatus(u)
    if (filter === 'active' && ms.kind !== 'active' && ms.kind !== 'expiring') return false
    if (filter === 'expiring' && ms.kind !== 'expiring') return false
    if (filter === 'expired' && ms.kind !== 'expired') return false
    if (!q) return true
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').toLowerCase().includes(q)
  })

  const refreshAll = () => { loadUsers(); loadInvites(); setTick(n => n + 1) }
  const signOut = () => { useStore.getState().signOut?.({ force: true }) }
  const jumpToMembers = nextFilter => { setFilter(nextFilter); setTab('members') }

  const TABS = [
    { id: 'overview', label: 'Overview', short: 'Overview', icon: 'chart', badge: liveUsers.length ? liveUsers.length + ' live' : null, badgeCls: 'ok' },
    { id: 'members', label: 'Members', short: 'Members', icon: 'personCircle', badge: users ? String(users.length) : null, badgeCls: expiredCount ? 'bad' : expiringCount ? 'warn' : '' },
    { id: 'invites', label: 'Invites & QR', short: 'Invites', icon: 'qr', badge: unusedInvitesCount ? String(unusedInvitesCount) : null, badgeCls: 'acc' },
    { id: 'coach', label: 'AI Coach', short: 'Coach', icon: 'sparkles', badge: null, badgeCls: '' },
    { id: 'audit', label: 'Activity Log', short: 'Log', icon: 'clock', badge: null, badgeCls: '' },
  ]
  const activeTabObj = TABS.find(x => x.id === tab) || TABS[0]

  return <div className="adm-shell">
    <aside className="adm-sidebar">
      <div>
        <div className="adm-brand">
          <div className="adm-brand-ic"><Icon name="dumbbell" /></div>
          <div className="grow">
            <div className="adm-brand-t">openGym Admin</div>
            <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : usersErr ? 'Could not load' : 'Loading…'}</div>
          </div>
        </div>

        <div className="adm-nav-sect">Workspace</div>
        <nav className="adm-sidenav" aria-label="Admin sections">
          {TABS.map(item => (
            <button key={item.id} type="button" className={'adm-navbtn' + (tab === item.id ? ' on' : '')} onClick={() => setTab(item.id)}>
              <Icon name={item.icon} />
              <span className="grow">{item.label}</span>
              {item.badge && <span className={'adm-pill ' + item.badgeCls}>{item.badge}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="adm-sidefoot">
        <div className="adm-acct">
          <div className="adm-acct-user">
            <div className="adm-user-avatar" aria-hidden="true">{(user.name || '?')[0].toUpperCase()}</div>
            <div className="adm-acct-name">{user.name}</div>
          </div>
          <span className="adm-pill acc">{viewerOwner || user.owner ? 'owner' : 'admin'}</span>
        </div>
        <div className="adm-side-actions">
          <button type="button" className="btn ghost sm" data-back="/home" onClick={() => nav('/home')}>
            <Icon name="house" /><span>Member App</span>
          </button>
          <button type="button" className="btn ghost sm" onClick={signOut}>
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </aside>

    <main className="adm-main">
      <div className="adm-topbar">
        <div className="grow">
          <h1 style={{ margin: 0 }}>{activeTabObj.label}</h1>
          <div className="adm-intro" style={{ margin: '2px 0 0' }}>
            {tab === 'overview' && 'Gym pulse, active floor sessions, and quick front-desk actions.'}
            {tab === 'members' && 'Manage gym members, check subscription status, and record renewals.'}
            {tab === 'invites' && 'Generate plan-linked invite codes and scannable QR codes for new members.'}
            {tab === 'coach' && 'Configure the instance AI Coach provider, models, and daily usage caps.'}
            {tab === 'audit' && 'Chronological security and membership renewal log for this gym instance.'}
          </div>
        </div>
        <div className="row adm-topbar-acts" style={{ gap: 8 }}>
          <button type="button" className="btn primary sm adm-desk-only" onClick={() => setTab('invites')}>
            <Icon name="qr" /><span>+ Invite / QR</span>
          </button>
          <button type="button" className="iconbtn adm-mob-only" data-back="/home" onClick={() => nav('/home')} aria-label="Back" title="Member App"><Icon name="house" /></button>
          <button type="button" className="iconbtn" onClick={refreshAll} aria-label="refresh" title="Refresh">↻</button>
          <button type="button" className="btn ghost sm adm-mob-only" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="adm-body">
        {usersErr && <div className="card" role="alert" style={{ borderColor: 'var(--red)', marginBottom: 16 }}>
          <div className="row between"><h2 style={{ margin: 0 }}>{users ? 'The last update failed' : 'Could not load the users'}</h2>
            <Button size="sm" icon="reset" onClick={loadUsers}>Try again</Button></div>
          <div className="adm-lead" style={{ marginBottom: 0 }}>
            {usersErr} {users ? 'The list below is the last one that loaded.' : 'It tries again every 15 seconds.'}
          </div>
        </div>}

        <div className="adm-kpis">
          <button type="button" className="tile adm-kpi-btn" onClick={() => jumpToMembers('all')}>
            <div className="l">Users</div>
            <div className="v">{users ? users.length : '–'}</div>
            <div className="adm-kpi-foot">All profiles →</div>
          </button>
          <button type="button" className="tile adm-kpi-btn" onClick={() => jumpToMembers('expiring')}>
            <div className="l">Expiring ≤ 3d</div>
            <div className="v" style={{ color: expiringCount ? 'var(--yellow)' : undefined }}>{users ? expiringCount : '–'}</div>
            <div className="adm-kpi-foot">Within 3 days →</div>
          </button>
          <button type="button" className="tile adm-kpi-btn" onClick={() => jumpToMembers('expired')}>
            <div className="l">Expired</div>
            <div className="v" style={{ color: expiredCount ? 'var(--red)' : undefined }}>{users ? expiredCount : '–'}</div>
            <div className="adm-kpi-foot">Needs renewal →</div>
          </button>
          <button type="button" className="tile adm-kpi-btn" onClick={() => setTab('overview')}>
            <div className="l">Training now</div>
            <div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '–'}</div>
            <div className="adm-kpi-foot">Active floor</div>
          </button>
        </div>

        {/* Overview panel */}
        <div className={'adm-panel' + (tab === 'overview' ? '' : ' off')}>
          <div className="adm-grid-2">
            <div className="card" style={{ margin: 0 }}>
              <h2 style={{ margin: '0 0 2px' }}>Front Desk Quick Actions</h2>
              <div className="adm-lead">Common tasks for walk-in sign-ups, subscription renewals, and AI Coach setup.</div>
              <div className="adm-actions adm-quick-actions">
                <Button variant="primary" size="sm" icon="qr" onClick={() => setTab('invites')}>+ New Invite / QR Code</Button>
                <Button size="sm" className="adm-action-btn" icon="personCircle" trailingIcon="chevronRight" onClick={() => jumpToMembers('all')}>Manage Members ({users ? users.length : 0})</Button>
                {(expiringCount > 0 || expiredCount > 0) && (
                  <Button size="sm" className="adm-action-btn" icon="clock" trailingIcon="chevronRight" onClick={() => jumpToMembers(expiredCount ? 'expired' : 'expiring')}>
                    Review Renewals ({expiringCount + expiredCount})
                  </Button>
                )}
                <Button size="sm" className="adm-action-btn" icon="sparkles" trailingIcon="chevronRight" onClick={() => setTab('coach')}>AI Coach Settings</Button>
              </div>
            </div>

            <div className="card" style={{ margin: 0, borderColor: liveUsers.length ? 'var(--acc)' : undefined }}>
              <h2 className="row" style={{ margin: '0 0 2px', gap: 6 }}>
                <Icon name="dot" style={{ fontSize: 10, color: liveUsers.length ? 'var(--green)' : 'var(--label-3)' }} />Training now
              </h2>
              <div className="adm-lead">Sessions running at this moment. Tap a member for details.</div>
              {liveUsers.length > 0 ? liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)', cursor: 'pointer' }} onClick={() => openUser(u.id)}>
                <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
                  <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{u.live.name} · exercise {u.live.exIdx} of {u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
                <span className="adm-pill acc">{dur(Date.now() - u.live.startedAt)}</span>
              </div>) : <div className="adm-empty">No members currently in an active workout session.</div>}
            </div>
          </div>
        </div>

        {/* Members panel */}
        <div className={'adm-panel' + (tab === 'members' || tab === 'overview' ? '' : ' off')}>
          <div className="card">
            <div className="row between" style={{ marginBottom: 2 }}>
              <h2 style={{ margin: 0 }}>Users & Memberships</h2>
              {tab === 'overview' && <Button size="sm" variant="ghost" onClick={() => setTab('members')}>Full view →</Button>}
            </div>
            <div className="adm-lead">Everyone with a profile on this instance. Tap one to manage membership renewals, view activity, disable or delete.</div>
            {users && users.length > 0 && <>
              <input className="input" placeholder="Search by name, e-mail or phone…" value={query} onChange={e => setQuery(e.target.value)} style={{ marginBottom: 10 }} />
              <div className="chips" style={{ marginBottom: 10 }}>
                {[['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring ≤ 3d'], ['expired', 'Expired']].map(([v, l]) =>
                  <button key={v} type="button" className={'chip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{l}</button>)}
              </div>
            </>}
            <div className="list">
              {filteredUsers.map(u => {
                const ms = membershipStatus(u)
                return <button type="button" key={u.id} className="item adm-member-row" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
                  <div className="adm-avatar" aria-hidden="true">{(u.name || '?')[0].toUpperCase()}</div>
                  <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{u.owner ? 'owner' : 'admin'}</span>}{!u.admin && typeof u.membershipUntil === 'number' && <span className={'adm-pill ' + ms.cls} style={{ marginInlineStart: 4 }}>{ms.label}</span>}{u.disabled && <span className="adm-pill bad" style={{ marginInlineStart: 4 }}>disabled</span>}</div>
                    <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · last sync ' + rel(u.lastSync)}</div>
                    {(u.email || u.phone) && <div className="ss">{[u.email, u.phone].filter(Boolean).join(' · ')}</div>}</div>
                  <span className="adm-row-manage adm-desk-only">Manage</span>
                  {u.hasPush && <Icon name="bell" title="push notifications on" style={{ fontSize: 'var(--fs-subhead)', color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
                </button>
              })}
              {users && !users.length && <div className="adm-empty">No users yet.</div>}
              {users && users.length > 0 && !filteredUsers.length && <div className="adm-empty">No matching members.</div>}
            </div>
          </div>
        </div>

        {/* Invites & QR panel */}
        <div className={'adm-panel' + (tab === 'invites' ? '' : ' off')}>
          <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} />
        </div>

        {/* AI Coach panel */}
        <div className={'adm-panel' + (tab === 'coach' ? '' : ' off')}>
          <div className="adm-coach-anchor"><AdminCoach /></div>
        </div>

        {/* Activity / Audit Log panel */}
        <div className={'adm-panel' + (tab === 'audit' ? '' : ' off')}>
          <AuditCard tick={tick} owner={viewerOwner} />
        </div>
      </div>
    </main>

    {/* Dedicated Mobile Admin Bottom Tab Bar (< 768px) */}
    <nav className="adm-mobnav" aria-label="Admin mobile navigation">
      {TABS.map(item => (
        <button key={item.id} type="button" className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
          <span className="adm-mobic"><Icon name={item.icon} /></span>
          <span>{item.short}</span>
        </button>
      ))}
    </nav>
  </div>
}
