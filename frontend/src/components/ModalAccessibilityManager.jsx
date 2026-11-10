import { useEffect } from 'react';

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isVisible(element) {
  if (!element?.isConnected) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function getTopmostDialog() {
  return Array.from(document.querySelectorAll(DIALOG_SELECTOR))
    .filter(isVisible)
    .map((element, index) => ({
      element,
      index,
      zIndex: Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0
    }))
    .sort((a, b) => a.zIndex - b.zIndex || a.index - b.index)
    .at(-1)?.element || null;
}

function getFocusable(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element =>
    isVisible(element) &&
    !element.closest('[inert]') &&
    element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Central safety net for the app's existing modal implementations.
 * Keeps legacy dialogs usable without requiring every feature to reimplement
 * focus trapping, background inerting, scroll locking and focus restoration.
 */
export default function ModalAccessibilityManager() {
  useEffect(() => {
    let activeDialog = null;
    let returnFocusTo = null;
    let previousBodyOverflow = '';
    let previousHtmlOverflow = '';
    let restoreNodes = new Map();
    let syncQueued = false;

    const restoreBackground = () => {
      restoreNodes.forEach(({ inert, ariaHidden }, node) => {
        if (!node.isConnected) return;
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      restoreNodes.clear();
    };

    const isolateBackground = dialog => {
      // Walk from the dialog to body, inerting siblings at every level. This
      // also works when a modal is rendered inside the app root rather than a portal.
      let branch = dialog;
      while (branch?.parentElement && branch.parentElement !== document.body) {
        const parent = branch.parentElement;
        Array.from(parent.children).forEach(sibling => {
          if (sibling === branch || restoreNodes.has(sibling)) return;
          restoreNodes.set(sibling, {
            inert: sibling.inert,
            ariaHidden: sibling.getAttribute('aria-hidden')
          });
          sibling.inert = true;
          sibling.setAttribute('aria-hidden', 'true');
        });
        branch = parent;
      }

      // Keep unrelated body-level portals and app roots inactive as well.
      Array.from(document.body.children).forEach(sibling => {
        if (sibling === branch || restoreNodes.has(sibling)) return;
        restoreNodes.set(sibling, {
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden')
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      });
    };

    const focusInside = dialog => {
      const target = dialog.querySelector('[autofocus], [data-modal-initial-focus]') || getFocusable(dialog)[0] || dialog;
      if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      target.focus?.({ preventScroll: true });
    };

    const sync = () => {
      syncQueued = false;
      const nextDialog = getTopmostDialog();
      if (nextDialog === activeDialog) return;

      if (activeDialog) {
        restoreBackground();
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
        const previous = returnFocusTo;
        activeDialog = null;
        returnFocusTo = null;
        if (!nextDialog && previous?.isConnected && !previous.closest('[inert]')) {
          previous.focus?.({ preventScroll: true });
        }
      }

      if (!nextDialog) return;
      activeDialog = nextDialog;
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousBodyOverflow = document.body.style.overflow;
      previousHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      isolateBackground(nextDialog);
      window.requestAnimationFrame(() => {
        if (activeDialog === nextDialog && !nextDialog.contains(document.activeElement)) focusInside(nextDialog);
      });
    };

    const scheduleSync = () => {
      if (syncQueued) return;
      syncQueued = true;
      window.queueMicrotask(sync);
    };

    const onKeyDown = event => {
      if (!activeDialog || !activeDialog.isConnected) return;
      if (event.key === 'Escape') {
        // Let each modal's own Escape handler decide whether it can close.
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable(activeDialog);
      if (!items.length) {
        event.preventDefault();
        activeDialog.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = event => {
      if (activeDialog && !activeDialog.contains(event.target)) focusInside(activeDialog);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'role', 'class', 'style', 'hidden']
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    scheduleSync();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      restoreBackground();
      if (activeDialog) {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
      }
      if (returnFocusTo?.isConnected) returnFocusTo.focus?.({ preventScroll: true });
    };
  }, []);

  return null;
}
