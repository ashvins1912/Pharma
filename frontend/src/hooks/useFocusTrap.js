import { useEffect, useRef } from 'react';

/** Focus management for dialogs: trap Tab, close on Escape, restore focus. */
export function useFocusTrap(isOpen, onClose) {
  const modalRef = useRef(null);

  useEffect(() => {
    const modal = modalRef.current;
    if (!isOpen || !modal) return undefined;
    const previousFocus = document.activeElement;
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(modal.querySelectorAll(selector))
      .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);

    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    (getFocusable()[0] || modal).focus?.();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', handleKeyDown);
    return () => {
      modal.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen, onClose]);

  return modalRef;
}
