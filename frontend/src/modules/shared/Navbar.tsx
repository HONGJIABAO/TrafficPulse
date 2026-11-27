import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabId } from './types';
import { NAV_TABS } from './types';
import './Navbar.css';

interface NavbarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

interface Ripple {
  id: number;
  tabId: TabId;
  x: number;
  y: number;
  size: number;
}

export function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [hasMounted, setHasMounted] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [pillStyle, setPillStyle] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    ready: boolean;
  }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  const updatePill = useCallback(() => {
    const navEl = navRef.current;
    const activeEl = tabRefs.current[activeTab];
    if (navEl && activeEl) {
      const navRect = navEl.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setPillStyle({
        left: tabRect.left - navRect.left + navEl.scrollLeft,
        top: tabRect.top - navRect.top,
        width: tabRect.width,
        height: tabRect.height,
        ready: true,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updatePill();
    // Enable sliding transition after initial placement
    const timer = setTimeout(() => setHasMounted(true), 60);
    return () => clearTimeout(timer);
  }, [updatePill]);

  useEffect(() => {
    window.addEventListener('resize', updatePill);
    const navEl = navRef.current;
    let ro: ResizeObserver | null = null;
    if (navEl) {
      navEl.addEventListener('scroll', updatePill);
      ro = new ResizeObserver(() => updatePill());
      ro.observe(navEl);
    }
    return () => {
      window.removeEventListener('resize', updatePill);
      if (navEl) navEl.removeEventListener('scroll', updatePill);
      ro?.disconnect();
    };
  }, [updatePill]);

  const handleTabClick = (e: React.MouseEvent<HTMLButtonElement>, tabId: TabId) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2.4;

    const newRipple: Ripple = {
      id: Date.now() + Math.random(),
      tabId,
      x,
      y,
      size,
    };

    setRipples(prev => [...prev, newRipple]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== newRipple.id));
    }, 800);

    onTabChange(tabId);
  };

  return (
    <header className="transit-navbar" style={{
      background: '#FFFFFF',
      borderBottom: '1px solid rgba(0,102,255,0.1)',
      boxShadow: '0 2px 12px rgba(0,102,255,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div
          style={{
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <img
            src="/logo.png"
            alt="TransitPulse Malaysia"
            style={{
              width: 54,
              height: 54,
              maxWidth: 'none',
              objectFit: 'contain',
              display: 'block',
              filter: 'drop-shadow(0 2px 6px rgba(0, 102, 255, 0.16))',
            }}
          />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0F1E36', lineHeight: 1.2 }}>
            TransitPulse Malaysia
          </div>
          <div style={{ fontSize: 10, color: '#64748B', letterSpacing: '0.5px' }}>
            SMARTER RAIL MOBILITY
          </div>
        </div>
      </div>

      {/* Nav Tabs */}
      <nav
        ref={navRef}
        aria-label="Dashboard modules"
        className="nav-tabs-container"
      >
        {/* Shared Animated Sliding Active Pill */}
        <div
          className={`nav-sliding-pill ${hasMounted ? 'has-transition' : ''}`}
          style={{
            left: pillStyle.left,
            top: pillStyle.top,
            width: pillStyle.width,
            height: pillStyle.height,
            opacity: pillStyle.ready ? 1 : 0,
          }}
          aria-hidden="true"
        >
          {/* Layer: Animated Pastel Gradient + Shimmer */}
          <div className="nav-pill-base">
            <div className="nav-pill-shimmer" />
          </div>
        </div>

        {/* Tab Buttons */}
        {NAV_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const tabRipples = ripples.filter(r => r.tabId === tab.id);

          return (
            <button
              key={tab.id}
              ref={el => { tabRefs.current[tab.id] = el; }}
              onClick={e => handleTabClick(e, tab.id)}
              className={`nav-tab-btn ${isActive ? 'is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="tab-label">{tab.label}</span>

              {/* Water Ripple Layer */}
              <span className="tab-ripple-container">
                {tabRipples.map(r => (
                  <span
                    key={r.id}
                    className="tab-ripple-bubble"
                    style={{
                      left: r.x - r.size / 2,
                      top: r.y - r.size / 2,
                      width: r.size,
                      height: r.size,
                    }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}

export default Navbar;
