import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Dashboard from './components/Dashboard';
import KnowledgeBase from './components/KnowledgeBase';
import Login from './components/Login';
import Settings from './components/Settings';
import AppShell from './components/layout/AppShell';
import { estEncadree, ecouterPortail } from './services/sessionPortail';
import './App.css';

/**
 * Attend le jeton que le portail MarsaPort AI transmet a la console encadree.
 *
 * Encadree, la console ne doit jamais afficher son propre formulaire de
 * connexion : l'utilisateur croirait devoir s'authentifier deux fois pour une
 * seule application. Elle patiente donc le temps de l'echange, puis affiche le
 * module. Ouverte seule, ce composant ne fait rien.
 *
 * @returns {'ouverte'|'attente'|'recue'} etat de la session
 */
function useSessionPortail() {
  const encadree = estEncadree();

  // Encadree, la console n'a aucune session propre : celle du portail fait
  // autorite. Tout jeton deja en memoire est ecarte des le premier rendu, avant
  // que la moindre page ne parte chercher des donnees. Sans cela un jeton
  // perime — ou signe avec l'ancien secret — provoquait un 401, donc la
  // deconnexion du portail, alors que le bon jeton etait deja en route.
  const [jetonRecu, setJetonRecu] = useState(() => {
    if (encadree) localStorage.removeItem('token');
    return false;
  });

  useEffect(() => {
    if (!encadree) return undefined;
    return ecouterPortail(() => setJetonRecu(true));
  }, [encadree]);

  if (!encadree) return 'ouverte';
  return jetonRecu ? 'recue' : 'attente';
}

function AttentePortail() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', color: '#5b7a99', fontSize: '0.95rem',
    }}>
      Ouverture du module…
    </div>
  );
}

function ProtectedRoute({ children, session }) {
  const token = localStorage.getItem('token');

  // Encadree et sans jeton : le portail est en train de nous l'envoyer.
  // Rediriger vers /login maintenant afficherait une seconde authentification
  // a l'interieur de la premiere.
  if (!token && session === 'attente') return <AttentePortail />;

  return token ? (
    <AppShell>{children}</AppShell>
  ) : (
    <Navigate to="/login" replace />
  );
}

function LoginRoute({ session }) {
  const token = localStorage.getItem('token');

  // Le formulaire de connexion de la console n'a de sens qu'ouverte seule.
  if (session !== 'ouverte') return <AttentePortail />;

  return token ? <Navigate to="/" replace /> : <Login />;
}

function App() {
  const session = useSessionPortail();

  return (
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
      <Routes>
        <Route path="/login" element={<LoginRoute session={session} />} />
        <Route path="/" element={<ProtectedRoute session={session}><Dashboard /></ProtectedRoute>} />
        <Route path="/knowledge" element={<ProtectedRoute session={session}><KnowledgeBase /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute session={session}><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
