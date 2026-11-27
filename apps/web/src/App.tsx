import { useState, useEffect } from 'react';
import type { PayPeriod } from '@brightem/shared';
import { api } from './api';
import { useI18n } from './i18n';
import type { TKey, Lang } from './i18n';
import Dashboard from './screens/Dashboard';
import Attendance from './screens/Attendance';
import Payroll from './screens/Payroll';
import Payslip from './screens/Payslip';
import PayExtras from './screens/PayExtras';
import Employees from './screens/Employees';
import Skills from './screens/Skills';
import TaskAssign from './screens/TaskAssign';
import UnitProgress from './screens/UnitProgress';
import Materials from './screens/Materials';
import MaterialStock from './screens/MaterialStock';
import Settings from './screens/Settings';
import Accounts, { ROLE_LABEL } from './screens/Accounts';
import Login from './screens/Login';
import { authApi, useAuth } from './auth';
import type { Role } from './auth';
import SyncBadge from './components/SyncBadge';

type ScreenKey =
  | 'dashboard'
  | 'attendance'
  | 'payroll'
  | 'payslip'
  | 'extras'
  | 'employees'
  | 'skills'
  | 'tasks'
  | 'units'
  | 'materials'
  | 'stock'
  | 'settings'
  | 'accounts';

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
  { key: 'extras', icon: '🍱', labelKey: 'nav.extras' },
  { key: 'employees', icon: '👷', labelKey: 'nav.employees' },
  { key: 'skills', icon: '🛠', labelKey: 'nav.skills' },
  { key: 'tasks', icon: '📋', labelKey: 'nav.tasks' },
  { key: 'units', icon: '🏢', labelKey: 'nav.units' },
  { key: 'materials', icon: '📦', labelKey: 'nav.materials' },
  { key: 'stock', icon: '🧱', labelKey: 'nav.stock' },
  { key: 'settings', icon: '⚙', labelKey: 'nav.settings' },
  { key: 'accounts', icon: '🔐', labelKey: 'nav.accounts' },
];

// Screens each role may open. Team leaders get the field screens only.
const TEAM_LEADER_SCREENS: ScreenKey[] = ['attendance', 'skills', 'tasks', 'units', 'materials', 'stock'];
// An admin picks a view after login: 'staff' shows the same field screens a
// team leader sees (with admin rights kept), 'admin' shows every menu.
type View = 'staff' | 'admin';
const VIEW_KEY = 'brightem.view'; // "<token>:<view>", kept for this browser tab

function canOpen(role: Role, key: ScreenKey, view: View = 'admin'): boolean {
  if (view === 'staff') return TEAM_LEADER_SCREENS.includes(key);
  if (role === 'admin') return true;
  if (role === 'manager') return key !== 'accounts';
  return TEAM_LEADER_SCREENS.includes(key);
}

// Primary tabs shown in the mobile bottom bar (the rest live under "More").
const BOTTOM_TABS: NavItem[] = [
  { key: 'dashboard', icon: '▤', labelKey: 'nav.dashboard' },
  { key: 'attendance', icon: '🕑', labelKey: 'nav.attendance' },
  { key: 'payroll', icon: '₱', labelKey: 'nav.payroll' },
  { key: 'employees', icon: '👷', labelKey: 'nav.employees' },
];

const SCREEN_TITLES: Record<ScreenKey, TKey> = {
  dashboard: 'nav.dashboard',
  attendance: 'nav.attendance',
  payroll: 'nav.payroll',
  payslip: 'nav.payslip',
  extras: 'nav.extras',
  employees: 'nav.employees',
  skills: 'nav.skills',
  tasks: 'nav.tasks',
  units: 'nav.units',
  materials: 'nav.materials',
  stock: 'nav.stock',
  settings: 'nav.settings',
  accounts: 'nav.accounts',
};

export default function App() {
  const { session, ready } = useAuth();
  const { t } = useI18n();
  if (!ready) return <div className="p-6 text-center text-gray-500">{t('app.loading')}</div>;
  if (!session) return <Login />;
  if (session.role !== 'admin') return <Shell key={session.username} view="admin" />;
  return <AdminApp token={session.token} username={session.username} />;
}

function AdminApp({ token, username }: { token: string; username: string }) {
  const [view, setViewState] = useState<View | null>(() => {
    const [tok, v] = (sessionStorage.getItem(VIEW_KEY) ?? '').split(':');
    return tok === token && (v === 'staff' || v === 'admin') ? v : null;
  });
  const setView = (v: View | null) => {
    if (v) sessionStorage.setItem(VIEW_KEY, `${token}:${v}`);
    else sessionStorage.removeItem(VIEW_KEY);
    setViewState(v);
  };
  if (!view) return <ViewChooser onPick={setView} />;
  return <Shell key={`${username}:${view}`} view={view} onSwitchView={() => setView(null)} />;
}

