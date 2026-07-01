import { useState, useEffect } from 'react';
import type { PayPeriod } from '@brightem/shared';
import { api } from './api';
import { useI18n } from './i18n';
import type { TKey, Lang } from './i18n';
import Dashboard from './screens/Dashboard';
import Attendance from './screens/Attendance';
import Payroll from './screens/Payroll';
import Payslip from './screens/Payslip';
import Employees from './screens/Employees';
import Skills from './screens/Skills';
import Settings from './screens/Settings';

type ScreenKey =
  | 'dashboard'
  | 'attendance'
  | 'payroll'
  | 'payslip'
  | 'employees'
  | 'skills'
  | 'settings';

interface NavItem {
  key: ScreenKey;
  icon: string;
  labelKey: TKey;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: '▤', labelKey: 'nav.dashboard' },
  { key: 'attendance', icon: '🕑', labelKey: 'nav.attendance' },
  { key: 'payroll', icon: '₱', labelKey: 'nav.payroll' },
  { key: 'payslip', icon: '🧾', labelKey: 'nav.payslip' },
  { key: 'employees', icon: '👷', labelKey: 'nav.employees' },
  { key: 'skills', icon: '🛠', labelKey: 'nav.skills' },
  { key: 'settings', icon: '⚙', labelKey: 'nav.settings' },
];

const SCREEN_TITLES: Record<ScreenKey, TKey> = {
  dashboard: 'nav.dashboard',
  attendance: 'nav.attendance',
  payroll: 'nav.payroll',
  payslip: 'nav.payslip',
  employees: 'nav.employees',
  skills: 'nav.skills',
  settings: 'nav.settings',
};

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [currentScreen, setCurrentScreen] = useState<ScreenKey>('dashboard');
  const [currentPeriod, setCurrentPeriod] = useState<PayPeriod | null>(null);
  const [periods, setPeriods] = useState<PayPeriod[]>([]);
  // Mobile navigation drawer (closed by default; only shown on < md screens)
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // Load pay periods on mount
    api.getPeriods().then((data) => {
      setPeriods(data);
      if (data.length > 0) {
        setCurrentPeriod(data[0]);
      }
    });
  }, []);

  const renderScreen = () => {
    if (
      !currentPeriod &&
      currentScreen !== 'settings' &&
      currentScreen !== 'employees' &&
      currentScreen !== 'skills'
    ) {
      return <div className="p-6 text-center text-gray-500">{t('app.loading')}</div>;
    }

    switch (currentScreen) {
      case 'dashboard':
        return <Dashboard period={currentPeriod} />;
      case 'attendance':
        return <Attendance period={currentPeriod} />;
      case 'payroll':
        return <Payroll period={currentPeriod} periods={periods} />;
      case 'payslip':
        return <Payslip period={currentPeriod} periods={periods} />;
      case 'employees':
        return <Employees />;
      case 'skills':
        return <Skills />;
      case 'settings':
        return <Settings />;
      default:
        return null;
    }
  };

  const goTo = (key: ScreenKey) => {
    setCurrentScreen(key);
    setNavOpen(false); // close the drawer after navigating on mobile
  };

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Mobile drawer backdrop */}
      {navOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — static on md+, slide-in drawer on mobile */}
      <aside
        className={`w-56 bg-dark text-blue-100 flex-shrink-0 flex flex-col z-40
          fixed inset-y-0 left-0 transform transition-transform duration-200 ease-in-out
          md:static md:translate-x-0
          ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-4.5 py-4 border-b border-blue-900 flex items-center justify-between">
          <div>
            <b className="text-white text-base block">BRIGHTEM</b>
            <span className="text-xs text-blue-200">{t('app.brandSub')}</span>
          </div>
          {/* Close button (mobile only) */}
          <button
            onClick={() => setNavOpen(false)}
            className="md:hidden text-blue-200 text-xl leading-none px-1"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 py-2.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => goTo(item.key)}
              className={`w-full flex gap-2.5 items-center px-4.5 py-3 text-sm cursor-pointer border-l-4 transition-colors ${
                currentScreen === item.key
                  ? 'bg-blue-900 text-white border-l-primary font-bold'
                  : 'text-blue-100 border-l-transparent hover:bg-blue-900'
              }`}
            >
              <span className="w-4.5 text-center text-base">{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="bg-white border-b border-line px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setNavOpen(true)}
              className="md:hidden text-dark text-xl leading-none px-1 flex-shrink-0"
              aria-label="Open menu"
            >
              ☰
            </button>
            <h1 className="text-base sm:text-lg font-semibold text-dark truncate">
              {t(SCREEN_TITLES[currentScreen])}
            </h1>
          </div>
          <div className="flex gap-2 sm:gap-3.5 items-center text-xs text-muted">
            {currentPeriod && (
              <span className="hidden lg:inline bg-bg px-3 py-1 rounded-full">
                {t('app.payPeriod')}: {currentPeriod.startDate} ~ {currentPeriod.endDate} (
                {currentPeriod.label.includes('주') ? t('app.weekly') : t('app.monthly')})
              </span>
            )}
            {/* Language toggle — English is the default */}
            <div className="flex items-center rounded-full border border-line overflow-hidden flex-shrink-0">
              {(['en', 'ko'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                    lang === l ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-bg'
                  }`}
                >
                  {l === 'en' ? 'EN' : '한국어'}
                </button>
              ))}
            </div>
            <span className="hidden sm:inline">
              👤 <b className="text-dark">{t('app.role')}</b>
            </span>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {renderScreen()}
        </div>
      </div>
    </div>
  );
}
