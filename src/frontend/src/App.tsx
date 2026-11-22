import { useEffect } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';
import { Home } from './pages/Home';
import { EventDetail } from './pages/EventDetail';
import { AuthPage } from './pages/AuthPage';
import { MyConcerts } from './pages/MyConcerts';
import { ArtistPage, ArtistSearch } from './pages/Artists';
import { useAssistant } from './components/ChatWidget';

// Enlaces antiguos a /assistant?q=...: abren el chat flotante con la pregunta.
function AssistantLink() {
  const [params] = useSearchParams();
  const { open } = useAssistant();
  useEffect(() => open(params.get('q') ?? undefined), []);
  return <Navigate to="/" replace />;
}

export function App() {
  const { user, logout } = useAuth();

  return (
    <>
      <header className="header">
        <Link to="/" className="logo" aria-label="Zyntra, home">
          Zyn<span>tra</span>
        </Link>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/artists">Artists</NavLink>
          <NavLink to="/me">My concerts</NavLink>
          {user ? (
            <>
              <span className="who">Hi, {user.name}</span>
              <button className="ghost" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login">Log in</NavLink>
          )}
        </nav>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/assistant" element={<AssistantLink />} />
          <Route path="/artists" element={<ArtistSearch />} />
          <Route path="/artists/:mbid" element={<ArtistPage />} />
          <Route path="/me" element={<MyConcerts />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