function ViewChooser({ onPick }: { onPick: (v: View) => void }) {
  const { t } = useI18n();
  const { session, logout } = useAuth();
  const card = (v: View, icon: string, title: TKey, sub: TKey) => (
    <button
      type="button"
      onClick={() => onPick(v)}
      className="w-full text-left border border-line rounded-xl p-4 bg-white hover:border-primary hover:bg-bg flex gap-3 items-center"
    >
      <span className="text-3xl leading-none">{icon}</span>
      <span>
        <b className="block text-dark">{t(title)}</b>
        <span className="text-xs text-muted">{t(sub)}</span>
      </span>
    </button>
  );
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-line rounded-xl shadow-sm p-6 space-y-3">
        <div>
          <b className="text-dark text-xl block">BRIGHTEM</b>
          <span className="text-xs text-muted">👤 {session!.displayName}</span>
        </div>
        <h2 className="font-bold text-dark">{t('view.title')}</h2>
        {card('staff', '👷', 'view.staff', 'view.staffSub')}
        {card('admin', '🔐', 'view.admin', 'view.adminSub')}
        <p className="text-xs text-muted">{t('view.hint')}</p>
        <button type="button" className="block mx-auto text-xs text-muted underline" onClick={() => logout()}>
          {t('auth.logout')}
        </button>
      </div>
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    if (newPw.length < 6) return setMsg(t('acct.pwShort'));
    try {
      const ok = await authApi.changePassword(session!.token, oldPw, newPw);
      if (!ok) return setMsg(t('auth.pwWrong'));
      alert(t('auth.pwChanged'));
      onClose();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-dark">{t('auth.changePw')}</h3>
        <input type="password" autoComplete="current-password" placeholder={t('auth.currentPw')}
          className="border border-line rounded px-3 py-2 w-full" value={oldPw}
          onChange={(e) => setOldPw(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder={t('acct.newPassword')}
          className="border border-line rounded px-3 py-2 w-full" value={newPw}
          onChange={(e) => setNewPw(e.target.value)} />
        {msg && <div className="text-sm text-red-600">{msg}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn ghost" onClick={onClose}>{t('acct.cancel')}</button>
          <button className="btn" onClick={submit}>{t('acct.save')}</button>
        </div>
      </div>
    </div>
  );
}

function Shell({ view, onSwitchView }: { view: View; onSwitchView?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { session, logout } = useAuth();
  const role = session!.role;
  const navItems = NAV_ITEMS.filter((n) => canOpen(role, n.key, view));
  const bottomTabs = BOTTOM_TABS.filter((n) => canOpen(role, n.key, view));
  const [pwOpen, setPwOpen] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<ScreenKey>(
    role === 'team_leader' || view === 'staff' ? 'attendance' : 'dashboard'
  );
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
    if (!canOpen(role, currentScreen, view)) return null;
    if (
      !currentPeriod &&
      currentScreen !== 'settings' &&
      currentScreen !== 'accounts' &&
      currentScreen !== 'employees' &&
      currentScreen !== 'skills' &&
      currentScreen !== 'tasks' &&
      currentScreen !== 'units' &&
      currentScreen !== 'materials' &&
      currentScreen !== 'stock'
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
      case 'extras':
        return <PayExtras period={currentPeriod} />;
      case 'employees':
        return <Employees />;
      case 'skills':
        return <Skills />;
      case 'tasks':
        return <TaskAssign period={currentPeriod} />;
      case 'units':
        return <UnitProgress />;
      case 'materials':
        return <Materials />;
      case 'stock':
        return <MaterialStock />;
      case 'settings':
        return <Settings />;
      case 'accounts':
        return <Accounts />;
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
          {navItems.map((item) => (
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
            <SyncBadge />
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
            <span className="hidden sm:inline whitespace-nowrap">
              👤 <b className="text-dark">{session!.displayName}</b>{' '}
              <span className="text-muted">
                · {t(ROLE_LABEL[role])}
                {session!.crewId ? ` (${session!.crewId})` : ''}
              </span>
            </span>
            {onSwitchView && (
              <button
                onClick={onSwitchView}
                className="border border-line rounded-full px-2.5 py-1 text-xs font-bold text-dark hover:bg-bg flex-shrink-0"
                title={t('view.switch')}
              >
                {view === 'staff' ? '👷' : '🔐'} <span className="hidden sm:inline">{t('view.switch')}</span>
              </button>
            )}
            <button
              onClick={() => setPwOpen(true)}
              className="text-muted hover:text-dark flex-shrink-0"
              title={t('auth.changePw')}
              aria-label={t('auth.changePw')}
            >
              🔑
            </button>
            <button
              onClick={() => logout()}
              className="border border-line rounded-full px-2.5 py-1 text-xs font-bold text-dark hover:bg-bg flex-shrink-0"
            >
              {t('auth.logout')}
            </button>
          </div>
        </div>

        {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}

        {/* Content area — extra bottom padding on mobile so the tab bar doesn't cover content */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 pb-20 md:pb-6">
          {renderScreen()}
        </div>

        {/* Bottom tab bar — mobile only. 5 primary tabs; "More" opens the drawer. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-line flex justify-around items-stretch h-14 pb-[env(safe-area-inset-bottom)]">
          {bottomTabs.map((item) => {
            const active = currentScreen === item.key;
            return (
              <button
                key={item.key}
                onClick={() => goTo(item.key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] leading-none ${
                  active ? 'text-primary font-bold' : 'text-muted'
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
          <button
            onClick={() => setNavOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] leading-none text-muted"
          >
            <span className="text-lg leading-none">⋯</span>
            <span>{t('nav.more')}</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
