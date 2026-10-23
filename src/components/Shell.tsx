'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HeartHandshake,
  LayoutDashboard,
  Users,
  UserRound,
  CalendarDays,
  ClipboardList,
  Target,
  Files,
  Settings,
  Menu,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import type { Actor } from '@/lib/auth';
const links = [
  ['Dashboard', '/', LayoutDashboard],
  ['Clients', '/clients', Users],
  ['Staff', '/staff', UserRound],
  ['Schedule', '/schedule', CalendarDays],
  ['Sessions', '/sessions', ClipboardList],
  ['Goals', '/goals', Target],
  ['Documents', '/documents', Files],
  ['Settings', '/settings', Settings],
] as const;
export default function Shell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <a href="#main-content" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <HeartHandshake size={24} />
          </span>
          <span className="nav-label">brightpath</span>
        </Link>
        <nav aria-label="Main navigation">
          {links
            .filter(([name]) => actor.role === 'ADMIN' || !['Staff', 'Settings'].includes(name))
            .map(([name, url, Icon]) => (
              <Link
                key={url}
                href={url}
                aria-label={name}
                title={name}
                onClick={() => setOpen(false)}
                className={`nav-link ${url === '/' ? path === '/' : path.startsWith(url) ? 'active' : ''} ${url === '/' && path === '/' ? 'active' : ''}`}
              >
                <Icon size={19} />
                <span className="nav-label">{name}</span>
              </Link>
            ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="desktop-collapse"
            aria-label="Collapse or expand sidebar"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '→' : '←'}
            <span className="nav-label">Collapse sidebar</span>
          </button>
          <div className="small muted nav-label">CARE, CONNECTED.</div>
          <p className="small nav-label">
            A little clarity.
            <br />A lot more possibility.
          </p>
          <button
            aria-label="Sign out"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
          >
            <LogOut size={16} />
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main" id="main-content">
        <header className="topbar">
          <div className="row">
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Menu size={20} />
            </button>
            <span className="muted small">Your workspace</span>
            <ChevronRight size={13} />
            <strong>
              {links.find(([, url]) => (url === '/' ? path === '/' : path.startsWith(url)))?.[0] ||
                'Care workspace'}
            </strong>
          </div>
          <div className="row">
            <span className="avatar">
              {actor.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <strong className="small">{actor.name}</strong>
              <div className="small muted">
                {actor.role === 'ADMIN' ? 'Administrator' : actor.role}
              </div>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
