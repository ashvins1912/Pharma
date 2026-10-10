import { useEffect } from 'react';

function findActiveModal() {
  if (typeof document === 'undefined') return null;

  const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"], .pharma-modal-surface'))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

  if (dialogs.length) return dialogs[dialogs.length - 1];

  // Only explicit modal surfaces may lock page scrolling.
  // Fixed UI such as loading indicators must never disable mobile scrolling.
  return null;
}

export default function ModalInteractionGuard() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    let locked = false;
    let previousOverflow = '';
    let previousPaddingRight = '';

    const updateLock = () => {
      const modal = findActiveModal();
      if (modal && !locked) {
        locked = true;
        document.body.classList.add('modal-open');
      } else if (!modal && locked) {
        locked = false;
        document.body.classList.remove('modal-open');
      }
    };

    const blockBackgroundInteraction = (event) => {
      // Focus trapping/esc handling for modals without preventing scrolling
      const modal = findActiveModal();
      if (!modal || modal.contains(event.target)) return;
      if (['pointerdown', 'mousedown'].includes(event.type)) {
        // Prevent background clicks outside modal overlay
        event.stopPropagation();
      }
    };

    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });

    ['pointerdown', 'mousedown'].forEach((name) => {
      document.addEventListener(name, blockBackgroundInteraction, true);
    });

    updateLock();

    return () => {
      observer.disconnect();
      ['pointerdown', 'mousedown'].forEach((name) => {
        document.removeEventListener(name, blockBackgroundInteraction, true);
      });
      if (locked) {
        document.body.classList.remove('modal-open');
      }
    };
  }, []);

  return null;
}
