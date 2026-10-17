import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { ScrollToTop } from './ScrollToTop.jsx';

// Wide reports that read best full width — the sidebar closes to its icon rail
// when one of these opens (it can still be opened with the toggle).
const WIDE_ROUTES = ['/scr'];

export function Layout() {
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => WIDE_ROUTES.includes(pathname));

  // The scroll container is <main>, not the window — so on every route change
  // reset it to the top. Otherwise a new page opens scrolled to wherever the
  // previous page was left.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    setCollapsed(WIDE_ROUTES.includes(pathname));
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      <ScrollToTop targetRef={mainRef} />
    </div>
  );
}
