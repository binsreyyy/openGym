import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyError, bio } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import { openLostAccess } from '../components/LostAccess.jsx'
import { openInstallSheet, isStandaloneApp } from '../components/InstallPrompt.jsx'

function takeInviteFromUrl() {
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(window.location.href)
    const inv = (u.searchParams.get('invite') || '').trim().toUpperCase()
    if (!inv) return null
    const name = (u.searchParams.get('name') || '').trim().slice(0, 40)
    u.searchParams.delete('invite')
    u.searchParams.delete('name')
    const q = u.searchParams.toString()
    window.history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash)
    return { code: inv, name }
  } catch { return null }
}

function RegisterSheet({ close, initialCode = '', initialName = '' }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState(initialCode)
  const [phone, setPhone] = useState('')
  const inviteOnly = !!config?.invite_only
  const showInvite = inviteOnly || !!initialCode
  // A password is offered only where the instance allows it (#118), and is the only choice in a
  // browser that cannot make a passkey. Where both work, the passkey stays the first one.
  const pwOn = passwordOn(config)
  const [how, setHow] = useState(webauthnOK() ? 'passkey' : 'password')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const ph = phone.trim()
      const u = ph ? await passkeyRegister(n, code.trim(), ph) : await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (!isStandaloneApp()) setTimeout(() => openInstallSheet({ memberName: u.name }), 350)
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created, and this device’s data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Registration failed'))) }
  }
  const choose = pwOn && webauthnOK() && <>
    <Segmented options={[{ value: 'passkey', label: t('Passkey'), icon: 'fingerprint' }, { value: 'password', label: t('Password'), icon: 'key' }]}
      value={how} onChange={setHow} />
    <div style={{ height: 12 }} />
  </>
  if (pwOn && how === 'password') return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={showInvite} name={name} setName={setName} code={code} setCode={setCode} phone={phone} setPhone={setPhone} />
  </>
  return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="tel" name="tel" autoComplete="tel" inputMode="tel" placeholder="Phone number (optional)" maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} />
    {showInvite && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const pwOn = passwordOn(config)
  const [adminPortal, setAdminPortal] = useState(() => typeof window !== 'undefined' && /^#\/admin\b/.test(window.location.hash || ''))
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setAdminPortal(/^#\/admin\b/.test(window.location.hash || ''))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  useEffect(() => {
    const inv = takeInviteFromUrl()
    if (inv) useUI.getState().openSheet(close => <RegisterSheet close={close} initialCode={inv.code} initialName={inv.name} />)
  }, [])
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u, { adopt: true }); await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Sign-in failed'))) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc-ink)' }}><Icon name={adminPortal ? 'crown' : 'dumbbell'} /></div>
    <h1 className="t-large" style={{ fontWeight: 700, margin: '10px 0 4px' }}>{adminPortal ? 'openGym Admin' : 'openGym'}</h1>
    {adminPortal && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}><span className="adm-pill acc">Gym Management & Front Desk Portal</span></div>}
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo. Everything stays in this browser.')}</div>
      <Button variant="primary" icon="play" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'start', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{adminPortal ? 'Sign in with an admin or owner account to manage memberships, QR invites, and the AI Coach.' : t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="fingerprint" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        {pwOn && <><Button icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button><div style={{ height: 10 }} /></>}
        <Button icon="plusCircle" onClick={register}>{t('Create new profile')}</Button>
        {/* Already signed in on another device: a code from there gives this one a passkey of
            its own (#95), instead of a new, empty profile. */}
        <div style={{ height: 10 }} />
        <Button variant="ghost" className="dim" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>
        {/* No device signs you in any more (#584): what to try, and where a recovery code goes. */}
        <Button variant="ghost" className="dim" onClick={openLostAccess}>{t('Lost access?')}</Button>
        {canGuest && <div style={{ height: 4 }} />}
      </> : pwOn ? <>
        {/* Plain http on a LAN address, or a browser without passkey support: the password is
            the way in, and the only way to create a profile from here. */}
        <div className="card small muted" style={{ textAlign: 'start', marginBottom: 14 }}>{t("This browser doesn't support passkeys. Sign in with your name and password instead.")}</div>
        <Button variant="primary" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="plusCircle" onClick={register}>{t('Create new profile')}</Button>
        <Button variant="ghost" className="dim" onClick={openLostAccess}>{t('Lost access?')}</Button>
        {canGuest && <div style={{ height: 10 }} />}
      </> : <div className="card small muted" style={{ textAlign: 'start' }}>{canGuest
        ? t("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
        // Without passkeys and without the guest entrance there is no way in from this browser,
        // so say that plainly instead of offering a local profile that cannot be created.
        : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      {!adminPortal && !isStandaloneApp() && (
        <div style={{ marginTop: 14 }}>
          <a
            href="#install"
            onClick={e => { e.preventDefault(); openInstallSheet() }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 999,
              background: 'var(--surface-2)',
              color: 'var(--acc)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Icon name="phoneScreen" size={15} />
            Install app on phone (iPhone & Android)
          </a>
        </div>
      )}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{pwOn ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) : t('Passkeys use {0}. No passwords to remember.', bio())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
      <div className="dim small" style={{ marginTop: 18 }}>
        {adminPortal
          ? <a href="#/home" onClick={e => { e.preventDefault(); window.location.hash = '#/home'; setAdminPortal(false) }}>← Back to Member Workout App</a>
          : <a href="#/admin" onClick={e => { e.preventDefault(); window.location.hash = '#/admin'; setAdminPortal(true) }}>Gym Admin Portal →</a>}
      </div>
    </div>
  )
}
