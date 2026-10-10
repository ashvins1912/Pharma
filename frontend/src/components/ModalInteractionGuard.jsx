import { useEffect } from 'react';

function findActiveModal() {
  if (typeof document === 'undefined') return null;

  const dialogs = Array.from(document.querySelectorAll(
    '[aria-modal="true"], [role="dialog"], .pharma-modal-surface'
  )).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });

  if (dialogs.length) return dialogs[dialogs.length - 1];

  // Only explicit modal surfaces may lock page scrolling.
  return null;
}

export default function ModalInteractionGuard() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    let locked = false;
    let previousBodyOverflow = '';
    let previousDocOverflow = '';
    let previousPaddingRight = '';

    const updateLock = () => {
      const modal = findActiveModal();
      if (modal && !locked) {
        locked = true;
        previousBodyOverflow = document.body.style.overflow;
        previousDocOverflow = document.documentElement.style.overflow;
        previousPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
          document.body.style.paddingRight = `${scrollbarWidth}px`;
        }
        document.documentElement.classList.add('modal-open');
        document.body.classList.add('modal-open');
      } else if (!modal && locked) {
        locked = false;
        document.documentElement.style.overflow = previousDocOverflow || '';
        document.body.style.overflow = previousBodyOverflow || '';
        document.body.style.paddingRight = previousPaddingRight || '';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      }
    };

    const isScrollableContent = (el) => {
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        if (current.classList && (
          current.classList.contains('modal-backdrop') ||
          current.classList.contains('backdrop-blur-[2px]') ||
          current.getAttribute('aria-hidden') === 'true'
        )) {
          return false;
        }
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
        if (canScroll) return true;
        current = current.parentElement;
      }
      return false;
    };

    const blockBackgroundScroll = (event) => {
      const modal = findActiveModal();
      if (!modal) return;

      // Prevent wheel/touchmove unless explicitly interacting inside a scrollable modal container
      if (!isScrollableContent(event.target)) {
        if (event.cancelable) {
          event.preventDefault();
        }
      }
    };

    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });

    window.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    window.addEventListener('touchmove', blockBackgroundScroll, { passive: false });

    updateLock();

    return () => {
      observer.disconnect();
      window.removeEventListener('wheel', blockBackgroundScroll);
      window.removeEventListener('touchmove', blockBackgroundScroll);
      if (locked) {
        document.documentElement.style.overflow = previousDocOverflow || '';
        document.body.style.overflow = previousBodyOverflow || '';
        document.body.style.paddingRight = previousPaddingRight || '';
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      }
    };
  }, []);

  return null;
}
