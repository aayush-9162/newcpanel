// ScrollToTop — floating "back to top" button shown on every page.
//
// The app scrolls inside <main> (see Layout), not the window, so this watches
// that element's scrollTop and smooth-scrolls it back up. It fades/slides in
// once you've scrolled down a bit and stays out of the way otherwise.

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';

export function ScrollToTop({ targetRef }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const onScroll = () => setShow(el.scrollTop > 300);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [targetRef]);

  const toTop = () => targetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      title="Back to top"
      className={cn(
        'group fixed bottom-6 right-6 z-40 grid h-12 w-12 place-items-center rounded-full',
        'bg-gradient-to-br from-blue-500 to-indigo-600 text-white',
        'shadow-lg shadow-indigo-500/40 ring-1 ring-white/25 backdrop-blur',
        'transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/50 active:scale-90',
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
      )}
    >
      {/* soft pulsing halo for a bit of life */}
      <span className="absolute inset-0 rounded-full bg-indigo-400/30 opacity-0 transition group-hover:animate-ping group-hover:opacity-100" />
      <ArrowUp size={22} strokeWidth={2.5} className="relative transition-transform duration-300 group-hover:-translate-y-0.5" />
    </button>
  );
}
