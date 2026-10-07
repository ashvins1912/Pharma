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
        previousOverflow = document.body.style.overflow;
        previousPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
        document.body.classList.add('modal-open');
      } else if (!modal && locked) {
        locked = false;
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
        document.body.classList.remove('modal-open');
      }
    };

    const blockBackgroundInteraction = (event) => {
      const modal = findActiveModal();
      if (!modal || modal.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });

    ['wheel', 'touchmove', 'pointerdown', 'mousedown', 'keydown'].forEach((name) => {
      document.addEventListener(name, blockBackgroundInteraction, true);
    });

    updateLock();

    return () => {
      observer.disconnect();
      ['wheel', 'touchmove', 'pointerdown', 'mousedown', 'keydown'].forEach((name) => {
        document.removeEventListener(name, blockBackgroundInteraction, true);
      });
      if (locked) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
        document.body.classList.remove('modal-open');
      }
    };
  }, []);

  return null;
}
