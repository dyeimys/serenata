import { initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, type Analytics } from 'firebase/analytics'
import { firebaseApp } from './firebase'

type AnalyticsValue = string | number | boolean
type AnalyticsParameters = Record<string, AnalyticsValue>

const EVENT_PREFIX = 'manager_'
const scrollMilestones = [25, 50, 75, 100]
const reachedScrollMilestones = new Set<number>()

let listenersInstalled = false
let lastPagePath = ''
let lastPageViewAt = 0

const analyticsPromise: Promise<Analytics | null> = (async () => {
  if (!firebaseApp || !import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || !(await isSupported())) return null

  const analytics = initializeAnalytics(firebaseApp, { config: { send_page_view: false } })
  setAnalyticsCollectionEnabled(analytics, true)
  return analytics
})().catch((error: unknown) => {
  console.warn('Google Analytics não pôde ser inicializado.', error)
  return null
})

function clean(value: string | null | undefined, fallback = 'unknown') {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized?.slice(0, 100) || fallback
}

function route() {
  return window.location.pathname || '/'
}

function elementMetadata(element: Element): AnalyticsParameters {
  const htmlElement = element as HTMLElement
  const form = element.closest('form')
  const dialog = element.closest('[role="dialog"]')

  return {
    page_path: route(),
    element_type: clean(element.tagName),
    element_id: clean(element.getAttribute('data-analytics-id') || element.id || element.getAttribute('name')),
    element_role: clean(element.getAttribute('role') || element.getAttribute('type')),
    form_id: clean(form?.getAttribute('data-analytics-id') || form?.id),
    dialog_id: clean(dialog?.getAttribute('aria-labelledby') || dialog?.id),
    is_disabled: htmlElement.matches(':disabled'),
  }
}

function interactiveElement(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest('button, a, input, select, textarea, [role="button"], [data-analytics-id]')
    : null
}

export function trackManagerEvent(name: string, parameters: AnalyticsParameters = {}) {
  const eventName = `${EVENT_PREFIX}${clean(name)}`.slice(0, 40)
  void analyticsPromise.then((analytics) => {
    if (analytics) logEvent(analytics, eventName, parameters)
  })
}

export function trackPageView(path: string, title = document.title) {
  const now = Date.now()
  if (lastPagePath === path && now - lastPageViewAt < 1_000) return

  lastPagePath = path
  lastPageViewAt = now
  reachedScrollMilestones.clear()
  trackManagerEvent('page_view', { page_path: path, page_title: title.slice(0, 100) })
}

export function installAutomaticTracking() {
  if (listenersInstalled) return
  listenersInstalled = true

  document.addEventListener('click', (event) => {
    const element = interactiveElement(event.target)
    if (!element) return

    const parameters = elementMetadata(element)
    if (element instanceof HTMLAnchorElement) {
      parameters.link_domain = element.hostname || window.location.hostname
      parameters.link_path = element.pathname || '/'
      parameters.is_external = Boolean(element.hostname && element.hostname !== window.location.hostname)
    }
    trackManagerEvent('click', parameters)
  }, true)

  document.addEventListener('focusin', (event) => {
    const element = interactiveElement(event.target)
    if (element?.matches('input, select, textarea')) trackManagerEvent('field_focus', elementMetadata(element))
  })

  document.addEventListener('change', (event) => {
    const element = interactiveElement(event.target)
    if (!element?.matches('input, select, textarea')) return

    const parameters = elementMetadata(element)
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      parameters.is_checked = element.checked
    }
    trackManagerEvent('field_change', parameters)
  })

  document.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement) trackManagerEvent('form_submit', elementMetadata(event.target))
  }, true)

  window.addEventListener('scroll', () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    if (scrollable <= 0) return
    const percentage = Math.min(100, Math.round((window.scrollY / scrollable) * 100))
    for (const milestone of scrollMilestones) {
      if (percentage >= milestone && !reachedScrollMilestones.has(milestone)) {
        reachedScrollMilestones.add(milestone)
        trackManagerEvent('scroll_depth', { page_path: route(), percent_scrolled: milestone })
      }
    }
  }, { passive: true })

  document.addEventListener('visibilitychange', () => {
    trackManagerEvent('visibility_change', { page_path: route(), visibility_state: document.visibilityState })
  })

  window.addEventListener('error', () => {
    trackManagerEvent('app_error', { page_path: route(), error_type: 'runtime' })
  })

  window.addEventListener('unhandledrejection', () => {
    trackManagerEvent('app_error', { page_path: route(), error_type: 'unhandled_promise' })
  })

  trackManagerEvent('app_open', { page_path: route(), viewport_width: window.innerWidth, viewport_height: window.innerHeight })
}
