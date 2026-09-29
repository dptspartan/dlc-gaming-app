import { HashRouter, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { LiveDashboard } from './pages/LiveDashboard';
import { TournamentPage } from './pages/TournamentPage';
import { AdminGames } from './pages/admin/AdminGames';
import { AdminGate } from './pages/admin/AdminGate';
import { AdminHome } from './pages/admin/AdminHome';
import { TournamentEditor } from './pages/admin/TournamentEditor';

// HashRouter keeps deep links working on GitHub Pages, which has no rewrites.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/live" element={<LiveDashboard />} />
        <Route path="/t/:slug" element={<TournamentPage />} />
        <Route path="/t/:slug/live" element={<LiveDashboard />} />
        <Route path="/admin" element={<AdminGate><AdminHome /></AdminGate>} />
        <Route path="/admin/games" element={<AdminGate><AdminGames /></AdminGate>} />
        <Route path="/admin/t/:id" element={<AdminGate><TournamentEditor /></AdminGate>} />
      </Routes>
    </HashRouter>
  );
}
