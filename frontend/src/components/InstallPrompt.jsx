import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

let deferredPrompt = null
const listeners = new Set()
const notify = () => listeners.forEach(fn => fn(deferredPrompt))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredPrompt = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

/** True when already running from an installed Home Screen / standalone PWA icon. */
export function isStandaloneApp() {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true
    || document?.referrer?.startsWith('android-app://')
  )
}

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'ios'
  const ua = navigator.userAgent || ''
  const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIos) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'ios'
}

function StepRow({ step, icon, title, body }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 12,
      background: 'var(--surface-2)',
      textAlign: 'left',
    }}>
      <div style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--acc-soft)',
        color: 'var(--acc)',
      }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--label)' }}>
          {step}. {title}
        </div>
        <div className="dim small" style={{ marginTop: 2, lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

function InstallSheet({ memberName = '', close }) {
  const [platform, setPlatform] = useState(detectPlatform)
  const [installEvent, setInstallEvent] = useState(() => deferredPrompt)
  const [installing, setInstalling] = useState(false)
  const cleanName = String(memberName || '').trim()

  useEffect(() => {
    listeners.add(setInstallEvent)
    return () => listeners.delete(setInstallEvent)
  }, [])

  const triggerNativeInstall = async () => {
    if (!installEvent) return
    setInstalling(true)
    try {
      await installEvent.prompt()
      await installEvent.userChoice
      deferredPrompt = null
      notify()
      close()
    } catch {
      // Fall back to the manual Chrome menu instructions shown below
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div style={{ textAlign: 'center', padding: '4px 0' }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        margin: '0 auto 10px',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--acc-soft)',
        color: 'var(--acc)',
      }}>
        <Icon name="phoneScreen" size={24} />
      </div>

      <h3 style={{ marginBottom: 4 }}>Install openGym on Your Phone</h3>
      <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.45 }}>
        {cleanName
          ? <>Welcome, <b>{cleanName}</b>! Save openGym to your Home Screen for one-tap workouts and full-screen mode — no app store needed.</>
          : 'Save openGym to your Home Screen for one-tap workouts and full-screen mode — no app store needed.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <Button variant={platform === 'ios' ? 'primary' : 'plain'} onClick={() => setPlatform('ios')}>
          iPhone / iOS
        </Button>
        <Button variant={platform === 'android' ? 'primary' : 'plain'} onClick={() => setPlatform('android')}>
          Android
        </Button>
      </div>

      {platform === 'ios' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <StepRow
            step={1}
            icon="share"
            title="Tap the Share button in Safari"
            body="Look at the bottom bar of Safari for the square with an upward arrow. (Using another iPhone browser? Open this link in Safari first.)"
          />
          <StepRow
            step={2}
            icon="plusCircle"
            title="Choose 'Add to Home Screen'"
            body="Scroll down the Share sheet, tap Add to Home Screen, then tap Add in the top corner."
          />
          <StepRow
            step={3}
            icon="phoneScreen"
            title="Open openGym from your Home Screen"
            body="Launch the new openGym icon anytime to check in and track workouts full-screen."
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {installEvent && (
            <Button variant="primary" icon="download" disabled={installing} onClick={triggerNativeInstall}>
              {installing ? 'Opening installer…' : 'Install openGym App Now'}
            </Button>
          )}
          <StepRow
            step={1}
            icon="more"
            title="Tap the Chrome menu (⋮)"
            body="Open the three-dot menu in the top-right corner of Chrome on Android."
          />
          <StepRow
            step={2}
            icon="download"
            title="Tap 'Install app' or 'Add to Home screen'"
            body="Confirm Install when prompted so Android adds openGym to your apps and Home Screen."
          />
          <StepRow
            step={3}
            icon="phoneScreen"
            title="Open openGym from your Home Screen"
            body="Your account, membership pass, and workout history stay signed in inside the app."
          />
        </div>
      )}

      <Button variant="ghost" className="dim" onClick={close}>
        {cleanName ? 'Maybe later — go to workouts' : 'Done'}
      </Button>
    </div>
  )
}

/** Open the iOS / Android "Add to Home Screen" & install sheet safely (no-op if UI sheet store is mocked). */
export function openInstallSheet({ memberName = '' } = {}) {
  useUI.getState()?.openSheet?.(close => <InstallSheet memberName={memberName} close={close} />)
}
