import { useEffect } from 'react';

function getTopmostModal() {
  if (typeof document === 'undefined') return null;
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && Number(style.opacity || 1) > 0;
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

    const canScrollWithin = (target, modal) => {
      let current = target instanceof Element ? target : null;
      while (current && current !== modal.parentElement) {
        if (current === modal) return false;
        const style = window.getComputedStyle(current);
        if (/(auto|scroll)/.test(style.overflowY) &&
            current.scrollHeight > current.clientHeight + 1) return true;
        current = current.parentElement;
      }
      return false;
    };

    const preventBackgroundScroll = (event) => {
      const modal = getTopmostModal();
      if (!modal) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && modal.contains(target) && canScrollWithin(target, modal)) return;
      if (event.cancelable) event.preventDefault();
    };

    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-modal', 'hidden']
    });
    window.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    window.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
    updateLock();

    return () => {
      observer.disconnect();
      window.removeEventListener('wheel', preventBackgroundScroll);
      window.removeEventListener('touchmove', preventBackgroundScroll);
      if (locked && previous) {
        document.documentElement.style.overflow = previous.htmlOverflow || '';
        document.body.style.overflow = previous.bodyOverflow || '';
        document.body.style.paddingRight = previous.bodyPaddingRight || '';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      }
    };
  }, []);
  return null;
}
