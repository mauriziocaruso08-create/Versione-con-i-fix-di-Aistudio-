import { MaiaReminder } from '../types';

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the minimal service worker for showing system notifications on Android/Mobile.
 */
export function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        return reg;
      })
      .catch((err) => {
        console.warn('[NotificationManager] ServiceWorker registration failed:', err);
        return null;
      });
  }

  return swRegistrationPromise;
}

/**
 * Retrieves the active ServiceWorkerRegistration if available.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg) return reg;
    return await registerNotificationServiceWorker();
  } catch (e) {
    return null;
  }
}

/**
 * Checks if the browser supports the Web Notification API.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Returns current Notification permission.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Requests Notification permission on explicit user interaction.
 * Supports both standard Promise and legacy callback architectures.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  // If already decided, do not repeatedly prompt or crash
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  try {
    let permission: NotificationPermission;

    try {
      const res = Notification.requestPermission();
      if (res && typeof (res as unknown as Promise<NotificationPermission>).then === 'function') {
        permission = await res;
      } else {
        permission = await new Promise<NotificationPermission>((resolve) => {
          Notification.requestPermission((p) => resolve(p));
        });
      }
    } catch {
      permission = await new Promise<NotificationPermission>((resolve) => {
        Notification.requestPermission((p) => resolve(p));
      });
    }

    if (permission === 'granted') {
      registerNotificationServiceWorker().catch(() => {});
    }

    return permission;
  } catch (err) {
    console.warn('[NotificationManager] Error requesting notification permission:', err);
    return Notification.permission;
  }
}

// In-memory set to prevent double-firing in the same session
const deliveredNotificationIds = new Set<string>();

/**
 * Shows a browser system notification for a due reminder.
 * On Android Chrome, utilizes ServiceWorkerRegistration.showNotification() to prevent Illegal constructor error.
 * On desktop browsers, falls back gracefully to new Notification().
 */
export async function showReminderNotification(reminder: MaiaReminder): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  if (deliveredNotificationIds.has(reminder.id)) {
    return false;
  }

  const title = '⏰ Promemoria MAIA';
  const options: NotificationOptions = {
    body: reminder.text,
    tag: `maia-rem-${reminder.id}`,
    icon: '/favicon.ico',
    lang: 'it-IT',
    requireInteraction: true,
  };

  // 1. Primary path for Android Chrome and modern browsers: ServiceWorkerRegistration.showNotification()
  try {
    const reg = await getServiceWorkerRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      deliveredNotificationIds.add(reminder.id);
      return true;
    }
  } catch (swErr) {
    console.warn('[NotificationManager] ServiceWorker showNotification error:', swErr);
  }

  // 2. Desktop fallback: new Notification() (Strictly avoid on Android where it throws Illegal constructor)
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  if (!isAndroid) {
    try {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        try {
          window.focus();
        } catch (e) {}
        notification.close();
      };
      deliveredNotificationIds.add(reminder.id);
      return true;
    } catch (err) {
      console.warn('[NotificationManager] Desktop Notification fallback failed:', err);
    }
  }

  return false;
}
