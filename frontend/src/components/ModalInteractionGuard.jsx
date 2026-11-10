import { useEffect } from 'react';

function getTopmostModal() {
  if (typeof document === 'undefined') return null;
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && !element.hasAttribute('hidden');
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

    // ModalAccessibilityManager owns document scroll locking, focus trapping,
    // background inerting and focus restoration. This guard only prevents
    // wheel/touch gestures from leaking through a modal backdrop.
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

    window.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    window.addEventListener('touchmove', preventBackgroundScroll, { passive: false });

    return () => {
      window.removeEventListener('wheel', preventBackgroundScroll);
      window.removeEventListener('touchmove', preventBackgroundScroll);
    };
  }, []);

  return null;
}
