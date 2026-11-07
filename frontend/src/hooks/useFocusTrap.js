import { useEffect, useRef } from 'react';

/**
 * Custom React hook for seamless focus trapping and keyboard navigation (Tab/Shift+Tab and Esc to close)
 * within .pharma-modal-surface dialogs.
 */
export function useFocusTrap(isOpen, onClose) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const modalElement = modalRef.current;
    if (!modalElement) return;

    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = modalElement.querySelectorAll(focusableSelectors);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (firstElement && typeof firstElement.focus === 'function') {
      firstElement.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (focusableElements.length === 0) return;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return modalRef;
}
