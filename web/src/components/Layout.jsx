import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';

export function Layout() {
  const mainRef = useRef(null);
  const { pathname } = useLocation();

  // The scroll container is <main>, not the window — so on every route change
  // reset it to the top. Otherwise a new page opens scrolled to wherever the
  // previous page was left.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main ref={mainRef} className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
