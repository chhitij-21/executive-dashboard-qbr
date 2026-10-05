import { useEffect } from 'react';

export function useKeyboardShortcuts({ onSelectTab, onFocusSearch, onCloseModal }) {
  useEffect(() => {
    function handleKeyDown(e) {
      // Ignore shortcut keypresses if user is typing in an input element
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      );

      if (e.key === 'Escape') {
        if (onCloseModal) onCloseModal();
        return;
      }

      if (isInput) return;

      if (e.key === '/') {
        e.preventDefault();
        if (onFocusSearch) onFocusSearch();
        return;
      }

      const keyUpper = e.key.toUpperCase();
      switch (keyUpper) {
        case 'G':
          e.preventDefault();
          if (onSelectTab) onSelectTab('engineer');
          break;
        case 'H':
          e.preventDefault();
          if (onSelectTab) onSelectTab('reasons');
          break;
        case 'S':
          e.preventDefault();
          if (onSelectTab) onSelectTab('site');
          break;
        case 'R':
          e.preventDefault();
          if (onSelectTab) onSelectTab('raw');
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectTab, onFocusSearch, onCloseModal]);
}
