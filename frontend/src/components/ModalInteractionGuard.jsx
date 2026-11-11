import { useEffect } from 'react';

function getTopmostModal() {
  if (typeof document === 'undefined') return null;
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .filter((element) => {
      if (!element.isConnected) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' &&
        style.opacity !== '0' &&
        !element.hasAttribute('hidden') &&
        rect.width > 0 &&
        rect.height > 0;
    })
    .sort((a, b) => {
      const za = Number.parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
      const zb = Number.parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
      return za - zb;
    })
    .at(-1) || null;
}

export default function ModalInteractionGuard() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let locked = false;
    let previous = null;

    const updateLock = () => {
      const modal = getTopmostModal();
      if (modal && !locked) {
        locked = true;
        previous = {
          htmlOverflow: document.documentElement.style.overflow,
          bodyOverflow: document.body.style.overflow,
          bodyPaddingRight: document.body.style.paddingRight
        };
        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth) document.body.style.paddingRight = `${scrollbarWidth}px`;
        document.documentElement.classList.add('modal-open');
        document.body.classList.add('modal-open');
      } else if (!modal && locked) {
        locked = false;
        document.documentElement.style.overflow = previous?.htmlOverflow || '';
        document.body.style.overflow = previous?.bodyOverflow || '';
        document.body.style.paddingRight = previous?.bodyPaddingRight || '';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
        previous = null;
      }
    };

    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-modal', 'hidden']
    });
    updateLock();

    return () => {
      observer.disconnect();
      if (locked) {
        document.documentElement.style.overflow = previous?.htmlOverflow || '';
        document.body.style.overflow = previous?.bodyOverflow || '';
        document.body.style.paddingRight = previous?.bodyPaddingRight || '';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      }
    };
  }, []);
  return null;
}

