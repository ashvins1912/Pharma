import { useEffect } from 'react';

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR = [
  'a[href]', 'area[href]', 'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isVisible(element) {
  if (!element?.isConnected) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function getTopmostDialog() {
  const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR))
    .filter(isVisible)
    .map((element, index) => ({
      element,
      index,
      zIndex: Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0
    }))
    .sort((a, b) => a.zIndex - b.zIndex || a.index - b.index)
    .map(item => item.element);
  return dialogs[dialogs.length - 1] || null;
}

function getFocusable(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element =>
    isVisible(element) && !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Shared accessibility and interaction guard for legacy and new application
 * dialogs: focus containment, background inerting, scroll lock and focus return.
 */
export default function ModalAccessibilityManager() {
  useEffect(() => {
    let activeDialog = null;
    let returnFocusTo = null;
    let bodyOverflow = '';
    let htmlOverflow = '';
    let restoreNodes = new Map();
    let queued = false;

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
      let branch = dialog;
      while (branch?.parentElement && branch.parentElement !== document.body) {
        const parent = branch.parentElement;
        Array.from(parent.children).forEach(sibling => {
          if (sibling === branch || restoreNodes.has(sibling)) return;
          restoreNodes.set(sibling, { inert: sibling.inert, ariaHidden: sibling.getAttribute('aria-hidden') });
          sibling.inert = true;
          sibling.setAttribute('aria-hidden', 'true');
        });
        branch = parent;
      }
      Array.from(document.body.children).forEach(sibling => {
        if (sibling === branch || restoreNodes.has(sibling)) return;
        restoreNodes.set(sibling, { inert: sibling.inert, ariaHidden: sibling.getAttribute('aria-hidden') });
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
      queued = false;
      const nextDialog = getTopmostDialog();
      if (nextDialog === activeDialog) return;
      const originalReturnFocus = returnFocusTo;

      if (activeDialog) {
        restoreBackground();
        document.body.style.overflow = bodyOverflow;
        document.documentElement.style.overflow = htmlOverflow;
        activeDialog = null;
        returnFocusTo = null;
        if (!nextDialog && originalReturnFocus?.isConnected && !originalReturnFocus.closest('[inert]')) {
          originalReturnFocus.focus?.({ preventScroll: true });
        }
      }

      if (!nextDialog) return;
      activeDialog = nextDialog;
      // Preserve the original opener when dialogs are stacked or replaced.
      returnFocusTo = originalReturnFocus?.isConnected
        ? originalReturnFocus
        : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      bodyOverflow = document.body.style.overflow;
      htmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      isolateBackground(nextDialog);
      window.requestAnimationFrame(() => {
        if (activeDialog === nextDialog && !nextDialog.contains(document.activeElement)) focusInside(nextDialog);
      });
    };

    const scheduleSync = () => {
      if (queued) return;
      queued = true;
      window.queueMicrotask(sync);
    };

    const onKeyDown = event => {
      if (!activeDialog || !activeDialog.isConnected) return;
      if (event.key === 'Escape') {
        // Existing modal handlers take priority; otherwise activate a safe,
        // explicitly labelled close/dismiss control when one is available.
        window.queueMicrotask(() => {
          if (event.defaultPrevented || !activeDialog?.isConnected) return;
          const closeControl = activeDialog.querySelector(
            '[data-modal-close], button[aria-label*="close" i], button[title*="close" i], button[aria-label*="dismiss" i]'
          ) || getFocusable(activeDialog).find(element => /^(close|dismiss|cancel|×|✕)$/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()));
          closeControl?.click();
        });
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
        document.body.style.overflow = bodyOverflow;
        document.documentElement.style.overflow = htmlOverflow;
      }
      if (returnFocusTo?.isConnected) returnFocusTo.focus?.({ preventScroll: true });
    };
  }, []);

  return null;
}
